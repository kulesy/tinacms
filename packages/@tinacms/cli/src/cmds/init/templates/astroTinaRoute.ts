// Git-only content API as an Astro server endpoint. `resolve()` is
// framework-agnostic (plain data in, data out), so it wraps directly in an
// Astro APIRoute — TinaNodeBackend is Node req/res only and can't be used here.
export const astroTinaRouteTemplate = () => {
  return `import { getSession } from 'auth-astro/server'
  import {
    resolve,
    GitBackedDatabase,
    GitHubBridge,
    FilesystemBridge,
  } from '@tinacms/datalayer'

  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO
  const branch = process.env.GITHUB_BRANCH || 'main'
  const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'

  export const prerender = false

  export const POST = async ({ request, params }) => {
    if (params.routes !== 'gql') {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
    }

    let database
    if (isLocal) {
      database = new GitBackedDatabase({
        bridge: new FilesystemBridge(process.cwd()),
        tinaDirectory: 'tina',
      })
    } else {
      // The editor's GitHub token (from their auth-astro session) binds a
      // GitHubBridge per request, so saves commit as whoever is signed in.
      const session = await getSession(request)
      const accessToken = session?.accessToken
      if (!accessToken) {
        return new Response(JSON.stringify({ error: 'Not authenticated' }), {
          status: 401,
        })
      }
      database = new GitBackedDatabase({
        bridge: new GitHubBridge({ owner, repo, branch, token: accessToken }),
        tinaDirectory: 'tina',
      })
    }

    const { query, variables } = await request.json()
    const result = await resolve({ query, variables, database })
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  }`;
};
