import { Config, makeImportString } from '../prompts';

export type ConfigTemplateArgs = {
  extraText?: string;
  publicFolder: string;
  collections?: string;
  isLocalEnvVarName?: string;
  config: Config;
  isForestryMigration?: boolean;
  selfHosted?: boolean;
};

const clientConfig = (isForestryMigration?: boolean) => {
  if (isForestryMigration) {
    return 'client: {skip: true},';
  }
  return '';
};
const baseFields = `[
  {
    type: 'string',
    name: 'title',
    label: 'Title',
    isTitle: true,
    required: true,
  },
  {
    type: 'rich-text',
    name: 'body',
    label: 'Body',
    isBody: true,
  },
]`;

// The Astro demo hero is a fully editable content model: every text element
// (eyebrow, headline, tagline) and both call-to-action buttons (label + link).
const astroHeroFields = `[
  {
    type: 'string',
    name: 'eyebrow',
    label: 'Eyebrow',
  },
  {
    type: 'string',
    name: 'title',
    label: 'Headline',
    isTitle: true,
    required: true,
  },
  {
    type: 'rich-text',
    name: 'body',
    label: 'Tagline',
    isBody: true,
  },
  {
    type: 'object',
    name: 'ctaPrimary',
    label: 'Primary button',
    fields: [
      { type: 'string', name: 'label', label: 'Label' },
      { type: 'string', name: 'href', label: 'Link' },
    ],
  },
  {
    type: 'object',
    name: 'ctaSecondary',
    label: 'Secondary button',
    fields: [
      { type: 'string', name: 'label', label: 'Label' },
      { type: 'string', name: 'href', label: 'Link' },
    ],
  },
]`;

const generateCollectionString = (args: ConfigTemplateArgs) => {
  if (args.collections) {
    return args.collections;
  }
  let extraTinaCollections =
    args.config.authProvider?.extraTinaCollections?.join(',\n');

  if (extraTinaCollections) {
    extraTinaCollections = extraTinaCollections + ',';
  }

  const baseCollections = `[
    ${extraTinaCollections || ''}
    {
      name: 'post',
      label: 'Posts',
      path: 'content/posts',
      fields: ${baseFields},
    },
  ]`;
  const nextExampleCollection = `[
    ${extraTinaCollections || ''}
    {
      name: 'post',
      label: 'Posts',
      path: 'content/posts',
      fields: ${baseFields},
      ui: {
        // This is an DEMO router. You can remove this to fit your site
        router: ({ document }) => \`/demo/blog/\${document._sys.filename}\`,
      },
    },
  ]`;
  const astroExampleCollection = `[
    ${extraTinaCollections || ''}
    {
      name: 'post',
      label: 'Posts',
      path: 'content/posts',
      fields: ${astroHeroFields},
      ui: {
        // Opens the /tinacms-demo page for visual editing. Change or remove to fit your site.
        router: () => '/tinacms-demo',
      },
    },
  ]`;
  if (args.config?.framework?.name === 'next') {
    return nextExampleCollection;
  }
  if (args.config?.framework?.name === 'astro') {
    return astroExampleCollection;
  }
  return baseCollections;
};

