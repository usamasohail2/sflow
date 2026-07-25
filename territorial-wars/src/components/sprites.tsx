type SpriteProps = {
  className?: string;
  title?: string;
};

/** Cute chibi villager — walks or digs when flagged. */
export function VillagerSprite({
  className = "",
  digging = false,
  walking = false,
  title = "Villager",
}: SpriteProps & { digging?: boolean; walking?: boolean }) {
  return (
    <svg
      className={`villager-sprite ${digging ? "is-digging" : ""} ${walking ? "is-walking" : ""} ${className}`}
      viewBox="0 0 32 32"
      width="48"
      height="48"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* soft ground shadow */}
      <ellipse cx="16" cy="29.5" rx="7" ry="1.6" fill="rgba(0,0,0,0.35)" />

      {/* boots */}
      <rect x="11" y="25" width="4" height="3" rx="1" fill="#5c4030" />
      <rect x="17" y="25" width="4" height="3" rx="1" fill="#5c4030" />

      {/* legs */}
      <rect x="12" y="21" width="3" height="5" rx="1" fill="#3d5c46" />
      <rect x="17" y="21" width="3" height="5" rx="1" fill="#3d5c46" />

      {/* body / tunic */}
      <rect x="11" y="14" width="10" height="9" rx="3" fill="#6fbf73" />
      <rect x="13" y="16" width="6" height="5" rx="1.5" fill="#8fd48a" />

      {/* scarf */}
      <rect x="12" y="14" width="8" height="2" rx="1" fill="#e23b2f" />

      {/* head */}
      <circle cx="16" cy="10" r="5.2" fill="#f3c7a1" />
      {/* cheeks */}
      <circle cx="12.6" cy="11" r="1.1" fill="#f0a090" opacity="0.85" />
      <circle cx="19.4" cy="11" r="1.1" fill="#f0a090" opacity="0.85" />
      {/* eyes */}
      <circle cx="14.2" cy="9.6" r="0.85" fill="#2a241c" />
      <circle cx="17.8" cy="9.6" r="0.85" fill="#2a241c" />
      <circle cx="14.45" cy="9.35" r="0.28" fill="#fff" />
      <circle cx="18.05" cy="9.35" r="0.28" fill="#fff" />
      {/* smile */}
      <path
        d="M14.5 11.6c.7.7 2.3.7 3 0"
        fill="none"
        stroke="#b56b55"
        strokeWidth="0.7"
        strokeLinecap="round"
      />

      {/* hair tuft */}
      <path
        d="M11.5 8.2c1.2-3 4.2-3.8 7.2-2.2-.8 1.2-2.2 1.8-3.6 1.9-1.3.1-2.5-.2-3.6-.8z"
        fill="#3b2a1e"
      />

      {/* shovel — swings when digging */}
      <g className="villager-tool" transform="translate(21 14)">
        <rect x="-0.8" y="-1" width="1.6" height="11" rx="0.7" fill="#8b5a2b" />
        <path
          d="M-3.2 9.2 L3.2 9.2 L2.4 13.2 Q0 14.4 -2.4 13.2 Z"
          fill="#9aa3a0"
          stroke="#5c6562"
          strokeWidth="0.35"
        />
        <rect x="-1.4" y="-2.2" width="2.8" height="1.6" rx="0.5" fill="#6b4e2e" />
      </g>
    </svg>
  );
}

