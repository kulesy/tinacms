import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubBridge } from './github';

type Call = { url: string; init: any };

function mockFetch(route: (url: string, init: any) => any) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    return route(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

function res(body: { status?: number; text?: string; json?: any }) {
  const status = body.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body.text ?? '',
    json: async () => body.json ?? {},
  };
}

const TREE = {
  tree: [
    { path: 'content/pages/home.md', type: 'blob', sha: 'sha-home' },
    { path: 'content/pages/about.md', type: 'blob', sha: 'sha-about' },
    { path: 'content/pages', type: 'tree', sha: 'sha-dir' },
    { path: 'content/posts/p1.json', type: 'blob', sha: 'sha-p1' },
  ],
};

const opts = { owner: 'o', repo: 'r', branch: 'main', token: 't' };

afterEach(() => vi.unstubAllGlobals());

describe('GitHubBridge', () => {
  it('get() reads raw content from the contents API', async () => {
    mockFetch((url) => {
      if (url.includes('/contents/content/pages/home.md'))
        return res({ text: '# Home' });
      throw new Error(`unexpected ${url}`);
    });
    const bridge = new GitHubBridge(opts);
    expect(await bridge.get('content/pages/home.md')).toBe('# Home');
  });

  it('get() throws a not-found error on 404', async () => {
    mockFetch(() => res({ status: 404, text: 'Not Found' }));
    const bridge = new GitHubBridge(opts);
    await expect(bridge.get('content/pages/missing.md')).rejects.toThrow(
      /file not found/i
    );
  });

  it('glob() filters the git tree by prefix and extension', async () => {
    mockFetch((url) => {
      if (url.includes('/git/trees/')) return res({ json: TREE });
      throw new Error(`unexpected ${url}`);
    });
    const bridge = new GitHubBridge(opts);
    expect(await bridge.glob('content/pages', 'md')).toEqual([
      'content/pages/home.md',
      'content/pages/about.md',
    ]);
  });

  it('put() sends base64 content plus the existing blob sha', async () => {
    const { calls } = mockFetch((url, init) => {
      if (url.includes('/git/trees/')) return res({ json: TREE });
      if (init?.method === 'PUT') return res({ text: '' });
      throw new Error(`unexpected ${url}`);
    });
    const bridge = new GitHubBridge(opts);
    await bridge.put('content/pages/home.md', 'hello');
    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put).toBeTruthy();
    const body = JSON.parse(put!.init.body);
    expect(body.sha).toBe('sha-home');
    expect(body.branch).toBe('main');
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe('hello');
  });

  it('put() omits the sha for a new file', async () => {
    const { calls } = mockFetch((url, init) => {
      if (url.includes('/git/trees/')) return res({ json: TREE });
      if (init?.method === 'PUT') return res({ text: '' });
      throw new Error(`unexpected ${url}`);
    });
    const bridge = new GitHubBridge(opts);
    await bridge.put('content/pages/new.md', 'new');
    const body = JSON.parse(
      calls.find((c) => c.init?.method === 'PUT')!.init.body
    );
    expect(body.sha).toBeUndefined();
  });

  it('delete() sends the blob sha, and no-ops when the file is absent', async () => {
    const { calls } = mockFetch((url, init) => {
      if (url.includes('/git/trees/')) return res({ json: TREE });
      if (init?.method === 'DELETE') return res({ text: '' });
      throw new Error(`unexpected ${url}`);
    });
    const bridge = new GitHubBridge(opts);

    await bridge.delete('content/pages/home.md');
    const del = calls.find((c) => c.init?.method === 'DELETE');
    expect(JSON.parse(del!.init.body).sha).toBe('sha-home');

    calls.length = 0;
    await bridge.delete('content/pages/ghost.md');
    expect(calls.find((c) => c.init?.method === 'DELETE')).toBeUndefined();
  });

  it('rejects path traversal', async () => {
    mockFetch(() => res({ text: '' }));
    const bridge = new GitHubBridge(opts);
    await expect(bridge.get('../secrets.md')).rejects.toThrow(/traversal/i);
  });
});
