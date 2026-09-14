// app/api/site-banner/route.ts
//
// Public, unauthenticated — this is what SiteBanner.tsx on the frontend
// polls. Reads the same file the admin route writes; only ever exposes an
// already-active banner, so there's no separate "should this show" logic
// duplicated between admin and frontend to drift out of sync.

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "data", "frontend-config.json");

export async function GET() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    const banner = JSON.parse(raw);

    if (!banner?.enabled || !banner?.message?.trim()) {
      return NextResponse.json({ success: true, banner: null }, { headers: { "Cache-Control": "no-store" } });
    }

    const now = Date.now();
    if (banner.startsAt && now < new Date(banner.startsAt).getTime()) {
      return NextResponse.json({ success: true, banner: null }, { headers: { "Cache-Control": "no-store" } });
    }
    if (banner.endsAt && now > new Date(banner.endsAt).getTime()) {
      return NextResponse.json({ success: true, banner: null }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ success: true, banner }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // No config file yet, or it's unreadable - just means no banner, not an error.
    return NextResponse.json({ success: true, banner: null }, { headers: { "Cache-Control": "no-store" } });
  }
}