/**
 * GitBackedDatabase
 *
 * A Database that serves reads AND writes strictly from the Bridge
 * (git/filesystem) with NO index / level store at all:
 *
 *   - get()                reads + parses the file from the bridge on demand
 *   - query()              globs the collection folder, sorts + paginates in JS
 *                          (the resolver's hydrator re-fetches each doc via get)
 *   - getSchema/lookup     read the generated files from the bridge
 *   - put()/delete()/      write straight to the bridge (+ onPut/onDelete), with
 *     addPendingDocument()   no index/level batch operations
 *
 * Git stays the single source of truth. There is no indexContent(), no
 * MemoryLevel, and no external database.
 *
 * Scope (POC): empty filterChain (the admin's default collection list) and the
 * default filepath sort. Non-empty filters / custom sort keys would require
 * parsing each document and applying makeFilter in JS - left as a follow-up.
 */
import path from 'path';
import micromatch from 'micromatch';
import { Database, type DatabaseArgs, type GitProvider } from './index';
import {
  loadAndParseWithAliases,
  transformDocument,
  normalizePath,
} from './util';
import { createSchema } from '../schema/createSchema';

const SYSTEM_FILES = ['_schema', '_graphql', '_lookup'];

export class GitBackedDatabase extends Database {
  private _gitLookup: Record<string, any> | undefined;

  // No level is needed - all content I/O goes through the bridge. Pass a
  // `gitProvider` to have writes committed (its onPut/onDelete are wired up for
  // you), or pass onPut/onDelete directly. With none, writes land in the local
  // working tree.
  constructor(
    config: Omit<DatabaseArgs, 'level'> & {
      level?: any;
      gitProvider?: GitProvider;
    }
  ) {
    const { gitProvider, onPut, onDelete, ...rest } = config;
    super({
      ...rest,
      level: config.level,
      onPut: gitProvider ? gitProvider.onPut.bind(gitProvider) : onPut,
      onDelete: gitProvider ? gitProvider.onDelete.bind(gitProvider) : onDelete,
    } as DatabaseArgs);
  }

  private generated(file: string) {
    return normalizePath(path.join(this.tinaDirectory, '__generated__', file));
  }

  private requireBridge() {
    if (!this.bridge) {
      throw new Error('GitBackedDatabase requires a bridge');
    }
    return this.bridge;
  }

  // ── schema / lookup come from the generated files on the bridge ────────────

  public getTinaSchema = async () => {
    const raw = await this.requireBridge().get(this.generated('_schema.json'));
    return JSON.parse(raw);
  };

  // Override getSchema so it never touches the level (no initLevel). Populates
  // the base class's private cache so inherited helpers (collectionForPath,
  // formatBodyOnPayload, stringifyFile) work unchanged.
  public getSchema = async () => {
    const self = this as any;
    if (self.tinaSchema) {
      return self.tinaSchema;
    }
    const raw = await this.getTinaSchema();
    self.tinaSchema = await createSchema({ schema: raw });
    return self.tinaSchema;
  };

  public getLookup = async (returnType?: string) => {
    if (!this._gitLookup) {
      const raw = await this.requireBridge().get(this.generated('_lookup.json'));
      this._gitLookup = JSON.parse(raw);
    }
    return returnType ? this._gitLookup[returnType] : this._gitLookup;
  };

  public getGraphQLSchema = async () => {
    return this.getGraphQLSchemaFromBridge();
  };

  // ── reads served directly from the bridge ──────────────────────────────────

  public get = async <T extends object>(filepath: string): Promise<T> => {
    if (SYSTEM_FILES.includes(filepath)) {
      throw new Error(`Unexpected get for config file ${filepath}`);
    }
    const tinaSchema = await this.getSchema();
    const collection = tinaSchema.getCollectionByFullPath(filepath);
    const templateInfo = tinaSchema.getTemplatesForCollectable(collection);
    const aliasedData = await loadAndParseWithAliases(
      this.requireBridge(),
      filepath,
      collection,
      templateInfo
    );
    if (!aliasedData) {
      throw new Error(`Unable to load record ${filepath}`);
    }
    return transformDocument(filepath, aliasedData, tinaSchema);
  };

