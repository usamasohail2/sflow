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

      {/* pickaxe group — animates when digging */}
      <g className="villager-tool" transform="translate(22 16)">
        <rect x="-0.7" y="0" width="1.4" height="9" rx="0.6" fill="#8b5a2b" />
        <path
          d="M-4 0.2h8l-1.2 2.4H-2.8z"
          fill="#c4b089"
          stroke="#8a7a5a"
          strokeWidth="0.4"
        />
      </g>
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

/** Stone warehouse with crates. */
export function WarehouseSprite({
  className = "",
  title = "Warehouse",
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
      {/* body */}
      <rect x="6" y="13" width="24" height="15" rx="1" fill="#9aa392" />
      <rect x="6" y="13" width="24" height="3" fill="#7f8877" />
      {/* roof */}
      <path d="M4 14 L18 6 L32 14 Z" fill="#4a5550" />
      <path d="M6 13.4 L18 7.6 L30 13.4 Z" fill="#5d6a63" />
      {/* door */}
      <rect x="14" y="18" width="8" height="10" rx="0.8" fill="#3d4a3f" />
      <path d="M14 18h8M18 18v10" stroke="#2a342c" strokeWidth="0.7" />
      {/* crates */}
      <rect x="7.5" y="23" width="4.5" height="5" fill="#c4a86a" />
      <path d="M7.5 25.5h4.5M9.7 23v5" stroke="#8a7a5a" strokeWidth="0.5" />
      <rect x="24" y="24" width="4" height="4" fill="#c4a86a" />
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
