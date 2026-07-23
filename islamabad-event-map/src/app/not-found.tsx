import Link from "next/link";
import { Header } from "@/components/Header";
import { KohLost } from "@/components/KohLost";

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="relative flex min-h-[calc(100vh-72px)] flex-col items-center justify-center overflow-hidden bg-surface px-6 py-16">
        <div
          className="pointer-events-none absolute inset-0 loader-wash opacity-60"
          aria-hidden
        />

        <div className="relative z-10 flex max-w-sm flex-col items-center text-center">
          <KohLost />

          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2d8a4e]">
            Off the map
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
            404
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Koh wandered past Margalla and lost the trail. This page isn’t on
            the map.
          </p>

          <Link
            href="/"
            className="btn-primary mt-8 rounded-full border px-5 py-2.5 text-sm font-semibold"
          >
            Back to Islamabad Explore
          </Link>
        </div>
      </main>
    </>
  );
}
