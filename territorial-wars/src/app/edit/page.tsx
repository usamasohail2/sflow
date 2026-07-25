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

  const load = useCallback(async () => {
    const res = await fetch("/api/sectors");
    const data = (await res.json()) as { sectors: Sector[] };
    setSectors(data.sectors || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
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
      }
    } catch {
      setError("Network error");
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
      <SectorEditor
        sectors={sectors}
        onChange={setSectors}
        onSave={save}
        saving={saving}
      />
    </div>
  );
}
