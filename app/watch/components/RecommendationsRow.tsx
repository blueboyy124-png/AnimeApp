"use client";

import { memo } from "react";
import Link from "next/link";

interface RecommendationItem {
  id: string | number;
  title: string;
  image: string;
  href: string;
  subtitle?: string;
}

interface RecommendationsRowProps {
  items: RecommendationItem[];
  label: string;
}

/**
 * A horizontally-scrolling shelf of recommendation cards for the watch page.
 * Used for "More Like This" and "Up Next" sections below the player.
 * Renders nothing if there's nothing to show.
 */
function RecommendationsRowComponent({ items, label }: RecommendationsRowProps) {
  if (!items || items.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2.5 text-sm md:text-base font-bold tracking-tight text-white">
          <span className="w-1 h-4 rounded-full bg-orange-500" />
          {label}
        </h3>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-neutral-800">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="recommendation-card group shrink-0 w-44 sm:w-52 rounded-md overflow-hidden bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
          >
            <div className="relative aspect-video w-full bg-neutral-900 overflow-hidden">
              <img
                src={item.image}
                alt={item.title}
                className="w-full h-full object-cover transition duration-300 group-hover:scale-105 group-hover:brightness-110"
                loading="lazy"
                decoding="async"
              />
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition flex items-center justify-center bg-black/20">
                <div className="w-8 h-8 rounded-full bg-white/95 flex items-center justify-center">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="black">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            </div>
            <div className="p-2.5">
              <p className="text-xs font-medium text-neutral-200 group-hover:text-white truncate transition-colors">
                {item.title}
              </p>
              {item.subtitle && (
                <p className="text-[10px] text-neutral-500 mt-0.5 truncate">{item.subtitle}</p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export const RecommendationsRow = memo(RecommendationsRowComponent);
