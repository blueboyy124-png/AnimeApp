"use client";

import { memo } from "react";
import { AnimeCard, CardInteractionHandlers } from "./types";
import { CardGrid, NoResultsNotice, SHOWCASE_GRID_CLASS, hasRating } from "./cardHelpers";

interface SearchResultsProps extends CardInteractionHandlers {
  animeResults: AnimeCard[];
  tvResults: AnimeCard[];
  movieResults: AnimeCard[];
  hasMoreResults: boolean;
  searchResultsCount: number;
  resultsPerPage: number;
  loadingMore: boolean;
  onLoadMore: () => void;
}

// Search view: one section per category (Anime / TV Shows / Movies), each
// only rendered when it actually has results, an empty-state notice when
// all three come up empty, and a "Load More" pager at the bottom.
function SearchResultsComponent({
  animeResults,
  tvResults,
  movieResults,
  hasMoreResults,
  searchResultsCount,
  resultsPerPage,
  loadingMore,
  onLoadMore,
  onHoverStart,
  onHoverEnd,
  onCardClick,
}: SearchResultsProps) {
  // Search only ever shows titles that actually have a rating — an unrated
  // result gives someone nothing to judge it by, so it's filtered out here
  // rather than left to render with a blank/missing score. Applied per
  // category, before counts/empty-state/pagination all read off it, so
  // "(12)" next to a heading and "no matching titles" both reflect what's
  // actually on screen.
  const ratedAnimeResults = animeResults.filter(hasRating);
  const ratedTvResults = tvResults.filter(hasRating);
  const ratedMovieResults = movieResults.filter(hasRating);

  const categories = [
    { label: "Anime", list: ratedAnimeResults },
    { label: "TV Shows", list: ratedTvResults },
    { label: "Movies", list: ratedMovieResults },
  ];
  const allEmpty = ratedAnimeResults.length === 0 && ratedTvResults.length === 0 && ratedMovieResults.length === 0;

  return (
    <>
      {categories.map(
        ({ label, list }) =>
          list.length > 0 && (
            <section key={label} className="space-y-4 md:space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2.5 text-sm md:text-lg font-bold uppercase tracking-widest text-neutral-200">
                  <span className="w-1 h-4 md:h-5 rounded-full bg-orange-500" />
                  {label}{" "}
                  <span className="text-neutral-600 font-normal normal-case tracking-normal text-xs align-middle">
                    ({list.length})
                  </span>
                </h3>
              </div>
              <div className={SHOWCASE_GRID_CLASS}>
                <CardGrid list={list} variant="grid" onHoverStart={onHoverStart} onHoverEnd={onHoverEnd} onCardClick={onCardClick} />
              </div>
            </section>
          )
      )}

      {allEmpty && <NoResultsNotice />}

      {/* LAZY LOAD MORE PAGINATION DESK */}
      {hasMoreResults && searchResultsCount >= resultsPerPage && (
        <div className="w-full pt-6 flex justify-center">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="px-6 py-2.5 rounded-full bg-neutral-900 border border-neutral-800 hover:border-orange-500/50 hover:bg-neutral-850 font-medium text-xs font-mono tracking-wider text-neutral-300 hover:text-white uppercase transition disabled:opacity-50 flex items-center space-x-3"
          >
            {loadingMore && (
              <div className="w-3 h-3 border border-neutral-400 border-t-transparent rounded-full animate-spin" />
            )}
            <span>Load More Series</span>
          </button>
        </div>
      )}
    </>
  );
}

export const SearchResults = memo(SearchResultsComponent);