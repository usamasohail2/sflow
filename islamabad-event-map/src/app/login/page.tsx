import { auth, isGoogleAuthConfigured, signIn } from "@/auth";
import { redirect } from "next/navigation";

function GoogleGlyph({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7 12.9 19.6C14.7 15.1 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.2 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8H6.2C9.7 37.1 16.3 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4 5.3v.1l6.3 5.3C40.4 36.1 44 30.7 44 24c0-1.3-.1-2.5-.4-3.5z"
      />
    </svg>
  );
}

function errorMessage(code?: string): string | null {
  if (!code) return null;
  switch (code) {
    case "Configuration":
      return "Sign-in isn’t configured yet. Add Google OAuth keys to .env.local.";
    case "AccessDenied":
      return "Access denied — try another Google account.";
    case "OAuthAccountNotLinked":
      return "This email is already linked another way.";
    case "OAuthCallback":
    case "Callback":
      return "Google sign-in failed. Check the OAuth client redirect URI.";
    default:
      return "Couldn’t sign in. Try again.";
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { error?: string; callbackUrl?: string };
}) {
  const session = await auth();
  if (session?.user) {
    redirect(searchParams?.callbackUrl || "/");
  }

  const configured = isGoogleAuthConfigured();
  const err = errorMessage(searchParams?.error);
  const callbackUrl = searchParams?.callbackUrl || "/";

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-wash px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Islamabad Explore
        </p>
        <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink">
          Sign in
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Use Google so explorers can see your name on the map.
        </p>

        {err && (
          <p className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
            {err}
          </p>
        )}

        {configured ? (
          <form
            className="mt-5"
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: callbackUrl });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-wash"
            >
              <GoogleGlyph className="h-5 w-5" />
              Continue with Google
            </button>
          </form>
        ) : (
          <div className="mt-5 space-y-3 rounded-xl border border-line bg-wash px-3 py-3 text-xs leading-relaxed text-ink-muted">
            <p className="font-semibold text-ink">Google OAuth not set up yet</p>
            <ol className="list-decimal space-y-1.5 pl-4">
              <li>
                Open{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-ink underline-offset-2 hover:underline"
                >
                  Google Cloud Credentials
                </a>
              </li>
              <li>
                Create an OAuth client (Web application)
              </li>
              <li>
                Add redirect URI:{" "}
                <code className="rounded bg-surface px-1 py-0.5 text-[10px] text-ink">
                  http://localhost:3000/api/auth/callback/google
                </code>
              </li>
              <li>
                Paste Client ID / Secret into{" "}
                <code className="rounded bg-surface px-1 py-0.5 text-[10px] text-ink">
                  AUTH_GOOGLE_ID
                </code>{" "}
                and{" "}
                <code className="rounded bg-surface px-1 py-0.5 text-[10px] text-ink">
                  AUTH_GOOGLE_SECRET
                </code>
              </li>
              <li>Restart the dev server</li>
            </ol>
          </div>
        )}

        <p className="mt-4 text-center text-xs text-ink-faint">
          <a href="/" className="underline-offset-2 hover:underline">
            Back to map
          </a>
        </p>
      </div>
    </main>
  );
}
