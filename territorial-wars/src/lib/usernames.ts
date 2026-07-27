const ADJ = [
  "Swift",
  "Bold",
  "Quiet",
  "Bright",
  "Iron",
  "Gold",
  "Wild",
  "Keen",
  "Calm",
  "Sharp",
];
const NOUN = [
  "Settler",
  "Scout",
  "Ranger",
  "Farmer",
  "Warden",
  "Rider",
  "Builder",
  "Raider",
  "Keeper",
  "Pilot",
];

export function generateUsername(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)]!;
  const n = NOUN[Math.floor(Math.random() * NOUN.length)]!;
  const num = Math.floor(10 + Math.random() * 89);
  return `${a}${n}${num}`;
}
