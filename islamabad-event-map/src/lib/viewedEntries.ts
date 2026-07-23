const STORAGE_KEY = "isb-explore-viewed-entries";

function readIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeIds(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore quota / private mode
  }
}

export function loadViewedEntryIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  return readIds();
}

export function markEntryViewed(id: string): Set<string> {
  const ids = readIds();
  if (ids.has(id)) return ids;
  ids.add(id);
  writeIds(ids);
  return ids;
}
