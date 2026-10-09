import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSession } from '../../session';

const TMDB_EMBED_API_URL = process.env.TMDB_EMBED_API_URL || 'http://192.168.86.75:8787';

export async function POST(request: NextRequest) {
  const authed = await verifyAdminSession(request);
  if (!authed) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const response = await fetch(`${TMDB_EMBED_API_URL}/api/restart`, {
      method: 'POST',
      cache: 'no-store',
    });
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to restart TMDB Embed API', details: String(error) },
      { status: 502 }
    );
  }
}

