import type { Config } from '../prompts';
import { makeImportString } from '../prompts';

export type Variables = {
  isLocalEnvVarName: string;
};

export type DatabaseAdapterTypes = 'upstash-redis';

export const databaseTemplate = ({ config }: { config: Config }) => {
  if (config.gitOnly) {
    // Git-only: no external database and no index. Build-time reads resolve
    // straight from the working tree; editor writes are committed per-user by
    // the content API route (pages/api/tina/[...routes]).
    return `
import { GitBackedDatabase, FilesystemBridge } from '@tinacms/datalayer'

export default new GitBackedDatabase({
  bridge: new FilesystemBridge(process.cwd()),
  tinaDirectory: 'tina',
})
`;
  }
  return `
import { createDatabase, createLocalDatabase } from '@tinacms/datalayer'
${makeImportString(config.gitProvider?.imports)}
${makeImportString(config.databaseAdapter?.imports)}

const branch = (process.env.GITHUB_BRANCH ||
  process.env.VERCEL_GIT_COMMIT_REF ||
  process.env.HEAD ||
  "main")

const isLocal =  process.env.${config.isLocalEnvVarName} === 'true'

export default isLocal
  ? createLocalDatabase()
  : createDatabase({
      gitProvider: ${config.gitProvider?.gitProviderClassText},
      databaseAdapter: ${config.databaseAdapter?.databaseAdapterClassText},
      namespace: branch,
    })
`;
};
