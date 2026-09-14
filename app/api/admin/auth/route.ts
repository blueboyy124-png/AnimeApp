import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'BrookPD12';

// Simple token-based session stored server-side
const sessions = new Map<string, { username: string; createdAt: number }>();

function generateToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function getSession(request: NextRequest): { username: string } | null {
  const sessionCookie = request.cookies.get('admin_session')?.value;
  if (!sessionCookie) return null;
  const session = sessions.get(sessionCookie);
  if (!session) return null;
  
  // Sessions expire after 12 hours
  const maxAge = 12 * 60 * 60 * 1000;
  if (Date.now() - session.createdAt > maxAge) {
    sessions.delete(sessionCookie);
    return null;
  }
  
  return { username: session.username };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, action } = body;

    // Logout
    if (action === 'logout') {
      const sessionCookie = request.cookies.get('admin_session')?.value;
      if (sessionCookie) sessions.delete(sessionCookie);
      const response = NextResponse.json({ success: true });
      response.cookies.set('admin_session', '', { 
        httpOnly: true, 
        sameSite: 'lax', 
        path: '/',
        maxAge: 0 
      });
      return response;
    }

    // Login
    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'MISSING_CREDENTIALS' }, { status: 400 });
    }

    // Constant-time-ish comparison to avoid trivial timing leaks
    const userOk = username === ADMIN_USERNAME;
    const pwOk = password === ADMIN_PASSWORD;
    
    if (!userOk || !pwOk) {
      return NextResponse.json({ success: false, error: 'INVALID_CREDENTIALS' }, { status: 401 });
    }

    const token = generateToken();
    sessions.set(token, { username, createdAt: Date.now() });

    const response = NextResponse.json({ success: true, username });
    response.cookies.set('admin_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 12 * 60 * 60, // 12 hours in seconds
    });

    return response;
  } catch {
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true, username: session.username });
}