/** Stocked attack rocket — expended when you raid. */
export function RocketSprite({
  className = "",
  title = "Rocket",
}: SpriteProps) {
  return (
    <svg
      className={`house-sprite ${className}`}
      viewBox="0 0 32 32"
      width="44"
      height="44"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <ellipse cx="16" cy="29.5" rx="6" ry="1.5" fill="rgba(0,0,0,0.35)" />
      {/* exhaust plume */}
      <path
        d="M14.2 26.5 C13 28.2 12.2 29.8 13.4 30.2 C14.8 29.4 15.2 28 16 26.2 C16.8 28 17.2 29.4 18.6 30.2 C19.8 29.8 19 28.2 17.8 26.5 Z"
        fill="#e08a3a"
        opacity="0.9"
      />
      <path
        d="M14.8 25.8 C14.2 27.2 14.4 28.6 15.2 28.8 C15.8 28 16 27 16.2 25.6 C16.4 27 16.6 28 17.2 28.8 C18 28.6 18.2 27.2 17.6 25.8 Z"
        fill="#f0c56a"
      />
      {/* fins */}
      <path d="M11 22 L14.5 19.5 L14.5 23.5 Z" fill="#8a3a2a" />
      <path d="M21 22 L17.5 19.5 L17.5 23.5 Z" fill="#8a3a2a" />
      {/* body */}
      <rect x="13.2" y="8" width="5.6" height="16" rx="2.6" fill="#c4b089" />
      <rect x="13.2" y="8" width="2.8" height="16" rx="2.6" fill="#d8c9a0" />
      {/* band */}
      <rect x="13.2" y="14" width="5.6" height="2.2" fill="#6b4e2e" />
      {/* nose cone */}
      <path d="M13.4 9.2 L16 3.2 L18.6 9.2 Z" fill="#c45a3a" />
      <path d="M13.4 9.2 L16 3.2 L16 9.2 Z" fill="#e07048" />
      {/* tip highlight */}
      <circle cx="16" cy="5.2" r="0.7" fill="#f3d9a8" opacity="0.85" />
    </svg>
  );
}

/** Pine tree cluster — wood resource. */
export function TreeSprite({
  className = "",
  title = "Wood",
}: SpriteProps) {
  return (
    <svg
      className={`house-sprite ${className}`}
      viewBox="0 0 36 32"
      width="46"
      height="42"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <ellipse cx="18" cy="30" rx="9" ry="1.8" fill="rgba(0,0,0,0.35)" />
      {/* big pine */}
      <rect x="16.6" y="22" width="2.8" height="6" rx="1" fill="#6b4228" />
      <path d="M18 4 L25 14 H21.5 L26 21 H10 L14.5 14 H11 Z" fill="#2f6b3d" />
      <path d="M18 4 L25 14 H21.5 L26 21 H18 Z" fill="#3d8a50" />
      {/* small pine */}
      <rect x="8.2" y="24" width="2" height="4" rx="0.8" fill="#6b4228" />
      <path d="M9.2 14 L14 21.5 H11.8 L15 26 H3.5 L6.6 21.5 H4.5 Z" fill="#2f6b3d" />
      {/* logs */}
      <g transform="translate(25 25)">
        <rect x="0" y="0" width="8" height="2.6" rx="1.3" fill="#8b5a2b" />
        <circle cx="1.3" cy="1.3" r="1.1" fill="#c99b62" />
        <rect x="1" y="-2.4" width="8" height="2.6" rx="1.3" fill="#7a4d24" />
        <circle cx="2.3" cy="-1.1" r="1.1" fill="#c99b62" />
      </g>
    </svg>
  );
}

