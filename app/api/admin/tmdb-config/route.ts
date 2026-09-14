import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const TMDB_EMBED_API_URL = process.env.TMDB_EMBED_API_URL || 'http://192.168.86.75:8787';

async function verifySession(request: NextRequest): Promise<boolean> {
  const sessionCookie = request.cookies.get('admin_session')?.value;
  if (!sessionCookie) return false;
  try {
    const res = await fetch(`http://192.168.86.75:${process.env.PORT || 3001}/api/admin/auth`, {
      headers: { Cookie: `admin_session=${sessionCookie}` },
    });
    const data = await res.json();
    return data.authenticated === true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const authed = await verifySession(request);
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
  const authed = await verifySession(request);
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

