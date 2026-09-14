"use client";

import { useEffect, useRef, useState, ChangeEvent } from "react";
import Link from "next/link";
import { SiteBanner } from "./SiteBanner";

export interface TopBarNavItem {
  /** Unique id used to figure out which item is "active" */
  key: string;
  label: string;
  /** Provide href for a real Next.js navigation link */
  href?: string;
  /** Provide onClick for SPA-style behavior (e.g. switching a category tab) */
  onClick?: () => void;
}

export interface TopBarProfile {
  name: string;
  avatar_url: string;
}

export interface TopBarProps {
  /** Where clicking the logo takes you. Ignored if onLogoClick is provided. */
  logoHref?: string;
  /** Use this instead of logoHref for SPA-style logo behavior (e.g. reset to home feed) */
  onLogoClick?: () => void;

  /** Links shown next to the logo (desktop only) */
  navItems?: TopBarNavItem[];
  /** key of the currently active nav item, used for the underline highlight */
  activeKey?: string;

  /**
   * "live"     - controlled input that filters in place (needs searchValue + onSearchChange)
   * "redirect" - plain input that triggers onSearchTrigger when clicked (e.g. navigate home)
   * "modal"    - button that opens a search overlay (onSearchTrigger), plus a mobile icon button
   * "none"     - no search UI at all
   */
  searchMode?: "live" | "redirect" | "modal" | "none";
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onSearchTrigger?: () => void;

  /**
   * "dropdown" - avatar + name with a Switch Profile / Downloads / Settings / Log Out menu
   * "simple"   - avatar + name that runs a single action on click (e.g. sign out)
   * "none"     - no profile UI
   */
  profileMode?: "dropdown" | "simple" | "none";
  profile?: TopBarProfile | null;
  /** used in "simple" mode */
  onProfileClick?: () => void;
  /** used in "dropdown" mode */
  onSwitchProfile?: () => void;
  /** used in "dropdown" mode */
  onLogout?: () => void;
}

const DEFAULT_NAV_ITEMS: TopBarNavItem[] = [
  { key: "home", label: "Home", href: "/" },
  { key: "trending", label: "Trending", href: "/?feed=trending" },
  { key: "upcoming", label: "Upcoming", href: "/?feed=upcoming" },
  { key: "popular", label: "Popular", href: "/?feed=popular" },
];

function getInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toUpperCase() : "?";
}

// Avatar with a graceful fallback: if `avatar_url` is empty or the image
// fails to load (broken URL, offline, etc.), this quietly swaps to a
// solid initial-letter badge instead of showing a broken-image icon —
// small detail, but a broken avatar icon in the header is exactly the
// kind of thing that reads as unpolished/pre-launch.
function Avatar({ name, avatarUrl, className }: { name: string; avatarUrl?: string; className?: string }) {
  const [errored, setErrored] = useState(false);
  const showImage = !!avatarUrl && !errored;

  return (
    <div className={`${className} bg-neutral-800 flex items-center justify-center`}>
      {showImage ? (
        <img
          src={avatarUrl}
          alt={name}
          className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
          onError={() => setErrored(true)}
          draggable={false}
        />
      ) : (
        <span className="text-xs font-bold text-orange-500">{getInitial(name)}</span>
      )}
    </div>
  );
}

