import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface-raised p-6 shadow-sm">
        <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
          Sign in
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Use your Google account to continue on Explore.
        </p>
        <form
          className="mt-5"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-wash"
          >
            Continue with Google
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-ink-faint">
          <a href="/" className="underline-offset-2 hover:underline">
            Back to map
          </a>
        </p>
      </div>
    </main>
  );
}