/** Rock pile — stone resource. */
export function StoneSprite({
  className = "",
  title = "Stone",
}: SpriteProps) {
  return (
    <svg
      className={`house-sprite ${className}`}
      viewBox="0 0 36 32"
      width="44"
      height="40"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <ellipse cx="18" cy="29" rx="10" ry="1.9" fill="rgba(0,0,0,0.35)" />
      {/* boulders */}
      <path d="M9 27 L11 18 L18 15 L24 18.5 L27 24 L24.5 27.5 Z" fill="#77857c" />
      <path d="M9 27 L11 18 L18 15 L18.5 27 Z" fill="#5d6a63" />
      <path d="M18 15 L24 18.5 L27 24 L21 22 Z" fill="#8f9c93" />
      {/* small rock */}
      <path d="M6 28 L7.5 24.5 L11.5 23.8 L13 27 L11 28.6 Z" fill="#8f9c93" />
      <path d="M6 28 L7.5 24.5 L9.5 24.2 L9 28.2 Z" fill="#6d7a71" />
      {/* right pebble */}
      <path d="M26 28 L27.5 25.5 L30.5 25.8 L31 28.2 Z" fill="#6d7a71" />
      {/* cracks */}
      <path
        d="M14 20 l2.5 2 M20 18 l1.5 2.5"
        stroke="#4a5550"
        strokeWidth="0.7"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** Grain mill with turning sails. */
export function MillSprite({
  className = "",
  title = "Grain mill",
}: SpriteProps) {
  return (
    <svg
      className={`house-sprite ${className}`}
      viewBox="0 0 36 32"
      width="52"
      height="46"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <ellipse cx="18" cy="30" rx="9" ry="1.8" fill="rgba(0,0,0,0.35)" />
      {/* tower */}
      <path d="M13 28 L15 12 H21 L23 28 Z" fill="#c9b490" />
      <path d="M13 28 L15 12 H18 V28 Z" fill="#b09a74" />
      {/* cap */}
      <path d="M14 12 L18 7 L22 12 Z" fill="#8a4f35" />
      {/* door + window */}
      <rect x="16.4" y="22.5" width="3.2" height="5.5" rx="0.8" fill="#6b4228" />
      <circle cx="18" cy="16.5" r="1.3" fill="#ffe08a" />
      {/* sails */}
      <g transform="translate(18 10)">
        <g className="mill-sails">
          <rect x="-0.6" y="-9" width="1.2" height="18" rx="0.5" fill="#e8ebe4" />
          <rect x="-9" y="-0.6" width="18" height="1.2" rx="0.5" fill="#e8ebe4" />
          <rect x="-0.6" y="-9" width="1.2" height="7" fill="#c4b089" />
          <rect x="2" y="-0.6" width="7" height="1.2" fill="#c4b089" />
        </g>
      </g>
      <circle cx="18" cy="10" r="1.1" fill="#5c4030" />
    </svg>
  );
}

/** Village storefront — awning, shop window, goods on display. */
export function WarehouseSprite({
  className = "",
  title = "Village store",
}: SpriteProps) {
  return (
    <svg
      className={`house-sprite ${className}`}
      viewBox="0 0 36 32"
      width="52"
      height="46"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <ellipse cx="18" cy="30" rx="11" ry="1.8" fill="rgba(0,0,0,0.35)" />
      {/* facade */}
      <rect x="5" y="12" width="26" height="16" rx="1.2" fill="#e8d5b5" />
      <rect x="5" y="12" width="26" height="3.2" fill="#d4c09a" />
      {/* flat cornice */}
      <rect x="4" y="10.2" width="28" height="2.4" rx="0.6" fill="#8a4f35" />
      <rect x="4.5" y="10.5" width="27" height="1" fill="#c45a3a" opacity="0.55" />
      {/* striped awning */}
      <path d="M6 14.5 H30 L28.5 18.5 H7.5 Z" fill="#e23b2f" />
      <path d="M9.5 14.5 H13.5 L12.6 18.5 H8.8 Z" fill="#f4f1ea" />
      <path d="M17 14.5 H21 L20.1 18.5 H16.3 Z" fill="#f4f1ea" />
      <path d="M24.5 14.5 H28.5 L27.4 18.5 H23.6 Z" fill="#f4f1ea" />
      <path
        d="M6 14.5 H30"
        stroke="#8a3a2a"
        strokeWidth="0.5"
        fill="none"
      />
      {/* shop window */}
      <rect x="7.5" y="19" width="11" height="7.5" rx="0.6" fill="#7ec8ff" />
      <rect
        x="7.5"
        y="19"
        width="11"
        height="7.5"
        rx="0.6"
        fill="none"
        stroke="#6b4228"
        strokeWidth="0.7"
      />
      <path d="M13 19 v7.5 M7.5 22.7 h11" stroke="#c4a86a" strokeWidth="0.45" />
      {/* goods in window */}
      <rect x="9" y="23.2" width="2.2" height="2.4" rx="0.3" fill="#c45a3a" />
      <rect x="12" y="23.6" width="2" height="2" rx="0.3" fill="#e8cf8a" />
      <circle cx="16.2" cy="24.6" r="1.1" fill="#6fbf73" />
      {/* door */}
      <rect x="21.5" y="19" width="7" height="9" rx="0.7" fill="#6b4228" />
      <circle cx="26.8" cy="23.6" r="0.55" fill="#e8cf8a" />
      {/* hanging sign */}
      <rect x="22.5" y="11.5" width="0.7" height="2.2" fill="#5c4030" />
      <rect x="20.2" y="13.2" width="5.2" height="2.6" rx="0.4" fill="#3d5c46" />
      <rect x="20.5" y="13.5" width="4.6" height="2" rx="0.3" fill="#6fbf73" />
    </svg>
  );
}

/** Dig-site shovel — clicker gold building. */
export function ShovelSprite({
  className = "",
  title = "Clicker shovel",
  digging = false,
}: SpriteProps & { digging?: boolean }) {
  return (
    <svg
      className={`house-sprite shovel-sprite ${digging ? "is-digging" : ""} ${className}`}
      viewBox="0 0 36 32"
      width="52"
      height="46"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <ellipse cx="18" cy="30" rx="10" ry="1.8" fill="rgba(0,0,0,0.35)" />
      {/* dirt mound */}
      <path
        d="M6 27 C8 22 12 20 18 19.5 C24 20 28 22 30 27 C26 29 22 29.5 18 29.5 C14 29.5 10 29 6 27 Z"
        fill="#8b5a2b"
      />
      <path
        d="M9 26 C12 22.8 15 21.2 18 20.8 C21 21.4 23.5 23 25.5 25.5 C22 27.2 19 27.6 16 27.4 C13 27.2 10.5 26.6 9 26 Z"
        fill="#a67c52"
      />
      {/* sparkles / gold flecks */}
      <circle cx="12" cy="24" r="0.9" fill="#e8cf8a" />
      <circle cx="22.5" cy="23.2" r="0.7" fill="#e8cf8a" />
      <circle cx="17" cy="25.5" r="0.55" fill="#f3e0a8" />
      {/* shovel planted in the mound */}
      <g className="shovel-tool" transform="translate(20 8) rotate(18)">
        <rect x="-1" y="0" width="2" height="14" rx="0.8" fill="#8b5a2b" />
        <rect x="-0.5" y="1" width="0.7" height="11" rx="0.3" fill="#c4a06a" opacity="0.45" />
        <rect x="-2.2" y="-2" width="4.4" height="2.4" rx="0.7" fill="#6b4e2e" />
        <path
          d="M-3.6 13.2 L3.6 13.2 L2.6 17.4 Q0 18.8 -2.6 17.4 Z"
          fill="#9aa3a0"
          stroke="#5c6562"
          strokeWidth="0.35"
        />
      </g>
    </svg>
  );
}

/** Village well with rope bucket. */
export function WellSprite({
  className = "",
  title = "Village well",
}: SpriteProps) {
  return (
    <svg
      className={`house-sprite ${className}`}
      viewBox="0 0 36 32"
      width="52"
      height="46"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <ellipse cx="18" cy="30" rx="9" ry="1.8" fill="rgba(0,0,0,0.35)" />
      {/* base */}
      <path d="M10 22 a8 4 0 0 1 16 0 v5 a8 4 0 0 1 -16 0 Z" fill="#7f8877" />
      <ellipse cx="18" cy="22" rx="8" ry="4" fill="#5d6a63" />
      <ellipse cx="18" cy="22" rx="5.5" ry="2.6" fill="#20303a" />
      {/* posts + roof */}
      <rect x="11" y="10" width="1.6" height="13" fill="#8b5a2b" />
      <rect x="23.4" y="10" width="1.6" height="13" fill="#8b5a2b" />
      <path d="M9 11 L18 5 L27 11 Z" fill="#c73a30" />
      <path d="M10.6 10.6 L18 6.4 L25.4 10.6 Z" fill="#e23b2f" />
      {/* rope + bucket */}
      <rect x="17.7" y="11" width="0.6" height="7" fill="#d9c9a3" />
      <path d="M16 18 h4 v3 a2 1.4 0 0 1 -4 0 Z" fill="#8b5a2b" />
      {/* water shine */}
      <path d="M14.5 21.6 q1.6 1 3.5 0.6" stroke="#7ec8ff" strokeWidth="0.7" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Gold coin mark for HUD / cost badges.
 * Uses /icons/gold-coin.svg (original coin art — not the coin emoji).
 */
export function GoldCoinIcon({
  className = "",
  title = "Gold",
  size = 14,
}: SpriteProps & { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/gold-coin.svg"
      alt=""
      title={title}
      width={size}
      height={size}
      className={`gold-coin-icon ${className}`}
      draggable={false}
      aria-hidden
    />
  );
}

/** Simple hammer — build / craft affordance. */
export function HammerSprite({
  className = "",
  title = "Build",
}: SpriteProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      width="40"
      height="40"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <ellipse cx="16" cy="29.5" rx="7" ry="1.4" fill="rgba(0,0,0,0.3)" />
      {/* handle */}
      <rect
        x="14.2"
        y="12"
        width="3.6"
        height="15"
        rx="1.2"
        fill="#8b5a2b"
        transform="rotate(-28 16 20)"
      />
      <rect
        x="14.7"
        y="13"
        width="1.4"
        height="12"
        rx="0.6"
        fill="#c4a06a"
        opacity="0.35"
        transform="rotate(-28 16 20)"
      />
      {/* head */}
      <g transform="translate(16 11) rotate(-28)">
        <rect x="-7.5" y="-4.2" width="15" height="6.4" rx="1.4" fill="#9aa3a0" />
        <rect x="-7.5" y="-4.2" width="15" height="2.2" rx="1.2" fill="#c5ccc8" />
        <rect x="-6.2" y="-3.4" width="3.2" height="4.6" rx="0.6" fill="#6a726c" />
        <rect x="3" y="-3.4" width="3.2" height="4.6" rx="0.6" fill="#6a726c" />
      </g>
    </svg>
  );
}

/** Cozy little cottage with warm window glow. */
export function HouseSprite({
  className = "",
  title = "House",
}: SpriteProps) {
  return (
    <svg
      className={`house-sprite ${className}`}
      viewBox="0 0 36 32"
      width="52"
      height="46"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <ellipse cx="18" cy="30" rx="10" ry="1.8" fill="rgba(0,0,0,0.35)" />

      {/* walls */}
      <rect x="7" y="14" width="22" height="14" rx="1.5" fill="#e8d5b5" />
      <rect x="7" y="14" width="22" height="3" fill="#d4c09a" />

      {/* roof */}
      <path d="M4 15.5 L18 5 L32 15.5 Z" fill="#c73a30" />
      <path d="M6.2 15 L18 6.8 L29.8 15 Z" fill="#e23b2f" />
      {/* chimney */}
      <rect x="24" y="7" width="4" height="7" rx="0.6" fill="#8a6a55" />
      <g className="house-smoke">
        <circle cx="26" cy="5.2" r="1.1" fill="rgba(232,235,228,0.45)" />
        <circle cx="27.4" cy="3.2" r="1.4" fill="rgba(232,235,228,0.3)" />
      </g>

      {/* door */}
      <rect x="15" y="20" width="6" height="8" rx="1" fill="#6b4228" />
      <circle cx="19.4" cy="24.2" r="0.55" fill="#c4b089" />

      {/* windows */}
      <rect x="9.5" y="18.5" width="4.2" height="4.2" rx="0.6" fill="#ffe08a" />
      <rect x="22.3" y="18.5" width="4.2" height="4.2" rx="0.6" fill="#ffe08a" />
      <path d="M11.6 18.5v4.2M9.5 20.6h4.2" stroke="#c4a86a" strokeWidth="0.45" />
      <path d="M24.4 18.5v4.2M22.3 20.6h4.2" stroke="#c4a86a" strokeWidth="0.45" />
    </svg>
  );
}
