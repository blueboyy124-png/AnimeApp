require('./rt/electron-rt');
//////////////////////////////
// User Defined Preload scripts below
const { contextBridge, ipcRenderer } = require('electron');

// Expose a small, safe API surface to the renderer (the Next.js app).
// The renderer uses these to download media to disk, play local files,
// delete them, and detect that it's running inside Electron.
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // Download a media file from a URL to the OS Downloads folder.
  // Returns { ok: true, filePath, sizeBytes } or { ok: false, error }.
  downloadMedia: (payload: { url: string; filename: string }) =>
    ipcRenderer.invoke('media:download', payload),

  // Play a local media file using the OS default player.
  playMediaFile: (filePath: string) =>
    ipcRenderer.invoke('media:play', filePath),

  // Delete a local media file from disk.
  deleteMediaFile: (filePath: string) =>
    ipcRenderer.invoke('media:delete', filePath),
});

console.log('User Preload!');