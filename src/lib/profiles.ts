import { getSupabaseAdmin, hasSupabase } from "@/lib/supabase";

export type UserProfile = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  provider: string;
  createdAt: number;
  lastSeen: number;
};

type ProfileRow = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  provider: string;
  created_at: string;
  last_seen: string;
};

function rowToProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    provider: row.provider || "google",
    createdAt: new Date(row.created_at).getTime() || Date.now(),
    lastSeen: new Date(row.last_seen).getTime() || Date.now(),
  };
}

/** Upsert a Google (or other) signed-in user into Supabase profiles */
export async function upsertSignedInProfile(input: {
  providerAccountId?: string | null;
  provider?: string | null;
  email?: string | null;
  name?: string | null;
  image?: string | null;
}): Promise<void> {
  if (!hasSupabase()) return;
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const id = (
    input.providerAccountId ||
    input.email ||
    ""
  ).trim();
  if (!id) return;

  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("profiles").upsert(
    {
      id,
      email: input.email?.trim() || null,
      name: input.name?.trim().slice(0, 80) || null,
      image: input.image?.trim() || null,
      provider: (input.provider || "google").slice(0, 32),
      last_seen: nowIso,
    },
    { onConflict: "id" }
  );

  if (error) {
    throw error;
  }
}

export async function listProfiles(): Promise<UserProfile[]> {
  if (!hasSupabase()) return [];
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, name, image, provider, created_at, last_seen")
    .order("last_seen", { ascending: false })
    .limit(500);

  if (error) throw error;
  return (data as ProfileRow[] | null)?.map(rowToProfile) ?? [];
}
