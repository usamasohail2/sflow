"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { SectorEditor } from "@/components/SectorEditor";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import type { Sector } from "@/lib/gameTypes";

export default function EditPage() {
  const { data: session, status } = useSession();
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/sectors", { cache: "no-store" });
    const data = (await res.json()) as { sectors: Sector[] };
    setSectors(data.sectors || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    if (status !== "authenticated") {
      setError("Sign in with Google before saving — otherwise nothing is stored.");
      setSaving(false);
      return;
    }
    try {
      const res = await fetch("/api/sectors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectors }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Save failed");
      } else {
        setSectors(data.sectors);
        setSavedMsg(
          `Saved permanently · ${data.sectors.length} sector${
            data.sectors.length === 1 ? "" : "s"
          }`
        );
        // Reload from server to prove round-trip
        window.setTimeout(() => void load(), 400);
      }
    } catch {
      setError("Network error — save did not reach the server");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--surface)]">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/play" className="text-xs text-[var(--ink-muted)]">
            ← Play
          </Link>
          <span className="font-display text-sm text-[var(--ink)]">
            Define territories
          </span>
          <span className="hidden font-mono text-[9px] text-[var(--ink-faint)] sm:inline">
            {sectors.length} loaded · durable storage
          </span>
        </div>
        {status === "authenticated" && session?.user ? (
          <span className="font-mono text-[10px] text-[var(--sand)]">
            {session.user.name || session.user.email}
          </span>
        ) : (
          <GoogleSignInButton callbackUrl="/edit" label="Sign in to save" />
        )}
      </header>
      {error && (
        <p className="border-b border-[var(--signal)]/40 bg-[var(--signal)]/10 px-4 py-2 text-xs text-[var(--signal-bright)]">
          {error}
        </p>
      )}
      {savedMsg && (
        <p className="border-b border-[var(--field)]/40 bg-[var(--field)]/15 px-4 py-2 text-xs text-[var(--field-bright)]">
          ✓ {savedMsg}
        </p>
      )}
      <SectorEditor
        sectors={sectors}
        onChange={(next) => {
          setSectors(next);
          setSavedMsg(null);
        }}
        onSave={save}
        saving={saving}
      />
    </div>
  );
}
