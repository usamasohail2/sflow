import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { upsertSignedInProfile } from "@/lib/profiles";

export function isGoogleAuthConfigured(): boolean {
  return Boolean(
    process.env.AUTH_GOOGLE_ID?.trim() &&
      process.env.AUTH_GOOGLE_SECRET?.trim()
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
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  events: {
    async signIn({ user, account }) {
      try {
        await upsertSignedInProfile({
          providerAccountId: account?.providerAccountId,
          provider: account?.provider,
          email: user.email,
          name: user.name,
          image: user.image,
        });
      } catch (error) {
        console.error("Failed to upsert signed-in profile:", error);
      }
    },
  },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      if (
        profile &&
        "picture" in profile &&
        typeof profile.picture === "string"
      ) {
        token.picture = profile.picture;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.image =
          (token.picture as string | undefined) ?? session.user.image;
      }
      return session;
    },
  },
  trustHost: true,
});
