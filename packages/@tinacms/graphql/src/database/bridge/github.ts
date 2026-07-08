import type { Bridge } from './index';

export interface GitHubBridgeOptions {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  /** Optional path prefix within the repo where content lives (default: repo root). */
  rootPath?: string;
}

type TreeEntry = { path: string; type: string; sha: string };

const API = 'https://api.github.com';

/**
 * A Bridge that reads and writes content through the GitHub REST API instead of
 * the local filesystem.
 *
 * This keeps the backend stateless (no writable disk), so it works on serverless
 * hosts like Vercel - reads come live from GitHub, writes commit to GitHub. The
 * tradeoff is GitHub API rate limits (~5k req/hr) and per-request latency: every
 * read is an API call, so a collection list is one tree call plus a blob read per
 * document. Pair with SSG/ISR (read at build time) for anything beyond small
 * sites; the admin can still hit the API live.
 *
 * @security Path traversal (CWE-22): `qualify()` rejects null bytes and `..`
 * segments before any request, keeping callers inside the content root.
 */
export class GitHubBridge implements Bridge {
  public rootPath: string;
  private owner: string;
  private repo: string;
  private branch: string;
  private token: string;
  private treeCache?: Promise<TreeEntry[]>;

  constructor(opts: GitHubBridgeOptions) {
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.branch = opts.branch;
    this.token = opts.token;
    this.rootPath = opts.rootPath ?? '';
  }

  private qualify(filepath: string): string {
    if (filepath.includes('\0')) {
      throw new Error('Invalid path: null bytes are not allowed');
    }
    const clean = filepath.replace(/\\/g, '/').replace(/^\/+/, '');
    const joined = this.rootPath ? `${this.rootPath}/${clean}` : clean;
    if (joined.split('/').includes('..')) {
      throw new Error(`Invalid path (traversal not allowed): ${filepath}`);
    }
    return joined;
  }

  private headers(
    accept = 'application/vnd.github+json'
  ): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tinacms-git-backed-database',
    };
  }

  private encodePath(p: string): string {
    return p.split('/').map(encodeURIComponent).join('/');
  }

  public async get(filepath: string): Promise<string> {
    const p = this.qualify(filepath);
    const res = await fetch(
      `${API}/repos/${this.owner}/${this.repo}/contents/${this.encodePath(
        p
      )}?ref=${encodeURIComponent(this.branch)}`,
      { headers: this.headers('application/vnd.github.raw') }
    );
    if (res.status === 404) {
      throw new Error(`GitHubBridge: file not found: ${p}`);
    }
    if (!res.ok) {
      throw new Error(
        `GitHubBridge get ${p}: ${res.status} ${await res.text()}`
      );
    }
    return await res.text();
  }

  public async glob(pattern: string, extension: string): Promise<string[]> {
    const prefix = this.qualify(pattern);
    const ext = `.${extension}`;
    const tree = await this.getTree();
    const stripLen = this.rootPath ? this.rootPath.length + 1 : 0;
    return tree
      .filter(
        (e) =>
          e.type === 'blob' &&
          e.path.startsWith(prefix) &&
          e.path.endsWith(ext)
      )
      .map((e) => e.path.slice(stripLen));
  }

  public async put(filepath: string, data: string): Promise<void> {
    const p = this.qualify(filepath);
    const sha = await this.shaFor(p);
    const res = await fetch(
      `${API}/repos/${this.owner}/${this.repo}/contents/${this.encodePath(p)}`,
      {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({
          message: `Update ${p}`,
          content: Buffer.from(data, 'utf8').toString('base64'),
          branch: this.branch,
          ...(sha ? { sha } : {}),
        }),
      }
    );
    if (!res.ok) {
      throw new Error(
        `GitHubBridge put ${p}: ${res.status} ${await res.text()}`
      );
    }
    this.treeCache = undefined; // content changed - drop the cached tree
  }

  public async delete(filepath: string): Promise<void> {
    const p = this.qualify(filepath);
    const sha = await this.shaFor(p);
    if (!sha) return; // nothing to delete
    const res = await fetch(
      `${API}/repos/${this.owner}/${this.repo}/contents/${this.encodePath(p)}`,
      {
        method: 'DELETE',
        headers: this.headers(),
        body: JSON.stringify({
          message: `Delete ${p}`,
          sha,
          branch: this.branch,
        }),
      }
    );
    if (!res.ok) {
      throw new Error(
        `GitHubBridge delete ${p}: ${res.status} ${await res.text()}`
      );
    }
    this.treeCache = undefined;
  }

  /** Recursive git tree for the branch, cached for the life of this instance. */
  private getTree(): Promise<TreeEntry[]> {
    if (!this.treeCache) {
      this.treeCache = fetch(
        `${API}/repos/${this.owner}/${this.repo}/git/trees/${encodeURIComponent(
          this.branch
        )}?recursive=1`,
        { headers: this.headers() }
      ).then(async (res) => {
        if (!res.ok) {
          this.treeCache = undefined;
          throw new Error(
            `GitHubBridge tree ${this.branch}: ${res.status} ${await res.text()}`
          );
        }
        const json = (await res.json()) as {
          tree: TreeEntry[];
          truncated?: boolean;
        };
        if (json.truncated) {
          console.warn(
            'GitHubBridge: git tree was truncated by the API - very large repos may miss files in glob().'
          );
        }
        return json.tree;
      });
    }
    return this.treeCache;
  }

  private async shaFor(p: string): Promise<string | undefined> {
    const tree = await this.getTree();
    return tree.find((e) => e.path === p && e.type === 'blob')?.sha;
  }
}
