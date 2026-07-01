import { InitEnvironment } from '..';
import { Config, makeImportString } from '../prompts';

export const nextApiRouteTemplate = ({
  config,
  env,
}: {
  config: Config;
  env: InitEnvironment;
}) => {
  const extraPath = env.usingSrc ? '../' : '';
  if (config.gitOnly) {
    // Per-user content API: the editor's GitHub token binds a GitHubBridge per
    // request, so saves commit as whoever is signed in (no static token).
    return `import { getToken } from 'next-auth/jwt'
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

  export default async function handler(req, res) {
    const routes = req.query.routes || []
    if (routes[0] !== 'gql') {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    let database
    if (isLocal) {
      database = new GitBackedDatabase({
        bridge: new FilesystemBridge(process.cwd()),
        tinaDirectory: 'tina',
      })
    } else {
      const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
      const accessToken = token?.accessToken
      if (!accessToken) {
        res.status(401).json({ error: 'Not authenticated' })
        return
      }
      database = new GitBackedDatabase({
        bridge: new GitHubBridge({ owner, repo, branch, token: accessToken }),
        tinaDirectory: 'tina',
      })
    }

    const { query, variables } = req.body
    const result = await resolve({ query, variables, database })
    res.json(result)
  }`;
  }
  return `import { TinaNodeBackend, LocalBackendAuthProvider } from '@tinacms/datalayer'
  ${makeImportString(config.authProvider?.backendAuthProviderImports)}
 

  
  import databaseClient from '${extraPath}../../../tina/__generated__/databaseClient'
  
  const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'
  
  const handler = TinaNodeBackend({
    authProvider: isLocal
      ? LocalBackendAuthProvider()
      : ${config.authProvider?.backendAuthProvider || ''},
    databaseClient,
  })
  
  export default (req, res) => {
    // Modify the request here if you need to
    return handler(req, res)
  }`;
};
