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

/** e.g. "SillyPanda" or "HappyRabbit" */
export function generateUsername(): string {
  return `${pick(ADJECTIVES)}${pick(ANIMALS)}`;
}
