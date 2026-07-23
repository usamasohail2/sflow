import type { Category } from "@/lib/constants";
import { CATEGORY_LABELS } from "@/lib/constants";

interface CategoryBadgeProps {
  category: Category;
}

export function CategoryBadge({ category }: CategoryBadgeProps) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
      {CATEGORY_LABELS[category]}
    </span>
  );
}
