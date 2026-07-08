import http from 'http';
import type { AddressInfo } from 'net';
import { execFile } from 'child_process';
import crypto from 'crypto-js';
import prompts from 'prompts';

import { cmdText, linkText, logText } from '../../../utils/theme';
import { logger } from '../../../logger';
import type { Config } from './types';

// The dev app's Auth.js callback (served by auth-astro). Registered on the App
// up front so per-user sign-in works without a second trip to GitHub's settings.
// 4321 is Astro's default dev port.
const DEV_AUTH_CALLBACK = 'http://localhost:4321/api/auth/callback/github';

const envKeys = [
  'GITHUB_OWNER',
  'GITHUB_REPO',
  'GITHUB_BRANCH',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_APP_SLUG',
  'AUTH_SECRET',
  'AUTH_TRUST_HOST',
] as const;

type CreatedApp = { slug: string; client_id: string; client_secret: string };

const openBrowser = (url: string) => {
  // Pass the URL as a separate argv entry (never interpolated into a shell
  // command line) so an attacker-influenced owner/repo/slug can't inject shell
  // syntax. On Windows `start` is a cmd builtin, so it's invoked via `cmd /c`.
  const { cmd, args }: { cmd: string; args: string[] } =
    process.platform === 'darwin'
      ? { cmd: 'open', args: [url] }
      : process.platform === 'win32'
        ? { cmd: 'cmd', args: ['/c', 'start', '', url] }
        : { cmd: 'xdg-open', args: [url] };
  execFile(cmd, args, () => {
    // If the browser can't be opened we've already printed the URL to visit.
  });
};

const successPage = (slug: string) =>
  `<!doctype html><html><body style="font-family:system-ui;max-width:32rem;margin:4rem auto">
   <h2>GitHub App "${slug}" created ✅</h2>
   <p>Credentials were written to your project. You can close this tab and return to the terminal.</p>
   </body></html>`;

const formPage = (action: string, manifest: string) =>
  `<!doctype html><html><body onload="document.forms[0].submit()">
   <form method="post" action="${action}">
     <input type="hidden" name="manifest" value='${manifest.replace(/'/g, '&#39;')}' />
     <noscript><button type="submit">Continue to GitHub</button></noscript>
   </form></body></html>`;

// GitHub's App Manifest flow: serve a page that POSTs a prefilled app definition
// to GitHub, let the developer confirm, then catch the one-time ?code on the
// redirect and exchange it for the app's credentials. Same shape as
// create-probot-app, so no secret is ever copied by hand.
const createAppViaManifest = async (
  owner: string,
  repo: string
): Promise<CreatedApp> => {
  let resolveCode: (code: string) => void;
  let rejectCode: (err: Error) => void;
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  let action = '';
  let manifest = '';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        code
          ? successPage(owner)
          : '<p>Missing ?code from GitHub. Return to the terminal.</p>'
      );
      if (code) resolveCode(code);
      else rejectCode(new Error('GitHub did not return a code'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(formPage(action, manifest));
  });

  await new Promise<void>((res) => server.listen(0, 'localhost', res));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://localhost:${port}`;

  // A GitHub App name must be globally unique; suffix it so first-run works.
  const suffix = crypto.lib.WordArray.random(3).toString();
  manifest = JSON.stringify({
    name: `tina-${repo || 'site'}-${suffix}`.slice(0, 34),
    url: origin,
    redirect_url: `${origin}/callback`,
    callback_urls: [DEV_AUTH_CALLBACK],
    public: false,
    default_permissions: { contents: 'write', metadata: 'read' },
    default_events: [],
  });
  // Personal account. Orgs use /organizations/<org>/settings/apps/new instead.
  action = 'https://github.com/settings/apps/new';

  logger.info(
    `Opening your browser to create the GitHub App. If it doesn't open, visit:\n  ${linkText(
      origin
    )}`
  );
  openBrowser(origin);

  try {
    const code = await codePromise;
    const conv = await fetch(
      `https://api.github.com/app-manifests/${code}/conversions`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'tinacms-init',
        },
      }
    );
    if (!conv.ok) {
      throw new Error(`App conversion failed: ${conv.status} ${await conv.text()}`);
    }
    return (await conv.json()) as CreatedApp;
  } finally {
    server.close();
  }
};

// Auth setup for the git-only path: collect owner/repo, create the GitHub App
// via the manifest flow, and write its credentials + an Auth.js secret into
// config.envVars so apply() can drop them into .env.
export const setupGitHubApp = async ({ config }: { config: Config }) => {
  const { owner, repo } = await prompts([
    {
      name: 'owner',
      type: 'text',
      message: 'What is your GitHub owner (username or org)?',
      initial: process.env.GITHUB_OWNER,
    },
    {
      name: 'repo',
      type: 'text',
      message: 'What is your GitHub repo name? Ex: my-nextjs-app',
      initial: process.env.GITHUB_REPO,
    },
  ]);

  const { createNow } = await prompts([
    {
      name: 'createNow',
      type: 'confirm',
      initial: true,
      message:
        'Create the GitHub App now (opens your browser, no secret to copy)?',
    },
  ]);

  const env: Record<(typeof envKeys)[number], string> = {
    GITHUB_OWNER: owner || '',
    GITHUB_REPO: repo || '',
    GITHUB_BRANCH: 'main',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    GITHUB_APP_SLUG: '',
    AUTH_SECRET: crypto.lib.WordArray.random(32).toString(),
    AUTH_TRUST_HOST: 'true',
  };

  if (createNow) {
    try {
      const app = await createAppViaManifest(owner || '', repo || '');
      env.GITHUB_CLIENT_ID = app.client_id;
      env.GITHUB_CLIENT_SECRET = app.client_secret;
      env.GITHUB_APP_SLUG = app.slug;
      const installUrl = `https://github.com/apps/${app.slug}/installations/new`;
      logger.info(`GitHub App ${cmdText(app.slug)} created. ✅`);
      logger.info(
        `Install it on ${logText(`${owner}/${repo}`)} to grant commit access:\n  ${linkText(
          installUrl
        )}`
      );
      openBrowser(installUrl);
    } catch (e) {
      logger.warn(
        `Could not finish GitHub App creation (${
          (e as Error).message
        }). You can set GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET in .env later.`
      );
    }
  }

  for (const key of envKeys) {
    config.envVars.push({ key, value: env[key] });
  }
};
