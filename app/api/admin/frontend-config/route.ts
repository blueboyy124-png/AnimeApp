import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { verifyAdminSession } from "../session";

const CONFIG_PATH = path.join(process.cwd(), "data", "frontend-config.json");

interface StoredBanner {
  id: string;
  enabled: boolean;
  message: string;
  linkHref: string | null;
  linkLabel: string | null;
  theme: "info" | "warning" | "success" | "promo" | "danger";
  dismissible: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

const DEFAULT_BANNER: StoredBanner = {
  id: "0",
  enabled: false,
  message: "",
  linkHref: null,
  linkLabel: null,
  theme: "info",
  dismissible: true,
  startsAt: null,
  endsAt: null,
};

async function readBanner(): Promise<StoredBanner> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return { ...DEFAULT_BANNER, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_BANNER;
  }
}

async function writeBanner(banner: StoredBanner): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(banner, null, 2), "utf-8");
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdminSession(req))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const banner = await readBanner();
  return NextResponse.json({ success: true, banner });
}

export async function POST(req: NextRequest) {
  if (!(await verifyAdminSession(req))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const input = body?.banner || {};
  if (typeof input.message !== "string") {
    return NextResponse.json({ success: false, error: "message is required" }, { status: 400 });
  }

  // Bumping the id on every save is what makes an edited banner reappear
  // for people who'd already dismissed the old wording — SiteBanner.tsx
  // on the frontend keys "already dismissed" off this id.
  const banner: StoredBanner = {
    id: Date.now().toString(36),
    enabled: !!input.enabled,
    message: String(input.message).slice(0, 140),
    linkHref: input.linkHref || null,
    linkLabel: input.linkLabel || null,
    theme: ["info", "warning", "success", "promo", "danger"].includes(input.theme) ? input.theme : "info",
    dismissible: input.dismissible !== false,
    startsAt: input.startsAt || null,
    endsAt: input.endsAt || null,
  };

  await writeBanner(banner);
  return NextResponse.json({ success: true, banner });
}