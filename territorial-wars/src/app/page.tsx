import Link from "next/link";

export default function HomePage() {
  return (
    <main className="war-grid relative min-h-[100dvh] overflow-hidden">
      <div className="war-scanline" aria-hidden />
      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col justify-end px-5 pb-16 pt-10 sm:justify-center sm:pb-20">
        <p className="animate-war-rise font-mono text-[11px] uppercase tracking-[0.28em] text-[var(--sand)]">
          Settle a sector · auto-gather · raid rivals
        </p>
        <h1 className="animate-war-rise-delay mt-4 max-w-[14ch] font-display text-[clamp(2.6rem,11vw,5.5rem)] leading-[0.92] tracking-tight text-[var(--ink)]">
          Islamabad
          <span className="block text-[var(--signal-bright)]">
            Territorial Wars
          </span>
        </h1>
        <p className="animate-war-rise-delay-2 mt-5 max-w-md text-[15px] leading-relaxed text-[var(--ink-muted)]">
          Settle in an Islamabad sector with others. Start with a house and a
          villager who gathers on their own — explore for hidden caches, then
          build defenses and raid rival villages.
        </p>
        <div className="animate-war-rise-delay-2 mt-8 flex flex-wrap gap-3">
          <Link
            href="/play"
            className="inline-flex items-center justify-center rounded-sm bg-[var(--signal)] px-6 py-3 text-sm font-semibold text-white"
          >
            Play now
          </Link>
          <Link
            href="/edit"
            className="inline-flex items-center justify-center rounded-sm border border-[var(--line-strong)] px-6 py-3 text-sm font-semibold text-[var(--ink)]"
          >
            Draw sectors
          </Link>
        </div>
      </div>
    </main>
  );
}
