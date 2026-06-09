const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// Pencere modunda donanım hızlandırmalı <video> Chromium'da siyah render edilip
// yalnızca tam ekranda görünebiliyor. Yazılım compositing'e düşürmek video
// düzleminin her durumda doğru boyanmasını sağlar. disableHardwareAcceleration
// tek başına yetmediği için GPU compositing'i de kapatıyoruz (video katmanı
// ayrı bir overlay düzleminde değil, normal sayfa katmanında boyanır).
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu-compositing");

const isDev = !app.isPackaged;

function dataRoot() {
  if (isDev) {
    return path.join(__dirname, "..", "..", "data");
  }
  return path.join(process.resourcesPath, "data");
}

function readJson(fileName) {
  const filePath = path.join(dataRoot(), fileName);
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 960,
    minHeight: 540,
    title: "CANLI TV TR",
    backgroundColor: "#0b1220",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // Pencere fullscreen durumu (OS kısayolu/zar düğmesiyle de) değişince
  // renderer'a haber ver ki sinema modu sınıfı senkron kalsın.
  win.on("enter-full-screen", () => win.webContents.send("fullscreen-changed", true));
  win.on("leave-full-screen", () => win.webContents.send("fullscreen-changed", false));

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

ipcMain.handle("load-channels", () => readJson("channels.json"));

ipcMain.handle("load-stream-map", () => readJson("stream_map.json"));

ipcMain.handle("toggle-fullscreen", () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win) return false;
  const next = !win.isFullScreen();
  win.setFullScreen(next);
  return next;
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
