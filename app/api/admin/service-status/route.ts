import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';

const TMDB_EMBED_API_URL = process.env.TMDB_EMBED_API_URL || 'http://192.168.86.75:8787';
const MIRURO_API_URL = process.env.MIRURO_API_URL || 'http://192.168.86.75:3000';

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

async function checkHealth(url: string, timeout = 5000): Promise<{ alive: boolean; latency: number; error?: string }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(id);
    return { alive: res.ok, latency: Date.now() - start };
  } catch (e: any) {
    return { alive: false, latency: Date.now() - start, error: e?.message || 'Unknown error' };
  }
}

function getProcessStatus(): { running: boolean; pid?: number } {
  try {
    const output = execSync('pgrep -f "start-anime.sh" 2>/dev/null || pgrep -f "node server.js" 2>/dev/null || echo ""', {
      encoding: 'utf-8',
      killSignal: 'SIGTERM',
      timeout: 3000,
    }).trim();
    if (!output) return { running: false };
    const pids = output.split('\n').filter(Boolean).map(Number);
    return { running: pids.length > 0, pid: pids[0] };
  } catch {
    return { running: false };
  }
}

export async function GET(request: NextRequest) {
  const authed = await verifySession(request);
  if (!authed) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const [miruroHealth, tmdbHealth, frontendHealth] = await Promise.all([
    checkHealth(`${MIRURO_API_URL}/api/health`),
    checkHealth(`${TMDB_EMBED_API_URL}/api/health`),
    checkHealth(`http://192.168.86.75:${process.env.PORT || 3001}/api/admin/auth`),
  ]);

  const processStatus = getProcessStatus();

  return NextResponse.json({
    success: true,
    services: {
      miruroApi: {
        name: 'MiruroAPI (Anime Backend)',
        url: MIRURO_API_URL,
        ...miruroHealth,
      },
      tmdbEmbedApi: {
        name: 'TMDB Embed API (Movie Backend)',
        url: TMDB_EMBED_API_URL,
        ...tmdbHealth,
      },
      frontend: {
        name: 'Frontend (my-anime-site)',
        url: `http://192.168.86.75:${process.env.PORT || 3001}`,
        ...frontendHealth,
      },
    },
    process: processStatus,
    timestamp: Date.now(),
  });
}

