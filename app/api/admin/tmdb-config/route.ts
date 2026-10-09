import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSession } from '../session';

const TMDB_EMBED_API_URL = process.env.TMDB_EMBED_API_URL || 'http://192.168.86.75:8787';

export async function GET(request: NextRequest) {
  const authed = await verifyAdminSession(request);
  if (!authed) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const response = await fetch(`${TMDB_EMBED_API_URL}/api/config`, {
      cache: 'no-store',
    });
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to connect to TMDB Embed API', details: String(error) },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authed = await verifyAdminSession(request);
  if (!authed) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const response = await fetch(`${TMDB_EMBED_API_URL}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to update TMDB Embed config', details: String(error) },
      { status: 502 }
    );
  }
}

