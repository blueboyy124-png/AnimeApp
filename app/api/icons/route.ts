import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// GET /api/icons
// Lists every image file in public/Assets/icons so the profile icon
// picker always reflects whatever you've dropped in that folder —
// no manifest file to keep in sync by hand.
export async function GET() {
  const dir = path.join(process.cwd(), "public", "Assets", "icons");

  try {
    const files = fs.readdirSync(dir).filter((f) => /\.(png|jpg|jpeg|webp|svg|gif)$/i.test(f));
    const icons = files.sort().map((f) => `/Assets/icons/${f}`);
    return NextResponse.json({ success: true, icons });
  } catch {
    // Folder doesn't exist yet or is empty — not an error, just nothing to show.
    return NextResponse.json({ success: true, icons: [] });
  }
}