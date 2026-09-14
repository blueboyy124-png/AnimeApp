"use client";

import { memo } from "react";
import { AnimeCard, CardInteractionHandlers } from "./types";
import { CardGrid, NoResultsNotice, SHOWCASE_GRID_CLASS } from "./cardHelpers";

interface FeedGridProps extends CardInteractionHandlers {
  headerTitle: string;
  items: AnimeCard[];
}

// The standard browse grid (Recommendations/Trending/Upcoming/Popular).
// Loading and search states are handled by the caller (page.tsx renders
// ShowcaseSkeleton / SearchResults instead of this component for those).
function FeedGridComponent({ headerTitle, items, onHoverStart, onHoverEnd, onCardClick }: FeedGridProps) {
  return (
    <section className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2.5 text-sm md:text-lg font-bold tracking-tight text-[#f2f0ec]">
          <span className="w-1 h-4 md:h-5 rounded-full bg-orange-500" />
          {headerTitle}
        </h3>
      </div>

      <div className={SHOWCASE_GRID_CLASS}>
        {Array.isArray(items) && items.length > 0 ? (
          <CardGrid list={items} variant="grid" onHoverStart={onHoverStart} onHoverEnd={onHoverEnd} onCardClick={onCardClick} />
        ) : (
          <NoResultsNotice inGrid />
        )}
      </div>
    </section>
  );
}

export const FeedGrid = memo(FeedGridComponent);
