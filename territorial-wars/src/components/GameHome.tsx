import Link from "next/link";

export function GameHome() {
  return (
    <main className="war-grid relative min-h-[100dvh] overflow-hidden">
      <div className="war-scanline" aria-hidden />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="animate-war-pulse h-[min(70vw,28rem)] w-[min(70vw,28rem)] rounded-full border border-[var(--signal)]/30"
          aria-hidden
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col justify-end px-5 pb-16 pt-10 sm:justify-center sm:pb-20 sm:pt-16">
        <p className="animate-war-rise font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--sand)]">
          Sector conflict · Islamabad
        </p>

        <h1 className="animate-war-rise-delay mt-4 max-w-[14ch] font-display text-[clamp(2.6rem,11vw,5.5rem)] leading-[0.92] tracking-tight text-[var(--ink)]">
          Islamabad
          <span className="block text-[var(--signal-bright)]">
            Territorial Wars
          </span>
        </h1>

        <p className="animate-war-rise-delay-2 mt-5 max-w-md text-[15px] leading-relaxed text-[var(--ink-muted)] sm:text-base">
          Claim sectors. Hold ground. Outplay rivals across the capital map.
        </p>

        <div className="animate-war-rise-delay-2 mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/play"
            className="inline-flex items-center justify-center rounded-sm bg-[var(--signal)] px-6 py-3 text-sm font-semibold tracking-wide text-white transition hover:bg-[var(--signal-bright)]"
          >
            Enter the map
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
            Early build · v0
          </span>
        </div>
      </div>
    </main>
  );
}
