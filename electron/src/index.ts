import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import { getCapacitorElectronConfig, setupElectronDeepLinking } from '@capacitor-community/electron';
import type { MenuItemConstructorOptions } from 'electron';
import { app, MenuItem, ipcMain, shell } from 'electron';
import electronIsDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';
import { ElectronCapacitorApp, setupContentSecurityPolicy, setupReloadWatcher } from './setup';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import * as http from 'http';
import { createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

// Graceful handling of unhandled errors.
unhandled();

// Backend service paths — resolved relative to the app's own location so
// the dock-bundled .app finds them even when no terminal/workspace is open.
const FRONTEND_DIR = join(__dirname, '..', '..', '..');        // my-anime-site
const MIRURO_DIR   = join(FRONTEND_DIR, '..', 'MiruroAPI');     // MiruroAPI
const TMDB_DIR     = join(FRONTEND_DIR, '..', 'TMDB-Embed-API');// TMDB-Embed-API

const FRONTEND_PORT = 3001;
const MIRURO_PORT   = 3000;
const TMDB_PORT     = 8787;

// Track child processes so we can clean them up on quit
const childProcesses: ChildProcess[] = [];

function startService(
  cwd: string,
  command: string,
  args: string[],
  env: Record<string, string> = {}
): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  childProcesses.push(child);

  child.stdout?.on('data', (data: Buffer) => {
    console.log(`[${command} ${args.join(' ')}] ${data.toString().trim()}`);
  });
  child.stderr?.on('data', (data: Buffer) => {
    console.error(`[${command} ${args.join(' ')}] ${data.toString().trim()}`);
  });
  child.on('error', (err) => {
    console.error(`[${command}] Failed to start:`, err.message);
  });

  return child;
}

function waitForPort(port: number, host: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      const req = http.get(`http://${host}:${port}`, (res) => {
        // Any response (even 404, 500) means the server is running
        resolve();
        res.resume(); // consume response data to free memory
      });
      req.on('error', () => {
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timed out waiting for http://${host}:${port}`));
        } else {
          setTimeout(poll, 500);
        }
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timed out waiting for http://${host}:${port}`));
        } else {
          setTimeout(poll, 500);
        }
      });
    };
    poll();
  });
}

/** Starts backend services and waits for them to be ready. */
async function startBackendServices(): Promise<void> {
  console.log('[dock] Starting MiruroAPI...');
  startService(MIRURO_DIR, 'node', ['server.js'], {
    PORT: String(MIRURO_PORT),
    HOST: '0.0.0.0',
  });

  console.log('[dock] Starting TMDB Embed API...');
  startService(TMDB_DIR, 'node', ['apiServer.js'], {
    PORT: String(TMDB_PORT),
    BIND_HOST: '0.0.0.0',
  });

  const TIMEOUT_MS = 30_000;
  const host = '127.0.0.1';

  console.log('[dock] Waiting for MiruroAPI...');
  await waitForPort(MIRURO_PORT, host, TIMEOUT_MS);

  console.log('[dock] Waiting for TMDB Embed API...');
  await waitForPort(TMDB_PORT, host, TIMEOUT_MS);
}

/** Starts all three backend services and the production frontend. */
async function startAllServices(): Promise<void> {
  await startBackendServices();

  console.log('[dock] Starting Next.js frontend...');
  startService(FRONTEND_DIR, 'npx', ['next', 'start', '--port', String(FRONTEND_PORT), '--hostname', '0.0.0.0'], {
    PORT: String(FRONTEND_PORT),
    HOST: '0.0.0.0',
  });

  const TIMEOUT_MS = 30_000;
  const host = '127.0.0.1';

  console.log('[dock] Waiting for Next.js frontend...');
  await waitForPort(FRONTEND_PORT, host, TIMEOUT_MS);

  console.log('[dock] All services ready!');
}

// Define our menu templates (these are optional)
const trayMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [new MenuItem({ label: 'Quit App', role: 'quit' })];
const appMenuBarMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
  { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
  { role: 'viewMenu' },
];

// Get Config options from capacitor.config
const capacitorFileConfig: CapacitorElectronConfig = getCapacitorElectronConfig();

// Initialize our app. You can pass menu templates into the app here.
const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig, trayMenuTemplate, appMenuBarMenuTemplate);

// If deeplinking is enabled then we will set it up here.
if (capacitorFileConfig.electron?.deepLinkingEnabled) {
  setupElectronDeepLinking(myCapacitorApp, {
    customProtocol: capacitorFileConfig.electron.deepLinkingCustomProtocol ?? 'mycapacitorapp',
  });
}

// If we are in Dev mode, use the file watcher components.
if (electronIsDev) {
  setupReloadWatcher(myCapacitorApp);
}

