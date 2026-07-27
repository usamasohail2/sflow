/**
 * Attack notification emails via Resend (https://resend.com).
 * Silently no-ops unless RESEND_API_KEY is configured.
 * Optional: EMAIL_FROM (defaults to onboarding@resend.dev).
 */

const API_KEY = process.env.RESEND_API_KEY;
const FROM =
  process.env.EMAIL_FROM || "Islamabad Territorial Wars <onboarding@resend.dev>";
const SITE = process.env.AUTH_URL || "https://itw-sectors.vercel.app";

export async function sendAttackEmail(params: {
  toEmail: string;
  defenderName: string;
  attackerName: string;
  sectorName: string;
  win: boolean;
  damage: number;
  destroyed: string | null;
  houseDestroyed: boolean;
  lootedGold: number;
}): Promise<void> {
  if (!API_KEY || !params.toEmail) return;

  const {
    toEmail,
    defenderName,
    attackerName,
    sectorName,
    win,
    damage,
    destroyed,
    houseDestroyed,
    lootedGold,
  } = params;

  const headline = win
    ? `${attackerName} raided your village in ${sectorName}`
    : `${attackerName} attacked ${sectorName} — your defenses held`;

  const lines: string[] = [
    `Commander ${defenderName},`,
    ``,
    win
      ? `${attackerName} broke through your defenses in ${sectorName}.`
      : `${attackerName} marched on ${sectorName}, but your defenses held the line.`,
    `Damage taken: ${damage} hp`,
  ];
  if (destroyed) lines.push(`Destroyed: ${destroyed}`);
  if (houseDestroyed)
    lines.push(
      `Your base was razed — gathering is paused until you rebuild it.`
    );
  if (lootedGold > 0) lines.push(`Gold looted: ${lootedGold}`);
  lines.push(``, `Return to the battlefield: ${SITE}/play`);

  const text = lines.join("\n");
  const html = `
  <div style="font-family:ui-monospace,Menlo,monospace;background:#10150f;color:#e8ebe4;padding:24px;border-radius:8px">
    <p style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#8a937f;margin:0 0 8px">Islamabad Territorial Wars</p>
    <h2 style="margin:0 0 12px;color:${win ? "#ff8a7a" : "#8fe098"}">${headline}</h2>
    <p style="margin:0 0 6px">Damage taken: <strong>${damage} hp</strong></p>
    ${destroyed ? `<p style="margin:0 0 6px">Destroyed: <strong>${destroyed}</strong></p>` : ""}
    ${houseDestroyed ? `<p style="margin:0 0 6px;color:#ff8a7a"><strong>Your base was razed</strong> — gathering is paused until you rebuild it.</p>` : ""}
    ${lootedGold > 0 ? `<p style="margin:0 0 6px">Gold looted: <strong>${lootedGold}</strong></p>` : ""}
    <a href="${SITE}/play" style="display:inline-block;margin-top:14px;background:#e23b2f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:bold">Defend your sector</a>
  </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [toEmail],
        subject: `⚔ ${headline}`,
        text,
        html,
      }),
    });
    if (!res.ok) {
      console.error("Attack email failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Attack email error:", err);
  }
}
