import { auth, isGoogleAuthConfigured } from "@/auth";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { redirect } from "next/navigation";

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
          <div className="mt-5">
            <GoogleSignInButton callbackUrl={callbackUrl} />
          </div>
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
              <li>Create an OAuth client (Web application)</li>
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