export default function TopBar({
  logoHref = "/",
  onLogoClick,
  navItems = DEFAULT_NAV_ITEMS,
  activeKey,
  searchMode = "none",
  searchPlaceholder = "Search movies, TV or anime...",
  searchValue = "",
  onSearchChange,
  onSearchTrigger,
  profileMode = "none",
  profile = null,
  onProfileClick,
  onSwitchProfile,
  onLogout,
}: TopBarProps) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfileMenuOpen(false);
    };
    // Mousedown covers desktop; touchstart is needed too, otherwise
    // tapping anywhere else on a phone doesn't dismiss the menu the way
    // it does on desktop.
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [profileMenuOpen]);

  // Netflix-style header: transparent-over-hero at the top of the page,
  // solidifying to a real opaque bar once the person has scrolled past it
  // — reinforces that the header is persistent chrome, not part of the
  // hero artwork, and keeps nav/search legible over any background.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const logoClassName =
    "text-xl md:text-2xl font-black tracking-tighter text-orange-500 hover:text-orange-400 transition-all duration-300 text-left flex-shrink-0 cursor-pointer";

  return (
    <>
      <SiteBanner />
      <header
        // top offset (rather than a hardcoded top-0) is what lets the header
        // slide down beneath the site banner when one's active — SiteBanner
        // keeps --sa-banner-h in sync with its own real height, and falls
        // back to 0px the instant there's no banner to show.
        style={{ top: "var(--sa-banner-h, 0px)" }}
        className={`fixed inset-x-0 h-14 sm:backdrop-blur-xl z-50 flex items-center justify-between px-4 sm:px-6 md:px-12 transition-colors duration-200 ${
          scrolled ? "bg-[#0a0a0a] sm:bg-[#0a0a0a]/97" : "bg-[#0a0a0a] sm:bg-gradient-to-b sm:from-black/80 sm:to-transparent"
        }`}
      >
      <div className="flex items-center space-x-4 md:space-x-12 min-w-0">
        {onLogoClick ? (
          <button onClick={onLogoClick} className={logoClassName}>
            STREAMANIME
          </button>
        ) : (
          <Link href={logoHref} className={logoClassName}>
            STREAMANIME
          </Link>
        )}

        <nav className="hidden lg:flex items-center space-x-6 xl:space-x-8 text-sm font-medium text-neutral-400 flex-shrink-0">
          {navItems.map((item) => {
            const active = activeKey === item.key;
            const className = `relative py-1.5 transition-all duration-300 cursor-pointer ${
              active ? "text-[#f2f0ec] font-bold" : "text-neutral-400 hover:text-neutral-200"
            }`;
            const content = (
              <>
                {item.label}
                <span
                  className={`absolute left-0 right-0 -bottom-[3px] h-[2px] rounded-full bg-orange-500 transition-all duration-300 origin-center ${
                    active ? "opacity-100 scale-x-100" : "opacity-0 scale-x-0"
                  }`}
                />
              </>
            );
            return item.href ? (
              <Link key={item.key} href={item.href} onClick={item.onClick} className={className}>
                {content}
              </Link>
            ) : (
              <button key={item.key} onClick={item.onClick} className={className}>
                {content}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center space-x-3 sm:space-x-4 flex-shrink-0 ml-auto">
        {searchMode === "live" && (
          <div className="relative max-w-xs w-36 xs:w-40 md:w-48 lg:w-64 focus-within:lg:w-80 hidden sm:block transition-[width] duration-200 ease-out">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <img
                src="/Assets/search-icon.png"
                alt="Search"
                className="w-4 h-4 object-contain invert brightness-200 contrast-200 opacity-90"
              />
            </div>
            <input
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={onSearchChange}
              className="w-full pl-10 pr-4 py-1.5 rounded-md bg-[#12151b]/88 border border-white/10 text-sm text-[#f2f0ec] placeholder-neutral-500 focus:border-orange-500/70 focus:bg-[#181c23] transition-colors duration-200"
            />
          </div>
        )}

        {searchMode === "redirect" && (
          <div className="relative max-w-xs w-full hidden sm:block ml-6">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <img
                src="/Assets/search-icon.png"
                alt="Search"
                className="w-4 h-4 object-contain invert brightness-200 contrast-200 opacity-90"
              />
            </div>
            <input
              type="text"
              placeholder={searchPlaceholder}
              onClick={onSearchTrigger}
              className="w-full pl-10 pr-4 py-1.5 rounded-md bg-[#12151b]/92 border border-white/10 text-sm placeholder-neutral-500 focus:border-orange-500 focus:bg-[#181c23] transition-all duration-300 cursor-pointer"
            />
          </div>
        )}

        {searchMode === "modal" && (
          <>
            <button
              type="button"
              onClick={onSearchTrigger}
              className="relative max-w-xs w-full hidden sm:flex items-center ml-6 shrink-0 pl-10 pr-4 py-1.5 rounded-md bg-[#12151b]/92 border border-white/10 text-sm text-neutral-500 hover:border-white/20 hover:bg-[#181c23] transition-all duration-300 text-left"
            >
              <img
                src="/Assets/search-icon.png"
                alt=""
                className="w-4 h-4 object-contain invert brightness-200 contrast-200 opacity-90 absolute left-3"
              />
              {searchPlaceholder}
            </button>
            <button
              type="button"
              onClick={onSearchTrigger}
              aria-label="Search"
              className="sm:hidden flex items-center justify-center w-9 h-9 rounded-full bg-neutral-900/90 border border-neutral-800 shrink-0"
            >
              <img
                src="/Assets/search-icon.png"
                alt=""
                className="w-4 h-4 object-contain invert brightness-200 contrast-200 opacity-90"
              />
            </button>
          </>
        )}

        {profileMode === "dropdown" && profile && (
          <div className="relative" ref={profileMenuRef}>
            <button
              onClick={() => setProfileMenuOpen((v) => !v)}
              className="flex items-center space-x-2 p-1 rounded-md hover:bg-neutral-900 transition focus:outline-none group cursor-pointer"
              title={profile.name}
              aria-haspopup="menu"
              aria-expanded={profileMenuOpen}
            >
              <Avatar name={profile.name} avatarUrl={profile.avatar_url} className="w-8 h-8 rounded overflow-hidden border border-neutral-800 group-hover:border-orange-500 transition" />
              <span className="hidden md:inline text-xs font-semibold text-neutral-400 group-hover:text-neutral-200 transition">
                {profile.name}
              </span>
            </button>

            {profileMenuOpen && (
              <div role="menu" className="absolute right-0 mt-2 w-44 bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl overflow-hidden z-50 animate-[dropdownOpen_150ms_ease-out]">
                <button
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onSwitchProfile?.();
                  }}
                  className="w-full text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-neutral-300 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
                >
                  Switch Profile
                </button>
                <Link
                  href="/downloads"
                  onClick={() => setProfileMenuOpen(false)}
                  className="block w-full text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-neutral-300 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
                >
                  Downloads
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setProfileMenuOpen(false)}
                  className="block w-full text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-neutral-300 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
                >
                  Settings
                </Link>
                <Link
                  href="/admin"
                  onClick={() => setProfileMenuOpen(false)}
                  className="block w-full text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-neutral-300 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
                >
                  Admin
                </Link>
                <button
                  onClick={() => {
                    setProfileMenuOpen(false);
                    onLogout?.();
                  }}
                  className="w-full text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-neutral-400 hover:bg-red-950/40 hover:text-red-400 transition cursor-pointer border-t border-neutral-800"
                >
                  Log Out
                </button>
              </div>
            )}
          </div>
        )}

        {profileMode === "simple" && profile && (
          <div className="relative group flex items-center">
            <button
              onClick={onProfileClick}
              className="flex items-center space-x-2 focus:outline-none cursor-pointer group"
              title="Click to Switch Profile / Sign Out"
            >
              <Avatar
                name={profile.name}
                avatarUrl={profile.avatar_url}
                className="w-8 h-8 rounded overflow-hidden border border-neutral-700 group-hover:border-orange-500 transition duration-200 shadow-md"
              />
              <span className="hidden lg:inline text-xs font-semibold text-neutral-400 group-hover:text-white transition max-w-[90px] truncate">
                {profile.name}
              </span>
            </button>
          </div>
        )}
      </div>
      </header>
    </>
  );
}