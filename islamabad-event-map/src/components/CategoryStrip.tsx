"use client";

import type { Category } from "@/lib/constants";
import { CATEGORY_LABELS } from "@/lib/constants";
import { CategoryIcon, categoryColor } from "@/components/CategoryIcon";

interface CategoryStripProps {
  categories: Category[];
  selected: Category[];
  onChange: (categories: Category[]) => void;
  className?: string;
}

export function CategoryStrip({
  categories,
  selected,
  onChange,
  className = "",
}: CategoryStripProps) {
  if (categories.length === 0) return null;

  const active = selected[0] ?? null;
  const isAllActive = selected.length === 0;

  return (
    <div
      className={`pointer-events-auto ${className}`}
      role="listbox"
      aria-label="Categories"
    >
      <div className="flex gap-1.5 overflow-x-auto px-3 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          role="option"
          aria-selected={isAllActive}
          onClick={() => onChange([])}
          className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm transition ${
            isAllActive
              ? "border-transparent bg-[var(--btn)] text-white"
              : "border-line bg-surface text-ink-muted hover:text-ink"
          }`}
        >
          All
        </button>
        {categories.map((category) => {
          const isActive = active === category;
          const color = categoryColor(category);
          return (
            <button
              key={category}
              type="button"
              role="option"
              aria-selected={isActive}
              onClick={() => onChange([category])}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm transition ${
                isActive
                  ? "border-transparent text-white"
                  : "border-line bg-surface text-ink-muted hover:text-ink"
              }`}
              style={isActive ? { backgroundColor: color } : undefined}
            >
              <CategoryIcon category={category} className="h-3 w-3" />
              {CATEGORY_LABELS[category]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
