import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="war-grid flex min-h-[100dvh] flex-col items-center justify-center px-5">
      <h1 className="font-display text-3xl text-[var(--ink)]">Sign in</h1>
      <p className="mt-2 max-w-sm text-center text-sm text-[var(--ink-muted)]">
        Google sign-in unlocks villagers, houses, and invites.
      </p>
      <div className="mt-6">
        <GoogleSignInButton callbackUrl="/play" />
      </div>
      <Link href="/" className="mt-8 text-xs text-[var(--ink-faint)]">
        Back
      </Link>
    </main>
  );
}
