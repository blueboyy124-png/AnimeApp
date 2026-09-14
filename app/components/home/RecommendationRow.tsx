"use client";

import { memo } from "react";
import { AnimeCard, CardInteractionHandlers } from "./types";
import { CardGrid, ScrollShelf } from "./cardHelpers";

interface RecommendationRowProps extends CardInteractionHandlers {
  items: AnimeCard[];
  label: string;
  // When present, renders "Because you watched <seedTitle>" instead of the
  // plain `label` — used by the movieRecs/tvRecs/animeRecs shelves. The
  // adaptive contextual rows (Relax Before Bed, Weekend Binge, Under the
  // Radar, Award Winners) omit this and just show `label`.
  seedTitle?: string;
}

// A single horizontally-scrolling shelf of cards with a header. Covers both
// "Because you watched X" rows (pass seedTitle) and the adaptive contextual
// rows generated from session mood + Taste Drift (pass only label). Renders
// nothing if there's nothing to show, so callers can map over a list of
// candidate rows without an extra existence check.
function RecommendationRowComponent({ items, label, seedTitle, onHoverStart, onHoverEnd, onCardClick }: RecommendationRowProps) {
  if (!items || items.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2.5 text-sm md:text-lg font-bold tracking-tight text-[#f2f0ec]">
          <span className="w-1 h-4 md:h-5 rounded-full bg-orange-500" />
          {seedTitle ? (
            <>
              Because you watched <span className="text-orange-500">{seedTitle}</span>
            </>
          ) : (
            label
          )}
        </h3>
      </div>

      {/* Capped to a max of 5 cards visible per row at once (see
          ROW_CARD_WIDTH_CLASS in cardHelpers) — anything beyond that is
          reachable via the hover arrows or a native swipe on touch. */}
      <ScrollShelf ariaLabel={seedTitle ? `Because you watched ${seedTitle}` : label}>
        <CardGrid list={items} variant="row" onHoverStart={onHoverStart} onHoverEnd={onHoverEnd} onCardClick={onCardClick} />
      </ScrollShelf>
    </section>
  );
}

export const RecommendationRow = memo(RecommendationRowComponent);
