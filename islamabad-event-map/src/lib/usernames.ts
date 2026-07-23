/** Playful anonymous display names when a commenter skips leaving a name. */

const ADJECTIVES = [
  "Silly",
  "Happy",
  "Cozy",
  "Cheeky",
  "Lucky",
  "Sunny",
  "Gentle",
  "Jolly",
  "Merry",
  "Fuzzy",
  "Bubbly",
  "Cuddly",
  "Peppy",
  "Zesty",
  "Dapper",
  "Snug",
  "Chipper",
  "Whimsy",
  "Breezy",
  "Soft",
];

const ANIMALS = [
  "Panda",
  "Rabbit",
  "Fox",
  "Otter",
  "Koala",
  "Puppy",
  "Kitten",
  "Penguin",
  "Duckling",
  "Squirrel",
  "Hedgehog",
  "Bunny",
  "Bear",
  "Owl",
  "Dove",
  "Lamb",
  "Fawn",
  "Sparrow",
  "Seal",
  "Corgi",
];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** e.g. "SillyPanda" or "HappyRabbit" */
export function generateUsername(): string {
  return `${pick(ADJECTIVES)}${pick(ANIMALS)}`;
}

/** Stable playful name from a visitor id / seed */
export function generateUsernameFromSeed(seed: string): string {
  const h = hashString(seed || "explorer");
  const adjective = ADJECTIVES[h % ADJECTIVES.length]!;
  const animal = ANIMALS[Math.floor(h / ADJECTIVES.length) % ANIMALS.length]!;
  return `${adjective}${animal}`;
}

