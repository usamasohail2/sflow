/** Friendly relative time: "3 mins ago", "4 hours ago", "13 days ago". */
export function timeAgo(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return min === 1 ? "1 min ago" : `${min} mins ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return hr === 1 ? "1 hour ago" : `${hr} hours ago`;
  }
  const days = Math.floor(hr / 24);
  if (days < 30) {
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}
