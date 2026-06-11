// preload.js - sichere Bruecke zwischen Renderer (UI) und Main-Prozess (Node).
// contextIsolation=true, nodeIntegration=false: der Renderer bekommt NUR die
// hier explizit freigegebenen Funktionen, kein direkter Node-Zugriff.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Voller Lookup zu einer CUSA/Produkt-ID: Patch-Server + GraphQL + (optional) PlatPrices + GRAC
  lookup: (input, opts) => ipcRenderer.invoke("lookup", { input, opts }),
  // PS-Store-Suche nach Name -> Liste {productId, name}
  storeSearch: (query, page) => ipcRenderer.invoke("store-search", { query, page }),
  // Direkte GRAC-Suche (Korea-Rating) nach Titel
  grac: (title) => ipcRenderer.invoke("grac", { title }),
  // PKG-Echtheitspruefung
  pickPkg: () => ipcRenderer.invoke("pick-pkg"),
  verifyPkg: (filePath, computeHash) => ipcRenderer.invoke("verify-pkg", { filePath, computeHash }),
  onHashProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("hash-progress", handler);
    return () => ipcRenderer.removeListener("hash-progress", handler);
  },
  // Live-Watcher
  watchGet: () => ipcRenderer.invoke("watch-get"),
  watchAdd: (target) => ipcRenderer.invoke("watch-add", { target }),
  watchRemove: (target) => ipcRenderer.invoke("watch-remove", { target }),
  watchStart: (intervalMin) => ipcRenderer.invoke("watch-start", { intervalMin }),
  watchStop: () => ipcRenderer.invoke("watch-stop"),
  watchCheckNow: () => ipcRenderer.invoke("watch-check-now"),
  onWatchStatus: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on("watch-status", h); return () => ipcRenderer.removeListener("watch-status", h); },
  onWatchChange: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on("watch-change", h); return () => ipcRenderer.removeListener("watch-change", h); },
  onWatchTick: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on("watch-tick", h); return () => ipcRenderer.removeListener("watch-tick", h); },
  // Fenster-Steuerung fuer die Custom-Titlebar
  win: (action) => ipcRenderer.invoke("win", action),
  // App-Infos
  appInfo: () => ipcRenderer.invoke("app-info"),
  // Sprache fuer Main-Prozess-Texte (Desktop-Notifications)
  setLang: (lang) => ipcRenderer.invoke("set-lang", lang),
});
