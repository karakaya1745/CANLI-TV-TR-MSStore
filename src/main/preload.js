const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("canliTv", {
  loadChannels: () => ipcRenderer.invoke("load-channels"),
  loadStreamMap: () => ipcRenderer.invoke("load-stream-map"),
  toggleFullscreen: () => ipcRenderer.invoke("toggle-fullscreen"),
  onFullscreenChanged: (cb) =>
    ipcRenderer.on("fullscreen-changed", (_e, isFs) => cb(isFs)),
});
