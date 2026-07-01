// render-icon.js - rendert icon-src.html (SVG) zu einem 1024x1024 PNG via Electron.
// Aufruf: electron build/render-icon.js
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, useContentSize: true,
    show: false, frame: false, transparent: true,
    webPreferences: {},
  });
  await win.loadFile(path.join(__dirname, "icon-src.html"));
  await new Promise((r) => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  const sz = img.getSize();
  fs.writeFileSync(path.join(__dirname, "icon.png"), img.toPNG());
  console.log(`icon.png written: ${sz.width}x${sz.height}, ${img.toPNG().length} bytes`);
  app.quit();
});