  public query = async (queryOptions: any, hydrator: any) => {
    const {
      first,
      after,
      last,
      before,
      filterChain = [],
      collection: collectionName,
    } = queryOptions;

    if (filterChain.length) {
      // POC: filtered queries aren't supported without an index. This includes
      // the reference-check query the resolver fires when opening ANY document
      // (hasReferences). Return empty rather than throwing so single-document
      // reads and the admin edit form keep working - reference counts just read
      // as zero. Full filter support would parse each doc and apply makeFilter.
      return {
        edges: [],
        pageInfo: {
          hasPreviousPage: false,
          hasNextPage: false,
          startCursor: '',
          endCursor: '',
        },
      };
    }

    const tinaSchema = await this.getSchema();
    const collection = tinaSchema.getCollection(collectionName);
    const format = collection.format || 'md';

    let paths = await this.requireBridge().glob(
      normalizePath(collection.path),
      format
    );
    const matches = tinaSchema.getMatches({ collection });
    if (matches.length) {
      paths = micromatch(paths, matches);
    }

    paths = paths.map(normalizePath).sort();
    const reverse = !!last;
    if (reverse) {
      paths.reverse();
    }

    if (after) {
      const a = atob(after);
      paths = paths.filter((p) => (reverse ? p < a : p > a));
    }
    if (before) {
      const b = atob(before);
      paths = paths.filter((p) => (reverse ? p > b : p < b));
    }

    const limit = first ?? last ?? 50;
    let hasNextPage = false;
    let hasPreviousPage = false;
    if (limit !== -1 && paths.length > limit) {
      paths = paths.slice(0, limit);
      if (reverse) {
        hasPreviousPage = true;
      } else {
        hasNextPage = true;
      }
    }

    const startKey = paths[0] || '';
    const endKey = paths[paths.length - 1] || '';

    const edges = [];
    for (const p of paths) {
      const node = await hydrator(p, undefined);
      edges.push({ node, cursor: btoa(p) });
    }

    return {
      edges,
      pageInfo: {
        hasPreviousPage,
        hasNextPage,
        startCursor: btoa(startKey),
        endCursor: btoa(endKey),
      },
    };
  };

  // ── writes go straight to the bridge, no index/level batch ops ─────────────

  private async writeFile(filepath: string, data: { [key: string]: unknown }) {
    if (SYSTEM_FILES.includes(filepath)) {
      throw new Error(`Unexpected put for config file ${filepath}`);
    }
    const tinaSchema = await this.getSchema();
    const collection = tinaSchema.getCollectionByFullPath(filepath);
    if (!collection) {
      throw new Error(`Unable to find collection for ${filepath}`);
    }
    const normalizedPath = normalizePath(filepath);
    const dataFields = await this.formatBodyOnPayload(filepath, data);
    const isFolderPlaceholder = filepath.endsWith(
      `.gitkeep.${collection.format || 'md'}`
    );
    const stringifiedFile = isFolderPlaceholder
      ? ''
      : await this.stringifyFile(filepath, dataFields, collection);
    await this.requireBridge().put(normalizedPath, stringifiedFile);
    await (this as any).onPut(normalizedPath, stringifiedFile);
  }

  public put = async (
    filepath: string,
    data: { [key: string]: unknown },
    _collectionName?: string
  ) => {
    await this.writeFile(filepath, data);
  };

  public addPendingDocument = async (
    filepath: string,
    data: { [key: string]: unknown }
  ) => {
    await this.writeFile(filepath, data);
  };

  public delete = async (filepath: string) => {
    const tinaSchema = await this.getSchema();
    const collection = tinaSchema.getCollectionByFullPath(filepath);
    if (!collection) {
      throw new Error(`No collection found for path: ${filepath}`);
    }
    const normalizedPath = normalizePath(filepath);
    await this.requireBridge().delete(normalizedPath);
    await (this as any).onDelete(normalizedPath);
  };

  // ── indexing is a no-op: there is no index to build ────────────────────────

  public indexContent = async () => ({ warnings: [] } as any);
  public indexContentByPaths = async () => {};
  public deleteContentByPaths = async () => {};

  // no level, so no metadata store - the CLI's index-status polling no-ops
  public getMetadata = async () => undefined;
  public setMetadata = async () => undefined as any;
}