// Run Application
(async () => {
  // Wait for electron app to be ready.
  await app.whenReady();

  // Register download/playback IPC handlers before the window loads so the
  // renderer's electronAPI bridge is ready on first paint.
  await registerMediaIpcHandlers();

  // In dev mode we still need the local backend services available to the
  // renderer at 127.0.0.1:3000, but the Next.js dev server is started separately.
  if (electronIsDev) {
    try {
      await startBackendServices();
    } catch (err) {
      console.error('[dock] Failed to start backend services in dev mode:', err);
      // Renderer may still work if the backend is already running externally.
    }
  } else {
    try {
      await startAllServices();
    } catch (err) {
      console.error('[dock] Failed to start one or more services:', err);
      // Continue anyway — the app may still be partially functional
    }
  }

  // 1. 👇 COMMENTED OUT strict CSP initialization to stop blocking TMDB/Supabase APIs 👇
  // setupContentSecurityPolicy(myCapacitorApp.getCustomURLScheme());

  // 2. Initialize the core app framework windows
  await myCapacitorApp.init();

  // 3. 👇 FORCE OVERRIDE: Disable security & redirect to 192.168.86.75 👇
  const mainWindow = myCapacitorApp.getMainWindow();
  if (mainWindow) {
    // 1. Intercept network responses and strip the restrictive CSP headers completely
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      if (details.responseHeaders) {
        delete details.responseHeaders['content-security-policy'];
        delete details.responseHeaders['Content-Security-Policy'];
      }
      callback({ cancel: false, responseHeaders: details.responseHeaders });
    });

    // 2. Dynamic CORS Bypass: Match your runtime environment context exactly
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      if (details.requestHeaders) {
        if (electronIsDev) {
          details.requestHeaders['Origin'] = 'http://192.168.86.75:3001';
        } else {
          // Strips origin headers in production so external APIs treat it as a native desktop client
          delete details.requestHeaders['Origin'];
          delete details.requestHeaders['origin'];
        }
      }
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    // 3. 👇 DYNAMIC ROUTER: Dev loads dev server, Production loads 192.168.86.75:3001 ──
    if (electronIsDev) {
      // Dev mode: Give Next.js a tiny moment to complete any compilation changes
      setTimeout(() => {
        mainWindow.loadURL('http://192.168.86.75:3001');
      }, 500);
    } else {
      // Production dock app mode: Load the locally-running Next.js server
      // All three backend services were started above by startAllServices().
      mainWindow.loadURL('http://192.168.86.75:3001');
    }
  }

  // 👇 COMMENTED OUT: Stops the app from throwing exceptions on missing app-update.yml files 👇
  // autoUpdater.checkForUpdatesAndNotify();
})();

// ── MEDIA DOWNLOAD / PLAYBACK IPC ──────────────────────────────────────
// The renderer (Next.js app) downloads media through the MiruroAPI
// /api/download endpoint which streams the .mp4. On Electron we stream
// those bytes straight to the OS Downloads folder instead of buffering
// them in memory — works for anime, TV shows, and movies alike, with no
// IndexedDB size limits.
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._ -]/g, "").trim();
  return cleaned || "download";
}

async function registerMediaIpcHandlers(): Promise<void> {
  // Download a URL to the user's Downloads folder.
  ipcMain.handle('media:download', async (_event, payload: { url: string; filename?: string }) => {
    if (!payload?.url || typeof payload.url !== 'string') {
      return { ok: false, error: 'Missing URL' };
    }

    const safeName = sanitizeFilename(payload.filename || 'download.mp4');
    const downloadsDir = app.getPath('downloads');
    const finalPath = join(downloadsDir, safeName);

    try {
      const res = await fetch(payload.url);
      if (!res.ok || !res.body) {
        return { ok: false, error: `Download request failed (${res.status})` };
      }

      const fileStream = createWriteStream(finalPath);
      const bodyStream = res.body;
      if (bodyStream instanceof Readable || (bodyStream && typeof (bodyStream as any).pipe === 'function')) {
        await pipeline(bodyStream as any, fileStream);
      } else {
        await pipeline(Readable.fromWeb(bodyStream as any), fileStream);
      }

      const sizeBytes = (await fs.stat(finalPath)).size;
      return { ok: true, filePath: finalPath, sizeBytes };
    } catch (err: any) {
      // Clean up partial file on failure.
      try { await fs.unlink(finalPath); } catch {}
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // Open a local media file with the OS default player.
  ipcMain.handle('media:play', async (_event, filePath: string) => {
    try {
      const result = await shell.openPath(filePath);
      if (result) return { ok: false, error: result };
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // Delete a local media file (used when removing a download).
  ipcMain.handle('media:delete', async (_event, filePath: string) => {
    try {
      await fs.unlink(filePath);
      return { ok: true };
    } catch (err: any) {
      if (err?.code === 'ENOENT') return { ok: true }; // already gone
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

// Handle when all of our windows are close (platforms have their own expectations).
app.on('window-all-closed', function () {
  // Kill all spawned child services
  for (const child of childProcesses) {
    try { child.kill('SIGTERM'); } catch {}
  }
  childProcesses.length = 0;

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// When the dock icon is clicked.
app.on('activate', async function () {
  if (myCapacitorApp.getMainWindow().isDestroyed()) {
    await myCapacitorApp.init();
  }
});

// Enable standard right-click Copy/Paste text context menus globally
app.on('web-contents-created', (event, contents) => {
  contents.on('context-menu', (e, props) => {
    const { Menu } = require('electron');
    const InputMenu = Menu.buildFromTemplate([
      { label: 'Undo', role: 'undo' },
      { label: 'Redo', role: 'redo' },
      { type: 'separator' },
      { label: 'Cut', role: 'cut' },
      { label: 'Copy', role: 'copy' },
      { label: 'Paste', role: 'paste' },
      { type: 'separator' },
      { label: 'Select All', role: 'selectAll' },
    ]);
    if (props.isEditable) {
      InputMenu.popup({ window: myCapacitorApp.getMainWindow() });
    }
  });
});

// Cleanup on app quit (beyond window-all-closed — covers macOS where the
// app stays alive until explicit quit).
app.on('before-quit', () => {
  for (const child of childProcesses) {
    try { child.kill('SIGTERM'); } catch {}
  }
  childProcesses.length = 0;
});
