import crypto from 'crypto-js';
import prompts from 'prompts';

import type { Framework } from '../';
import { askTinaCloudSetup } from './askTinaCloudSetup';
import { setupGitHubApp } from './githubApp';
import type { Config, PromptAuthProvider } from './types';
const supportedAuthProviders: {
  'tina-cloud': PromptAuthProvider;
  'next-auth': PromptAuthProvider;
  github: PromptAuthProvider;
  other: PromptAuthProvider;
} = {
  other: {
    name: 'other',
  },
  // Per-user GitHub OAuth for git-only self-hosting. The config auth class and
  // the API routes are emitted by the git-only templates, so only the name and
  // the next-auth peer dep are declared here.
  github: {
    name: 'github',
    peerDependencies: ['next-auth'],
  },
  'tina-cloud': {
    configAuthProviderClass: '',
    backendAuthProvider: 'TinaCloudBackendAuthProvider()',
    name: 'tina-cloud',
    backendAuthProviderImports: [
      {
        imported: ['TinaCloudBackendAuthProvider'],
        from: '@tinacms/auth',
        packageName: '@tinacms/auth',
      },
    ],
  },
  'next-auth': {
    name: 'next-auth',
    configAuthProviderClass: `new UsernamePasswordAuthJSProvider()`,
    configImports: [
      {
        imported: ['UsernamePasswordAuthJSProvider', 'TinaUserCollection'],
        from: 'tinacms-authjs/dist/tinacms',
        packageName: 'tinacms-authjs',
      },
    ],
    extraTinaCollections: ['TinaUserCollection'],
    backendAuthProvider: `AuthJsBackendAuthProvider({
          authOptions: TinaAuthJSOptions({
            databaseClient: databaseClient,
            secret: process.env.NEXTAUTH_SECRET,
          }),
        })`,
    backendAuthProviderImports: [
      {
        from: 'tinacms-authjs',
        packageName: 'tinacms-authjs',
        imported: ['AuthJsBackendAuthProvider', 'TinaAuthJSOptions'],
      },
    ],
    peerDependencies: ['next-auth'],
  },
};

const authProviderUpdateConfig: {
  [key in keyof typeof supportedAuthProviders]: ({
    config,
  }: {
    config: Config;
  }) => Promise<void>;
} = {
  other: async () => {},
  github: setupGitHubApp,
  'tina-cloud': askTinaCloudSetup,
  'next-auth': async ({ config }) => {
    const result = await prompts([
      {
        name: 'nextAuthSecret',
        type: 'text',
        message: `What is the NextAuth.js Secret? (Hit enter to use a randomly generated secret)`,
        initial:
          process.env.NEXTAUTH_SECRET ||
          crypto.lib.WordArray.random(16).toString(),
      },
    ]);
    config.envVars.push({
      key: 'NEXTAUTH_SECRET',
      value: result.nextAuthSecret,
    });
  },
};
export const chooseAuthProvider = async ({
  framework,
  config,
}: {
  config: Config;
  framework: Framework;
}) => {
  // Could add this back in later if we want to support things other then next-auth in the init
  // {
  //   title: 'TinaCloud for Auth',
  //   value: 'tina-cloud',
  // },
  // const choices = []
  // if (framework.name === 'next') {
  //   choices.push({
  //     value: 'next-auth',
  //     title: 'Next Auth (recommended)',
  //   })
  // }
  // choices.push({
  //   value: 'other',
  //   title: 'I will create my own auth provider',
  // })
  // const authProviderChoice = await prompts([
  //   {
  //     name: 'authProvider',
  //     type: 'select',
  //     message: 'Which auth provider are you using?',
  //     choices,
  //   },
  // ])
  // if (typeof authProviderChoice.authProvider === 'undefined') {
  //   throw new Error('Auth provider is required')
  // }
  // const authProvider =
  //   supportedAuthProviders[
  //     authProviderChoice.authProvider as 'tina-cloud' | 'next-auth' | 'other'
  //   ]

  // await authProviderUpdateConfig[authProviderChoice.authProvider]({
  //   config,
  // })
  // Git-only self-hosting signs editors in with GitHub (per-user OAuth), not the
  // next-auth username/password user collection.
  if (config.gitOnly) {
    await authProviderUpdateConfig['github']({ config });
    return supportedAuthProviders['github'];
  }

  const authProvider = supportedAuthProviders['next-auth'];

  await authProviderUpdateConfig['next-auth']({
    config,
  });

  return authProvider;
};
