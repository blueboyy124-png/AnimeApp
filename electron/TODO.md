# Electron Desktop Dock App Fixes

## Status: COMPLETED ✅

### Completed Changes

1. **`electron/src/index.ts`** ✅
   - Added `startService()` function to spawn child processes
   - Added `waitForPort()` function to poll until a service is ready
   - Added `startAllServices()` that starts MiruroAPI (port 3000), TMDB-Embed-API (port 8787), and Next.js frontend (port 3001)
   - In production (dock) mode: calls `startAllServices()` before loading the app
   - Changed production URL from dead `capacitor-electron://index.html` to `http://192.168.86.75:3001`
   - Added cleanup: kills all child processes on `window-all-closed` and `before-quit`

2. **`electron/src/setup.ts`** ✅
   - Updated security handlers to allow `http://192.168.86.75:*` in both dev AND production modes
   - Previously only allowed 192.168.86.75 in dev mode

3. **`electron/electron-builder.config.json`** ✅
   - Updated `appId` and `productName` to match the actual app
   - Added `extraResources` to bundle MiruroAPI, TMDB-Embed-API, and my-anime-site into the .app
   - Updated macOS category to `public.app-category.entertainment`
   - Set `asar: false` so the bundled resources are accessible as files

### How It Works

When the user clicks the CineRoll app in the dock:
1. Electron starts
2. It spawns 3 child processes:
   - `node server.js` (MiruroAPI, port 3000)
   - `node apiServer.js` (TMDB-Embed-API, port 8787)  
   - `npx next start` (Next.js frontend, port 3001)
3. It waits for each service to respond on its port
4. It loads `http://192.168.86.75:3001` in the Electron window
5. When the user quits the app, all child processes are killed

### Prerequisites for Building

```bash
# 1. Build the Next.js frontend first (creates .next/)
cd /Users/porterdecker/Anime/my-anime-site
npm run build

# 2. Build the Electron TypeScript
cd /Users/porterdecker/Anime/my-anime-site/electron
npm run build

# 3. Package the app
npm run electron:make
```

