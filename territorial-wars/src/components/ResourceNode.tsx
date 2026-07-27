"use client";

import type { GemType } from "@/lib/gameTypes";
import { GEM_META } from "@/lib/gameTypes";
import { ResourceGem } from "@/components/ResourceGem";
import { StoneSprite, TreeSprite } from "@/components/sprites";

type Props = {
  gem: GemType;
  size?: number;
  depleted?: boolean;
  pulse?: boolean;
  title?: string;
  onClick?: () => void;
};

/** Renders the right art for any resource: trees, rocks, or crystals. */
export function ResourceNode({
  gem,
  size = 36,
  depleted = false,
  pulse = false,
  title,
  onClick,
}: Props) {
  const label = title || GEM_META[gem].label;

  if (gem === "wood" || gem === "stone") {
    const Sprite = gem === "wood" ? TreeSprite : StoneSprite;
    const inner = (
      <Sprite
        className={depleted ? "opacity-40 grayscale" : ""}
        title={label}
      />
    );
    if (onClick) {
      return (
        <button
          type="button"
          onClick={onClick}
          className="block border-0 bg-transparent p-0"
          title={label}
          style={{ width: size * 1.2, height: size * 1.1 }}
        >
          {inner}
        </button>
      );
    }
    return (
      <div style={{ width: size * 1.2, height: size * 1.1 }} title={label}>
        {inner}
      </div>
    );
  }

  return (
    <ResourceGem
      gem={gem}
      size={size}
      depleted={depleted}
      pulse={pulse}
      title={label}
      onClick={onClick}
    />
  );
}
