import Link from "next/link";

export default function NotFound() {
  return (
    <main className="war-grid flex min-h-[100dvh] flex-col items-center justify-center px-5 text-center">
      <h1 className="font-display text-4xl text-[var(--ink)]">Lost sector</h1>
      <p className="mt-3 text-sm text-[var(--ink-muted)]">
        This coordinate is not on the board.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-sm bg-[var(--signal)] px-5 py-2.5 text-sm font-semibold text-white"
      >
        Back to base
      </Link>
    </main>
  );
}
