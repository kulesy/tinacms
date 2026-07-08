// auth-astro (Auth.js for Astro) config. Adding the auth() integration to
// astro.config auto-registers /api/auth/*; this file just defines the provider.
// auth-astro is a community package (pending next-auth PR #9856).
export const astroAuthConfigTemplate = () => {
  return `import GitHub from '@auth/core/providers/github'
  import { defineConfig } from 'auth-astro'

  export default defineConfig({
    providers: [
      GitHub({
        clientId: import.meta.env.GITHUB_CLIENT_ID,
        clientSecret: import.meta.env.GITHUB_CLIENT_SECRET,
        // 'repo' lets an editor's login commit content as themselves.
        authorization: { params: { scope: 'repo read:user' } },
      }),
    ],
    callbacks: {
      async jwt({ token, account }) {
        // account is only present on the first sign-in call.
        if (account) {
          token.accessToken = account.access_token
        }
        return token
      },
      async session({ session, token }) {
        session.accessToken = token.accessToken
        return session
      },
    },
  })`;
};
