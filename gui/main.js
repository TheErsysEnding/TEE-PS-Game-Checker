// main.js - Electron Main-Prozess.
// Macht die Netzwerk-Arbeit (Node-Seite) und stellt sie dem Renderer per IPC bereit.
// Der Patch-Server braucht zwingend den Main-Prozess (self-signed TLS via node:https),
// das ginge im Browser-Renderer nicht.

const { app, BrowserWindow, Menu, ipcMain, nativeTheme, shell, dialog, Notification, clipboard } = require("electron");
const path = require("node:path");
const fsp = require("node:fs/promises");

// Bestehende Tool-Logik als Library wiederverwenden (liegt eine Ebene hoeher).
const PSN = require("../psn_check.js");
const GRAC = require("../grac.js");
const PKG = require("../pkg.js");

const FULL_ID_RE = /\b([A-Z]{2}\d{4}-(?:CUSA|PPSA)\d{4,5}_\d{2}-[A-Z0-9]+)\b/;
const CUSA_RE = /\b(CUSA\d{4,5})\b/i;

function regionFromProductId(id) {
  const pre = (id || "").slice(0, 2);
  return { UP: "US", EP: "DE", JP: "JP", HP: "JP", KP: "KR" }[pre] || "US";
}

// --- PS-Store-Suche (aus psn_cli.js portiert; psn_cli.js startet beim require
//     leider sein TUI, darum hier eigenstaendig) ---
async function fetchStoreSearch(query, page = 1, locale = "en-us") {
  const url = `https://store.playstation.com/${locale}/search/${encodeURIComponent(query)}/${page}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": locale } });
    if (r.status !== 200) return { error: `HTTP ${r.status}`, results: [] };
    const body = await PSN.readCapped(r, 8 * 1024 * 1024);   // zentraler DoS-Cap aus psn_check.js
    const m = body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (!m) return { error: "no nextdata", results: [] };
    const data = JSON.parse(m[1]);
    const apollo = data?.props?.apolloState || {};
    const seen = new Set();
    const results = [];
    for (const k of Object.keys(apollo)) {
      if (!k.startsWith("Product:")) continue;
      const productId = k.slice("Product:".length).replace(/:[a-z]{2}-[a-z]{2}$/, "");
      if (seen.has(productId)) continue;
      seen.add(productId);
      const name = apollo[k]?.name;
      if (name) results.push({ productId, name });
    }
    return { results };
  } catch (e) {
    return { error: String(e && e.message || e), results: [] };
  }
}

// --- Voller Lookup: traegt alle Quellen fuer eine ID/CUSA zusammen ---
async function doLookup(input, opts = {}) {
  input = String(input || "").trim();
  const fullId = (input.match(FULL_ID_RE) || [])[1] || null;
  const cusa = ((input.match(CUSA_RE) || [])[1] || (fullId && (fullId.match(/CUSA\d+/) || [])[0]) || "").toUpperCase() || null;

  const result = {
    input, fullId, cusa,
    patch: null,
    store: { us: null, de: null },
    platprices: null,
    grac: null,
    errors: [],
  };

  // 1) Patch-Server zuerst — er liefert ggf. die volle Content-ID, mit der wir
  //    auch bei reiner CUSA-Eingabe den Store-Status pruefen koennen.
  if (cusa) {
    try { result.patch = await PSN.fetchPatchInfo(cusa); }
    catch (e) { result.errors.push("Patch-Server: " + (e.message || e)); }
  }
  const effectiveId = fullId || result.patch?.parsed?.contentId || null;
  result.effectiveId = effectiveId;

  // 2) Store (US/DE) parallel mit der effektiven ID
  const jobs = [];
  if (effectiveId) {
    jobs.push(PSN.gqlProduct(effectiveId, "en-US", opts.hash || PSN.DEFAULT_HASH_PRODUCT)
      .then(r => { result.store.us = PSN.summarizeProduct(r.json); }).catch(() => {}));
    jobs.push(PSN.gqlProduct(effectiveId, "de-DE", opts.hash || PSN.DEFAULT_HASH_PRODUCT)
      .then(r => { result.store.de = PSN.summarizeProduct(r.json); }).catch(() => {}));
  }
  await Promise.all(jobs);

  // GRAC: Titel aus Patch-Server oder Store ableiten (oder manuell uebergeben)
  const name = opts.gracTitle || result.patch?.parsed?.title ||
               result.store.us?.name || result.store.de?.name || null;
  if (opts.grac !== false && name) {
    result.grac = await GRAC.gracVerifyTitle(name).catch(e => ({ error: e.message || String(e), entries: [] }));
  }

  // PlatPrices optional (nur mit Key + voller ID)
  if (opts.platpricesKey && effectiveId) {
    try {
      const pp = await PSN.platprices(effectiveId, regionFromProductId(effectiveId), opts.platpricesKey);
      result.platprices = PSN.summarizePlatPrices(pp.json) || (pp.json?.errorDesc ? { error: pp.json.errorDesc } : null);
    } catch (e) {
      result.platprices = { error: e.message || String(e) };
    }
  }

  // fmtBytes-Helfer fuer den Renderer mitschicken (Patch-Groesse vorformatiert)
  if (result.patch?.parsed?.size) result.patch.parsed.sizePretty = PSN.fmtBytes(result.patch.parsed.size);
  return result;
}

// --- Fenster ---
let mainWindow = null;

function overlayColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: "#00000000", symbolColor: dark ? "#e8e8e8" : "#1b1b1b", height: 44 };
}

function createWindow() {
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: 1140, height: 780, minWidth: 900, minHeight: 600,
    title: "TEE PS Game Checker",
    show: false,   // erst nach 'ready-to-show' zeigen -> kein Theme-Farb-Flackern beim Start
    // mac: kein Mica, nicht transparent -> deckende Farbe (verhindert schwarzes Flackern).
    // Windows: transparent, damit der Mica-Effekt durchscheint.
    backgroundColor: isMac ? (nativeTheme.shouldUseDarkColors ? "#181820" : "#f3f3f6") : "#00000000",
    titleBarStyle: "hidden",          // frameless; mac zeigt native Ampel-Buttons (links)
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 15 } }               // Ampel in 44px-Leiste zentrieren
      : { backgroundMaterial: "mica", titleBarOverlay: overlayColors() }), // Windows-11-only
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  // Fenster erst zeigen, wenn der Renderer das (gespeicherte) Theme gerendert hat -> verhindert
  // kurzes Farb-Flackern, falls App-Theme (localStorage) und System-Theme divergieren.
  mainWindow.once("ready-to-show", () => { if (mainWindow) mainWindow.show(); });

  // Externe Links im Standardbrowser oeffnen, nicht im App-Fenster.
  // Schema-Whitelist: NUR https/http an die OS-Shell weiterreichen. Verhindert,
  // dass eine (per MITM faelschbare) manifest_url mit file://, SMB/UNC oder
  // Custom-Protokoll an shell.openExternal durchreicht (NTLM-Hash-Leak etc.).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const proto = new URL(url).protocol;
      if (proto === "https:" || proto === "http:") shell.openExternal(url);
    } catch { /* ungueltige URL -> ignorieren */ }
    return { action: "deny" };
  });

  // Smoke-Test: rendert die App, fuehrt eine Aktion aus, schiesst einen Screenshot
  // und beendet sich. `--smoke` = Check-Tab (Black Ops 1), `--smoke-pkg=<datei>` = PKG-Tab.
  const smokePkg = (process.argv.find((a) => a.startsWith("--smoke-pkg=")) || "").split("=")[1];
  const smokeWatch = process.argv.includes("--smoke-watch");
  const smokeManifest = process.argv.includes("--smoke-manifest");
  if (process.argv.includes("--smoke") || smokePkg || smokeWatch || smokeManifest) {
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        {
          const d = process.argv.includes("--dark");
          const smokeLang = (process.argv.find((a) => a.startsWith("--lang=")) || "").split("=")[1];
          const lj = smokeLang ? `setLang('${smokeLang}');` : "";
          await mainWindow.webContents.executeJavaScript(`(function(){try{dark=${d};localStorage.setItem('theme','${d ? "dark" : "light"}');applyTheme();${lj}}catch(e){}})()`);
        }
        // Theme-Tests: GRAC ueberspringen (haengt bei Drosselung), damit schnell gerendert wird
        let js = `(async()=>{const r=await window.api.lookup("CUSA57547",{grac:false});renderLookup(r);})()`, name = "smoke.png", wait = 2500;
        if (smokePkg) {
          js = `(async()=>{document.querySelector('.tab[data-mode="pkg"]').click();
                 const r=await window.api.verifyPkg(${JSON.stringify(smokePkg)}, true); renderPkgVerify(r);})()`;
          name = "smoke_pkg.png";
        } else if (smokeWatch) {
          js = `(async()=>{document.querySelector('.tab[data-mode="watch"]').click();
                 await window.api.watchAdd("CUSA57547"); await window.api.watchAdd("CUSA57548");
                 await window.api.watchCheckNow(); await refreshWatch();})()`;
          name = "smoke_watch.png"; wait = 4000;
        } else if (smokeManifest) {
          js = `(async()=>{const r=await window.api.lookup("CUSA57547",{grac:false});renderLookup(r);
                 await new Promise((res)=>setTimeout(res,400));
                 const b=document.querySelector('.manifest-btn'); if(b) b.click();
                 await new Promise((res)=>setTimeout(res,2500));
                 const app=document.querySelector('.app'); if(app) app.scrollTop=app.scrollHeight;})()`;
          name = "smoke_manifest.png"; wait = 5000;
        }
        await mainWindow.webContents.executeJavaScript(js);
        await new Promise((r) => setTimeout(r, wait));
        const fs2 = require("node:fs");
        const png = (await mainWindow.webContents.capturePage()).toPNG();
        // cwd ist beschreibbar (im gepackten asar waere __dirname read-only)
        fs2.writeFileSync(path.join(process.cwd(), name), png);
        // Beweis-Probe: laufen Module + Netzwerk auch in der gepackten .exe?
        const probe = await doLookup("CUSA57547", { grac: false }).catch((e) => ({ error: String(e) }));
        fs2.writeFileSync(path.join(process.cwd(), "smoke_probe.json"), JSON.stringify({
          modulesOk: !!(PSN.fetchPatchInfo && GRAC.gracVerifyTitle && PKG.readPkgHeader),
          screenshotBytes: png.length,
          patchTitle: probe.patch?.parsed?.title || null,
          patchSizeGB: probe.patch?.parsed?.size ? (probe.patch.parsed.size / 1073741824).toFixed(2) : null,
          storeChecked: probe.effectiveId || null,
          error: probe.error || null,
        }, null, 2));
      } catch (e) { console.error("smoke error:", e); }
      app.quit();
    });
  }
}

// --- IPC ---
ipcMain.handle("lookup", (_e, { input, opts }) => doLookup(input, opts));
ipcMain.handle("store-search", (_e, { query, page }) => fetchStoreSearch(query, page || 1));
ipcMain.handle("grac", (_e, { title }) => GRAC.gracVerifyTitle(title));

// PKG-Datei waehlen (nativer Dialog)
ipcMain.handle("pick-pkg", async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: "PS4-PKG-Datei wählen",
    filters: [{ name: "PS4-Paket", extensions: ["pkg"] }, { name: "Alle Dateien", extensions: ["*"] }],
    properties: ["openFile"],
  });
  return r.canceled ? null : r.filePaths[0];
});

// PKG gegen Sonys ver.xml verifizieren. Liest Header -> CUSA -> ver.xml -> Abgleich.
ipcMain.handle("verify-pkg", async (e, { filePath, computeHash }) => {
  try {
    const header = await PKG.readPkgHeader(filePath);
    let ver = null;
    if (header.titleId) {
      const info = await PSN.fetchPatchInfo(header.titleId).catch(() => null);
      ver = info?.parsed || null;
    }
    return await PKG.verifyPkg(filePath, ver, {
      computeHash: !!computeHash,
      onProgress: (read, total) => { try { e.sender.send("hash-progress", { read, total }); } catch {} },
    });
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});
ipcMain.handle("app-info", () => ({
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
}));
ipcMain.handle("set-lang", (_e, lang) => { if (["de", "en", "tr"].includes(lang)) notifyLang = lang; });

// Text in die Zwischenablage. MUSS im Main-Prozess passieren: im (standardmaessig sandboxed)
// Preload ist Electrons clipboard-Modul nicht verfuegbar -> daher per IPC hierher.
ipcMain.handle("clipboard-write", (_e, text) => {
  try { clipboard.writeText(String(text ?? "")); return true; } catch { return false; }
});

// Manifest-Extraktor: holt die PlayGo-Manifest-JSON und liefert eine lesbare .pkg-Stueckliste.
// SSRF-Schutz: NUR *.dl.playstation.net erlaubt — die manifest_url stammt aus dem nicht-CA-
// validierten Patch-Kanal, darf die App also nicht auf beliebige Hosts locken. Rein lesend.
ipcMain.handle("manifest-pieces", async (_e, { url }) => {
  try {
    let u;
    try { u = new URL(String(url || "")); } catch { return { error: "Ungültige URL" }; }
    if (!/^https?:$/.test(u.protocol) || !/(^|\.)dl\.playstation\.net$/i.test(u.hostname)) {
      return { error: "Nur Hosts unter *.dl.playstation.net erlaubt." };
    }
    const r = await fetch(u.href, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (r.status !== 200) return { error: `HTTP ${r.status}` };
    const body = await PSN.readCapped(r, 8 * 1024 * 1024);   // DoS-Cap wie bei den anderen Fetches
    let j;
    try { j = JSON.parse(body); } catch { return { error: "Ungültiges Manifest-Format (keine JSON-Antwort)." }; }
    // Nur Stuecke MIT gueltiger URL uebernehmen — ein manipuliertes/kaputtes Manifest kann leere
    // enthalten; sonst wuerden "leere" Klick-zum-Kopieren-Zeilen entstehen. dropped = wie viele weg.
    const rawPieces = Array.isArray(j.pieces) ? j.pieces : [];
    const pieces = rawPieces.filter((p) => p && p.url);
    const dropped = rawPieces.length - pieces.length;
    // Gemeinsamen Host/Pfad + Dateinamen-Template ableiten (alle Stuecke teilen sie; nur _N.pkg differiert).
    let host = "", pathPrefix = "", fileTemplate = "";
    try {
      const fu = new URL(pieces[0] && pieces[0].url || "");
      host = fu.host;
      const slash = fu.pathname.lastIndexOf("/");
      pathPrefix = fu.pathname.slice(0, slash + 1);
      const fname = fu.pathname.slice(slash + 1);
      // Nur ersetzen, wenn das _N.pkg-Muster wirklich vorliegt (sonst echten Dateinamen zeigen).
      fileTemplate = /_\d+\.pkg$/i.test(fname) ? fname.replace(/_\d+\.pkg$/i, "_<N>.pkg") : fname;
    } catch { /* Stueck-URL unparsebar -> Felder bleiben leer */ }
    return {
      totalBytes: j.originalFileSize || 0,
      totalPretty: PSN.fmtBytes(j.originalFileSize || 0),
      digest: j.packageDigest || "",
      count: pieces.length,
      dropped,
      host, pathPrefix, fileTemplate,
      pieces: pieces.map((p, i) => {
        let file = "";
        try { const pu = new URL(p.url || ""); file = pu.pathname.slice(pu.pathname.lastIndexOf("/") + 1); }
        catch { file = String(p.url || ""); }
        const suffix = (file.match(/_\d+\.pkg$/i) || [file])[0];
        return { i, file, suffix, sizePretty: PSN.fmtBytes(p.fileSize || 0), hashValue: p.hashValue || "", url: p.url || "" };
      }),
      allUrls: pieces.map((p) => p.url).filter(Boolean).join("\n"),
    };
  } catch (e) {
    return { error: e.message || String(e) };
  }
});
ipcMain.handle("win", (_e, action) => {
  if (!mainWindow) return;
  if (action === "theme-dark") nativeTheme.themeSource = "dark";
  else if (action === "theme-light") nativeTheme.themeSource = "light";
  else if (action === "theme-system") nativeTheme.themeSource = "system";
  // setTitleBarOverlay ist Windows/Linux-only; auf macOS existiert die Methode nicht (wuerde werfen).
  if (process.platform !== "darwin" && typeof mainWindow.setTitleBarOverlay === "function") {
    mainWindow.setTitleBarOverlay(overlayColors());
  }
});

// ===================== Live-Watcher =====================
const watch = { running: false, intervalMs: 15 * 60 * 1000, targets: [], state: {}, log: [], timer: null, nextCheck: null };

function watchFile() { return path.join(app.getPath("userData"), "watch.json"); }
async function loadWatch() {
  try {
    const j = JSON.parse(await fsp.readFile(watchFile(), "utf8"));
    watch.targets = j.targets || [];
    watch.state = j.state || {};
    watch.log = j.log || [];
    if (j.intervalMs) watch.intervalMs = j.intervalMs;
  } catch { /* erste Nutzung */ }
}
async function saveWatch() {
  try {
    await fsp.writeFile(watchFile(), JSON.stringify({
      targets: watch.targets, state: watch.state, log: watch.log.slice(-100), intervalMs: watch.intervalMs,
    }, null, 2));
  } catch (e) { /* egal */ }
}

// Relevanten Zustand aus einem Lookup ziehen. GRAC nur uebernehmen, wenn diesmal
// erfolgreich abgefragt — sonst den alten Wert behalten (null = noch nie geklappt).
function watchSnapshot(data, prev) {
  let gracFresh = prev?.gracFresh ?? null;
  if (data.grac && !data.grac.error) {
    gracFresh = (data.grac.entries || []).filter(e => (e.fileDate || "") >= "2026-01-01").length;
  }
  return {
    name: data.patch?.parsed?.title || data.store?.us?.name || data.store?.de?.name || prev?.name || null,
    patchVer: data.patch?.parsed?.version || null,
    patchSize: data.patch?.parsed?.size || 0,
    storeUS: !!data.store?.us,
    storeDE: !!data.store?.de,
    gracFresh,
  };
}
// Was hat sich gegenueber dem letzten Check geaendert? (Erstcheck = Baseline, keine Meldung.)
// Liefert Aenderungen als sprachneutrale {code, params} (Renderer/Notification uebersetzen).
function diffSnapshot(prev, now) {
  if (!prev) return [];
  const ch = [];
  if (!prev.storeUS && now.storeUS) ch.push({ code: "usLive" });
  if (!prev.storeDE && now.storeDE) ch.push({ code: "deLive" });
  if (prev.storeUS && !now.storeUS) ch.push({ code: "usGone" });
  if (prev.storeDE && !now.storeDE) ch.push({ code: "deGone" });
  if (now.patchVer && prev.patchVer !== now.patchVer) ch.push({ code: "patchVer", params: { prev: prev.patchVer || "?", now: now.patchVer } });
  else if (now.patchSize && prev.patchSize !== now.patchSize) ch.push({ code: "patchSize", params: { size: PSN.fmtBytes(now.patchSize) } });
  if (now.gracFresh != null && prev.gracFresh != null && now.gracFresh > prev.gracFresh) ch.push({ code: "gracNew" });
  return ch;
}

// Kleines Dict nur fuer die Desktop-Notifications (Main-Prozess kennt die Renderer-i18n nicht).
let notifyLang = "de";
const WCHG = {
  de: { usLive: "🎉 Jetzt im US-Store LIVE", deLive: "🎉 Jetzt im DE-Store LIVE", usGone: "US-Store: wieder entfernt", deGone: "DE-Store: wieder entfernt", patchVer: "Patch-Version {prev} → {now}", patchSize: "Paket-Größe → {size}", gracNew: "Neuer Korea-Rating-Eintrag" },
  en: { usLive: "🎉 Now LIVE in the US store", deLive: "🎉 Now LIVE in the DE store", usGone: "US store: removed again", deGone: "DE store: removed again", patchVer: "Patch version {prev} → {now}", patchSize: "Package size → {size}", gracNew: "New Korea rating entry" },
  tr: { usLive: "🎉 Artık ABD mağazasında YAYINDA", deLive: "🎉 Artık DE mağazasında YAYINDA", usGone: "ABD mağazası: tekrar kaldırıldı", deGone: "DE mağazası: tekrar kaldırıldı", patchVer: "Yama sürümü {prev} → {now}", patchSize: "Paket boyutu → {size}", gracNew: "Yeni Kore derecelendirme kaydı" },
};
function wchgText(c) {
  if (typeof c === "string") return c;
  let s = (WCHG[notifyLang] || WCHG.de)[c.code] || c.code;
  if (c.params) for (const k in c.params) s = s.split("{" + k + "}").join(c.params[k]);
  return s;
}

async function watchTickOne(target) {
  const prev = watch.state[target];
  // GRAC nur abfragen, solange noch kein erfolgreicher Wert vorliegt (Rating ist
  // statisch) — schont den GRAC-Server, der bei Last drosselt.
  const needGrac = !prev || prev.gracFresh == null;
  const data = await doLookup(target, { grac: needGrac });
  const now = watchSnapshot(data, prev);
  now.lastCheck = new Date().toISOString();
  const changes = diffSnapshot(prev, now);
  watch.state[target] = now;
  if (mainWindow) mainWindow.webContents.send("watch-status", { target, snap: now });
  if (changes.length) {
    const entry = { target, name: now.name, changes, at: now.lastCheck };
    watch.log.push(entry);
    if (mainWindow) mainWindow.webContents.send("watch-change", entry);
    try { new Notification({ title: now.name || target, body: changes.map(wchgText).join(" · ") }).show(); } catch {}
  }
}
async function watchTick() {
  for (const t of watch.targets) {
    try { await watchTickOne(t); } catch { /* einzelnes Target-Fehler ignorieren */ }
  }
  watch.nextCheck = Date.now() + watch.intervalMs;
  await saveWatch();
  if (mainWindow) mainWindow.webContents.send("watch-tick", { nextCheck: watch.nextCheck, running: watch.running });
}
function startWatch(intervalMin) {
  if (watch.timer) clearInterval(watch.timer);
  if (intervalMin) watch.intervalMs = Math.max(1, Number(intervalMin) || 15) * 60 * 1000;
  watch.running = true;
  watchTick();
  watch.timer = setInterval(watchTick, watch.intervalMs);
}
function stopWatch() {
  if (watch.timer) clearInterval(watch.timer);
  watch.timer = null;
  watch.running = false;
  watch.nextCheck = null;
}

ipcMain.handle("watch-get", () => ({
  running: watch.running, intervalMin: Math.round(watch.intervalMs / 60000),
  targets: watch.targets, state: watch.state, log: watch.log.slice(-50), nextCheck: watch.nextCheck,
}));
ipcMain.handle("watch-add", async (_e, { target }) => {
  const t = String(target || "").trim().toUpperCase();
  if (t && !watch.targets.includes(t)) watch.targets.push(t);
  await saveWatch();
  return watch.targets;
});
ipcMain.handle("watch-remove", async (_e, { target }) => {
  watch.targets = watch.targets.filter(x => x !== target);
  delete watch.state[target];
  await saveWatch();
  return watch.targets;
});
ipcMain.handle("watch-start", (_e, { intervalMin }) => { startWatch(intervalMin); return { running: true }; });
ipcMain.handle("watch-stop", async () => { stopWatch(); await saveWatch(); return { running: false }; });
ipcMain.handle("watch-check-now", async () => { await watchTick(); return { ok: true }; });

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.tee.ps-game-checker"); // korrekte Windows-Benachrichtigungen
  } else if (process.platform === "darwin") {
    // Natives macOS-Menue: App (Ueber/Beenden Cmd+Q) + Edit (Cmd+C/V/X/A/Z in Feldern) + Fenster.
    app.setName("TEE PS Game Checker");
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" },
    ]));
  }
  await loadWatch();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
