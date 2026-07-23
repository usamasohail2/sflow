import type { LucideIcon } from "lucide-react";
import { MapPinned, UtensilsCrossed } from "lucide-react";
import type { Category } from "@/lib/constants";
import { CATEGORY_COLORS } from "@/lib/constants";

const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  hidden: MapPinned,
  food: UtensilsCrossed,
};

export function categoryColor(category: Category): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.hidden;
}

export function CategoryIcon({
  category,
  className = "",
  strokeWidth = 2.25,
}: {
  category: Category;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = CATEGORY_ICONS[category] ?? MapPinned;
  return (
    <Icon
      className={className}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth={false}
      aria-hidden
    />
  );
}
