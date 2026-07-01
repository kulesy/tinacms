// NextAuth route for git-only self-hosting. Editors sign in with GitHub; the
// `repo` scope lets the content API commit on their behalf, and the jwt/session
// callbacks carry the access token through to the API route.
export const nextAuthRouteTemplate = () => {
  return `import NextAuth from 'next-auth'
  import GitHubProvider from 'next-auth/providers/github'

  export default NextAuth({
    providers: [
      GitHubProvider({
        clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
        clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
        authorization: { params: { scope: 'repo read:user' } },
      }),
    ],
    callbacks: {
      async jwt({ token, account }) {
        // Persist the GitHub access token the first time the user signs in.
        if (account?.access_token) {
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
