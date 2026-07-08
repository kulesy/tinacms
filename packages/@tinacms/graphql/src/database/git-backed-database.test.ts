/**
 * POC feasibility test for GitBackedDatabase.
 *
 * Proves that get() and query() return correct results reading STRICTLY from
 * the bridge, with an empty level store and WITHOUT ever calling indexContent().
 * If this passes, a self-hosted Tina can serve content with no index / database.
 *
 * The generated files (_schema.json / _lookup.json / _graphql.json) are seeded
 * into the bridge from buildSchema() output - exactly the artifacts Tina's
 * codegen writes to disk - so this mirrors a real project on a filesystem.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryLevel } from 'memory-level';
import { buildSchema } from '..';
import type { Bridge } from './bridge';
import type { Schema } from '@tinacms/schema-tools';
import { GitBackedDatabase } from './git-backed-database';
import { REFS_COLLECTIONS_SORT_KEY } from './datalayer';

class InMemoryBridge implements Bridge {
  rootPath = '';
  private files: Map<string, string> = new Map();
  seed(filepath: string, content: string) {
    this.files.set(filepath, content);
    return this;
  }
  async glob(pattern: string, extension: string): Promise<string[]> {
    return Array.from(this.files.keys()).filter(
      (p) => p.startsWith(pattern) && p.endsWith(`.${extension}`)
    );
  }
  async get(filepath: string): Promise<string> {
    const content = this.files.get(filepath);
    if (content === undefined)
      throw new Error(`InMemoryBridge: file not found: ${filepath}`);
    return content;
  }
  async put(filepath: string, data: string): Promise<void> {
    this.files.set(filepath, data);
  }
  async delete(filepath: string): Promise<void> {
    this.files.delete(filepath);
  }
}

const testSchema: Schema = {
  collections: [
    {
      name: 'post',
      label: 'Post',
      path: 'content/posts',
      format: 'json',
      fields: [
        { name: 'title', label: 'Title', type: 'string' },
        { name: 'score', label: 'Score', type: 'number' },
        { name: 'published', label: 'Published', type: 'boolean' },
      ],
    },
  ],
};

const POSTS = [
  { path: 'content/posts/alpha.json', data: { title: 'Alpha', score: 1 } },
  { path: 'content/posts/beta.json', data: { title: 'Beta', score: 2 } },
  { path: 'content/posts/gamma.json', data: { title: 'Gamma', score: 3 } },
  { path: 'content/posts/delta.json', data: { title: 'Delta', score: 4 } },
  { path: 'content/posts/epsilon.json', data: { title: 'Epsilon', score: 5 } },
] as const;

async function setup() {
  const bridge = new InMemoryBridge();
  // content
  for (const { path, data } of POSTS) bridge.seed(path, JSON.stringify(data));
  // generated files - exactly what codegen writes to disk
  const built = await buildSchema({ schema: testSchema });
  bridge.seed(
    'tina/__generated__/_schema.json',
    JSON.stringify(built.tinaSchema.schema)
  );
  bridge.seed('tina/__generated__/_lookup.json', JSON.stringify(built.lookup));
  bridge.seed(
    'tina/__generated__/_graphql.json',
    JSON.stringify(built.graphQLSchema)
  );

  // NOTE: a dummy level is passed but never populated - we never call
  // indexContent(). All reads must come from the bridge.
  const database = new GitBackedDatabase({
    bridge,
    level: new MemoryLevel<string, Record<string, any>>({
      valueEncoding: 'json',
    }),
    tinaDirectory: 'tina',
  });
  return { bridge, database };
}

describe('GitBackedDatabase (no index)', () => {
  let database: GitBackedDatabase;
  beforeEach(async () => {
    ({ database } = await setup());
  });

  it('get() reads + parses a document straight from the bridge', async () => {
    const doc = await database.get<any>('content/posts/alpha.json');
    expect(doc.title).toBe('Alpha');
    expect(doc.score).toBe(1);
    expect(doc._collection).toBe('post');
    expect(doc._id).toBe('content/posts/alpha.json');
  });

  it('query() lists a whole collection from the bridge, filepath-sorted', async () => {
    // hydrator mirrors the resolver: re-fetch each doc via get()
    const res = await database.query(
      { collection: 'post', filterChain: [] },
      (p: string) => database.get<any>(p)
    );
    const titles = res.edges.map((e: any) => e.node.title);
    expect(titles).toEqual(['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma']);
    expect(res.pageInfo.hasNextPage).toBe(false);
  });

  it('query() paginates with cursors, no index involved', async () => {
    const page1 = await database.query(
      { collection: 'post', filterChain: [], first: 2 },
      (p: string) => p
    );
    expect(page1.edges.map((e: any) => e.node)).toEqual([
      'content/posts/alpha.json',
      'content/posts/beta.json',
    ]);
    expect(page1.pageInfo.hasNextPage).toBe(true);

    const page2 = await database.query(
      {
        collection: 'post',
        filterChain: [],
        first: 2,
        after: page1.pageInfo.endCursor,
      },
      (p: string) => p
    );
    expect(page2.edges.map((e: any) => e.node)).toEqual([
      'content/posts/delta.json',
      'content/posts/epsilon.json',
    ]);
    expect(page2.pageInfo.hasNextPage).toBe(true);
  });
});

describe('GitBackedDatabase filtered queries', () => {
  let database: GitBackedDatabase;
  beforeEach(async () => {
    ({ database } = await setup());
  });

  it('throws loudly on a genuine user filter rather than returning empty', async () => {
    await expect(
      database.query(
        {
          collection: 'post',
          filterChain: [{ title: { eq: 'Alpha' } }],
        },
        (p: string) => p
      )
    ).rejects.toThrow(/cannot serve a filtered query/i);
  });

  it('returns empty for the reference-check query so document opens keep working', async () => {
    // hasReferences / findReferences query with the reference pseudo-index.
    const res = await database.query(
      {
        collection: 'post',
        filterChain: [{ __ref__: { eq: 'content/posts/alpha.json' } }],
        sort: REFS_COLLECTIONS_SORT_KEY,
      },
      (p: string) => p
    );
    expect(res.edges).toEqual([]);
    expect(res.pageInfo.hasNextPage).toBe(false);
    expect(res.pageInfo.hasPreviousPage).toBe(false);
  });
});
