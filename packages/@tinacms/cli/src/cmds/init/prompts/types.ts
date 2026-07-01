import { ContentFrontmatterFormat } from '@tinacms/schema-tools';
import { Framework, GeneratedFileType } from '../';

export type Config = {
  typescript: boolean;
  publicFolder?: string;
  framework: Framework;
  packageManager: 'pnpm' | 'yarn' | 'npm' | 'bun';
  forestryMigrate: boolean;
  frontMatterFormat?: ContentFrontmatterFormat;
  hosting?: 'tina-cloud' | 'self-host';
  // Git-only self-hosting: no external database and no index. Content is read
  // and written straight through a bridge (filesystem at build, GitHub per-user
  // at runtime). Set when the "None (git-only)" database option is chosen.
  gitOnly?: boolean;
  gitProvider?: PromptGitProvider;
  databaseAdapter?: PromptDatabaseAdapter;
  authProvider?: PromptAuthProvider;
  nextAuthCredentialsProviderName?: string;
  isLocalEnvVarName: string;
  envVars: { key: string; value: string }[];
  overwriteList?: GeneratedFileType[];
};
export interface ImportStatement {
  imported: string[];
  from: string;
  packageName: string;
}

export interface PromptGitProvider {
  gitProviderClassText: string;
  imports?: ImportStatement[];
}

export interface PromptDatabaseAdapter {
  databaseAdapterClassText: string;
  imports?: ImportStatement[];
}
export interface PromptAuthProvider {
  name: string;
  // For tina/config file
  configAuthProviderClass?: string;
  configImports?: ImportStatement[];
  extraTinaCollections?: string[];
  // for /api/tina/[...routes] file
  backendAuthProvider?: string;
  backendAuthProviderImports?: ImportStatement[];
  peerDependencies?: string[];
}
