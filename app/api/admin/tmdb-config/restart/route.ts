import { NextRequest, NextResponse } from 'next/server';

const TMDB_EMBED_API_URL = process.env.TMDB_EMBED_API_URL || 'http://192.168.86.75:8787';

async function verifySession(request: NextRequest): Promise<boolean> {
  try {
    const sessionCookie = request.cookies.get('admin_session')?.value;
    if (!sessionCookie) return false;
    const res = await fetch(`http://192.168.86.75:${process.env.PORT || 3001}/api/admin/auth`, {
      headers: { Cookie: `admin_session=${sessionCookie}` },
    });
    const data = await res.json();
    return data.authenticated === true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const authed = await verifySession(request);
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

