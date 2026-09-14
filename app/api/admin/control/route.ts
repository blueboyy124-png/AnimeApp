import { NextRequest, NextResponse } from 'next/server';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';

// Admin control endpoint — never static, always runs on the server
export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);
const BACKEND_PATH = '/Users/porterdecker/Anime/MiruroAPI';
const MOIVEBACKEND_PATH = '/Users/porterdecker/Anime/TMDB-Embed-API';
const FRONTEND_PATH = '/Users/porterdecker/Anime/my-anime-site';
const START_SCRIPT = '/Users/porterdecker/start-anime.sh';

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

interface ProcessInfo {
  running: boolean;
  pid?: number;
  cmd?: string;
}

function getProcesses(): { all: ProcessInfo; miruro: ProcessInfo; tmdb: ProcessInfo; frontend: ProcessInfo } {
  // Short-circuit if not running on a real server (build-time check)
  if (typeof window !== 'undefined' || process.env.NEXT_PHASE === 'phase-production-build') {
    return {
      all: { running: false },
      miruro: { running: false },
      tmdb: { running: false },
      frontend: { running: false }
    };
  }

  try {
    const allOutput = execSync(
      `pgrep -f "start-anime.sh" 2>/dev/null; echo "---"; pgrep -f "node server.js" 2>/dev/null; echo "---"; pgrep -f "node" | xargs ps -o pid=,comm= 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 3000 }
    );
    const miruroPids = execSync(
      `pgrep -f "MiruroAPI.*node" 2>/dev/null; pgrep -f "node.*server.js" 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim().split('\n').filter(Boolean);
    const tmdbPids = execSync(
      `pgrep -f "TMDB-Embed-API" 2>/dev/null; pgrep -f "node.*apiServer.js" 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim().split('\n').filter(Boolean);
    const frontendPids = execSync(
      `pgrep -f "next dev" 2>/dev/null; pgrep -f "next start" 2>/dev/null || true`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim().split('\n').filter(Boolean);

    return {
      all: { running: false },
      miruro: { running: miruroPids.length > 0, pid: miruroPids.length > 0 ? parseInt(miruroPids[0]) : undefined },
      tmdb: { running: tmdbPids.length > 0, pid: tmdbPids.length > 0 ? parseInt(tmdbPids[0]) : undefined },
      frontend: { running: frontendPids.length > 0, pid: frontendPids.length > 0 ? parseInt(frontendPids[0]) : undefined },
    };
  } catch {
    return {
      all: { running: false },
      miruro: { running: false },
      tmdb: { running: false },
      frontend: { running: false },
    };
  }
}

export async function GET(request: NextRequest) {
  const authed = await verifySession(request);
  if (!authed) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const processes = getProcesses();
  return NextResponse.json({ success: true, ...processes });
}

export async function POST(request: NextRequest) {
  const authed = await verifySession(request);
  if (!authed) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { action, service } = body;

    if (action === 'stop' || action === 'stop_all') {
      if (service === 'miruro' || service === 'all') {
        execSync(`pkill -f "MiruroAPI.*node" 2>/dev/null; pkill -f "node.*server.js.*Miruro" 2>/dev/null || true`, { timeout: 5000 });
      }
      if (service === 'tmdb' || service === 'all') {
        execSync(`pkill -f "TMDB-Embed-API" 2>/dev/null; pkill -f "node.*apiServer.js" 2>/dev/null || true`, { timeout: 5000 });
      }
      if (service === 'frontend' || service === 'all') {
        execSync(`pkill -f "next dev" 2>/dev/null; pkill -f "next start" 2>/dev/null || true`, { timeout: 5000 });
      }
      return NextResponse.json({ success: true, action: `stopped ${service}` });
    }

    if (action === 'start') {
      if (service === 'miruro' || service === 'all') {
        exec(`cd "${BACKEND_PATH}" && PORT=3000 HOST="0.0.0.0" node server.js > /tmp/anime-backend.log 2>&1 &`, { timeout: 5000 });
      }
      if (service === 'tmdb' || service === 'all') {
        exec(`cd "${MOIVEBACKEND_PATH}" && PORT=8787 HOST="0.0.0.0" npm start > /tmp/movie-backend.log 2>&1 &`, { timeout: 5000 });
      }
      if (service === 'frontend' || service === 'all') {
        exec(`cd "${FRONTEND_PATH}" && PORT=3001 HOST="0.0.0.0" npm run dev -- --hostname "0.0.0.0" --port 3001 > /tmp/anime-frontend.log 2>&1 &`, { timeout: 5000 });
      }
      await new Promise(r => setTimeout(r, 2000));
      return NextResponse.json({ success: true, action: `started ${service}` });
    }

    if (action === 'restart') {
      if (service === 'miruro' || service === 'all') {
        execSync(`pkill -f "MiruroAPI.*node" 2>/dev/null; pkill -f "node.*server.js.*Miruro" 2>/dev/null || true`, { timeout: 5000 });
        await new Promise(r => setTimeout(r, 1000));
        exec(`cd "${BACKEND_PATH}" && PORT=3000 HOST="0.0.0.0" node server.js > /tmp/anime-backend.log 2>&1 &`, { timeout: 5000 });
      }
      if (service === 'tmdb' || service === 'all') {
        execSync(`pkill -f "TMDB-Embed-API" 2>/dev/null; pkill -f "node.*apiServer.js" 2>/dev/null || true`, { timeout: 5000 });
        await new Promise(r => setTimeout(r, 1000));
        exec(`cd "${MOIVEBACKEND_PATH}" && PORT=8787 HOST="0.0.0.0" npm start > /tmp/movie-backend.log 2>&1 &`, { timeout: 5000 });
      }
      if (service === 'frontend' || service === 'all') {
        execSync(`pkill -f "next dev" 2>/dev/null; pkill -f "next start" 2>/dev/null || true`, { timeout: 5000 });
        await new Promise(r => setTimeout(r, 1000));
        exec(`cd "${FRONTEND_PATH}" && PORT=3001 HOST="0.0.0.0" npm run dev -- --hostname "0.0.0.0" --port 3001 > /tmp/anime-frontend.log 2>&1 &`, { timeout: 5000 });
      }
      await new Promise(r => setTimeout(r, 3000));
      return NextResponse.json({ success: true, action: `restarted ${service}` });
    }

    if (action === 'start_script') {
      exec(`bash "${START_SCRIPT}" > /tmp/start-anime.log 2>&1 &`, { timeout: 5000 });
      await new Promise(r => setTimeout(r, 3000));
      return NextResponse.json({ success: true, action: 'started all via start-anime.sh' });
    }

    return NextResponse.json({ success: false, error: 'INVALID_ACTION' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: String(e?.message || 'Unknown error') }, { status: 500 });
  }
}
