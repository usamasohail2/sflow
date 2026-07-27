import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export function isGoogleAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH_GOOGLE_ID?.trim() &&
      process.env.AUTH_GOOGLE_SECRET?.trim() &&
      process.env.AUTH_SECRET?.trim()
  );
}

const googleConfigured = isGoogleAuthConfigured();

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: googleConfigured
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID!,
          clientSecret: process.env.AUTH_GOOGLE_SECRET!,
        }),
      ]
    : [],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, account, profile, user }) {
      if (account?.providerAccountId) {
        token.uid = account.providerAccountId;
      } else if (user?.id) {
        token.uid = user.id;
      }
      // Always keep a stable id — empty uid made /api/game treat sessions as logged out
      if (!token.uid && token.sub) {
        token.uid = token.sub;
      }
      if (profile && "picture" in profile && typeof profile.picture === "string") {
        token.picture = profile.picture;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.image =
          (token.picture as string | undefined) ?? session.user.image;
        (session.user as { id?: string }).id = String(
          token.uid ?? token.sub ?? ""
        );
      }
      return session;
    },
  },
  trustHost: true,
});