// Git-only config: per-user GitHub OAuth (via NextAuth) with a local-mode
// bypass. Auth rides the same-origin session cookie, so the content API
// authenticates each request as the signed-in editor.
const generateGitOnlyConfig = (args: ConfigTemplateArgs) => {
  return `
  import { AbstractAuthProvider, defineConfig } from "tinacms";
  ${args.extraText || ''}

  class GitHubAuthProvider extends AbstractAuthProvider {
    async authenticate() {
      const callbackUrl = window.location.href;
      window.location.href =
        "/api/auth/signin/github?callbackUrl=" + encodeURIComponent(callbackUrl);
      return {};
    }
    async getToken() {
      return { id_token: "" };
    }
    async getUser() {
      try {
        const res = await fetch("/api/auth/session");
        const session = await res.json();
        return session && session.user ? session.user : false;
      } catch {
        return false;
      }
    }
    async logout() {
      const { csrfToken } = await fetch("/api/auth/csrf").then((r) => r.json());
      await fetch("/api/auth/signout", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrfToken,
          callbackUrl: window.location.origin + "/admin/index.html",
        }),
      });
    }
  }

  // Local mode (TINA_PUBLIC_IS_LOCAL=true) skips GitHub sign-in; the local
  // backend doesn't enforce auth.
  class LocalBypassAuthProvider extends AbstractAuthProvider {
    async authenticate() { return {}; }
    async getToken() { return { id_token: "" }; }
    async getUser() { return { name: "Local Editor" }; }
    async logout() {}
  }

  const branch = process.env.GITHUB_BRANCH ||
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.HEAD ||
    "main"
  const isLocal = process.env.${args.isLocalEnvVarName} === 'true'

  export default defineConfig({
    contentApiUrlOverride: "/api/tina/gql",
    authProvider: isLocal
      ? new LocalBypassAuthProvider()
      : new GitHubAuthProvider(),
    branch,
    build: {
      outputFolder: "admin",
      publicFolder: "${args.publicFolder}",
    },
    media: {
      tina: {
        mediaRoot: "",
        publicFolder: "${args.publicFolder}",
      },
    },
    // See docs on content modeling: https://tina.io/docs/r/content-modelling-collections/
    schema: {
      collections: [
        {
          name: 'post',
          label: 'Posts',
          path: 'content/posts',
          fields: [
            { type: 'string', name: 'title', label: 'Title', isTitle: true, required: true },
            { type: 'rich-text', name: 'body', label: 'Body', isBody: true },
          ],
        },
      ],
    },
  });
`;
};

export const generateConfig = (args: ConfigTemplateArgs) => {
  if (args.config.gitOnly) {
    return generateGitOnlyConfig(args);
  }
  const isUsingTinaCloud =
    !args.selfHosted || args.config.authProvider?.name === 'tina-cloud';

  let extraImports = '';
  if (args.selfHosted) {
    // add imports for auth provider
    if (args.config.authProvider) {
      extraImports =
        extraImports +
        makeImportString(args.config.authProvider?.configImports);
    }
    // if wer are not using TinaCloud, we need to import the local auth provider
    if (!isUsingTinaCloud) {
      extraImports =
        extraImports + `\nimport { LocalAuthProvider } from "tinacms";`;
    }
  }

  return `
  import { defineConfig } from "tinacms";
  ${extraImports}
  ${args.extraText || ''}
  
  // Your hosting provider likely exposes this as an environment variable
  const branch = process.env.GITHUB_BRANCH ||
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.HEAD ||
    "main"
  ${
    (args.isLocalEnvVarName &&
      args.selfHosted &&
      `const isLocal = process.env.${args.isLocalEnvVarName} === 'true'`) ||
    ''
  }
  export default defineConfig({
    ${
      args.selfHosted && !isUsingTinaCloud
        ? `contentApiUrlOverride: "/api/tina/gql",`
        : ''
    }
    branch,
    ${
      args.selfHosted && !isUsingTinaCloud
        ? `authProvider: isLocal
    ? new LocalAuthProvider()
    :${args.config?.authProvider.configAuthProviderClass},`
        : ''
    }
    ${
      isUsingTinaCloud
        ? `// Get this from tina.io
        clientId: process.env.NEXT_PUBLIC_TINA_CLIENT_ID,`
        : ''
    }
    ${
      isUsingTinaCloud
        ? `// Get this from tina.io
    token: process.env.TINA_TOKEN,`
        : ''
    }

    ${clientConfig(args.isForestryMigration)}
    build: {
      outputFolder: "admin",
      publicFolder: "${args.publicFolder}",
    },
    // Uncomment to allow cross-origin requests from non-localhost origins
    // during local development (e.g. GitHub Codespaces, Gitpod, Docker).
    // Use 'private' to allow all private-network IPs (WSL2, Docker, etc.)
    // server: {
    //   allowedOrigins: ['https://your-codespace.github.dev'],
    // },
    media: {
      tina: {
        mediaRoot: "",
        publicFolder: "${args.publicFolder}",
      },
    },
    // See docs on content modeling for more info on how to setup new content models: https://tina.io/docs/r/content-modelling-collections/
    schema: {
      collections: ${generateCollectionString(args)},
    },
  });  
`;
};
