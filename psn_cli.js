#!/usr/bin/env node
// psn_cli.js - Interaktives TUI fuer psn_check.js
//
// Menue-gefuehrte Bedienung der CUSA/Patch-Server-Checks ohne Kommandozeilen-Flags.
// Spawned psn_check.js als child-process - alle Funktionalitaeten verfuegbar.

const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const lib = require("./psn_check.js");

const HOME = process.env.HOME || ".";
const CHECKER = path.join(HOME, "psn_check.js");
const WATCH_LOG = path.join(HOME, "psn_watch.log");
const STATE_FILE = path.join(HOME, ".psn_check_state.json");
const PID_FILE = path.join(HOME, ".psn_watch.pid");

// ANSI colors
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

const PRESETS = {
  bo: { name: "Black Ops 1 + 2 (Leak-Verifikation)", args: ["CUSA57547", "CUSA57548"] },
  bo1: { name: "Black Ops 1 (CUSA57547)", args: ["CUSA57547"] },
  bo2: { name: "Black Ops 2 (CUSA57548)", args: ["CUSA57548"] },
  mw: { name: "Modern Warfare 2019 (Sanity-Check, sollte funktionieren)", args: ["UP0002-CUSA08829_00-CODMWTHEGAME0001"] },
  gta: { name: "GTA V Cross-Gen Bundle (Sanity-Check)", args: ["UP1004-PPSA03420_00-GTAVCROSSGENBUND"] },
};

function banner() {
  console.clear();
  console.log(`${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║      PSN Store Checker - Interactive CLI                ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}║      Sony patch-server + Consumer-API + PlatPrices       ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════╝${C.reset}`);
  const watcher = getWatcherStatus();
  if (watcher.running) {
    console.log(`  ${C.green}● Watcher laeuft${C.reset}  PID ${watcher.pid}  ${C.dim}(${WATCH_LOG})${C.reset}`);
  } else {
    console.log(`  ${C.dim}○ Kein Watcher aktiv${C.reset}`);
  }
  console.log();
}

function menu() {
  console.log(`${C.bold}Was willst du tun?${C.reset}`);
  console.log(`  ${C.green}[1]${C.reset} Schnellcheck: ${C.bold}Black Ops 1 + 2${C.reset} (CUSA57547 + CUSA57548)`);
  console.log(`  ${C.green}[2]${C.reset} Eigene CUSA pruefen (z.B. CUSA12345)`);
  console.log(`  ${C.green}[3]${C.reset} Volle Produkt-ID pruefen (UP0002-CUSAxxxxx_00-...)`);
  console.log(`  ${C.green}[4]${C.reset} Sanity-Check Auswahl (MW 2019, GTA V, etc.)`);
  console.log(`  ${C.green}[5]${C.reset} Multi-Region-Check (DE/US/JP)`);
  console.log(`  ${C.cyan}[s]${C.reset} ${C.bold}Suche${C.reset} im PS Store (z.B. "Black Ops") - paginierte Treffer`);
  console.log(`  ${C.yellow}[6]${C.reset} Watcher starten (Hintergrund, 15min Intervall)`);
  console.log(`  ${C.yellow}[7]${C.reset} Watcher-Log anschauen (tail -20)`);
  console.log(`  ${C.yellow}[8]${C.reset} Watcher stoppen`);
  console.log(`  ${C.blue}[9]${C.reset} State-Datei anzeigen (~/.psn_check_state.json)`);
  console.log(`  ${C.magenta}[0]${C.reset} Hilfe vom Checker (--help)`);
  console.log(`  ${C.red}[q]${C.reset} Beenden`);
  console.log();
}

function runChecker(args, opts = {}) {
  return new Promise((resolve) => {
    console.log(`${C.dim}> node psn_check.js ${args.join(" ")}${C.reset}\n`);
    const child = spawn("node", [CHECKER, ...args], { stdio: ["ignore", "inherit", "inherit"] });
    child.on("close", (code) => resolve(code));
  });
}

function getWatcherStatus() {
  if (!fs.existsSync(PID_FILE)) return { running: false };
  const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
  if (!pid) return { running: false };
  try {
    process.kill(pid, 0); // signal 0 = check existence
    return { running: true, pid };
  } catch {
    fs.unlinkSync(PID_FILE);
    return { running: false };
  }
}

function startWatcher(targets, intervalMin = 15) {
  const status = getWatcherStatus();
  if (status.running) {
    console.log(`${C.yellow}! Watcher laeuft bereits${C.reset} (PID ${status.pid}). Erst stoppen.\n`);
    return;
  }
  const args = [CHECKER, ...targets, "--watch", String(intervalMin), "--quiet-404"];
  const out = fs.openSync(WATCH_LOG, "a");
  const child = spawn("node", args, {
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log(`${C.green}✓ Watcher gestartet${C.reset}  PID ${child.pid}  Intervall ${intervalMin}min`);
  console.log(`  Log:   ${WATCH_LOG}`);
  console.log(`  Target: ${targets.join(", ")}\n`);
}

function stopWatcher() {
  const status = getWatcherStatus();
  if (!status.running) {
    console.log(`${C.dim}Kein Watcher aktiv.${C.reset}\n`);
    return;
  }
  try {
    process.kill(status.pid, "SIGTERM");
    fs.unlinkSync(PID_FILE);
    console.log(`${C.green}✓ Watcher gestoppt${C.reset} (PID ${status.pid})\n`);
  } catch (e) {
    console.log(`${C.red}! Stop fehlgeschlagen:${C.reset} ${e.message}\n`);
  }
}

function showWatchLog() {
  if (!fs.existsSync(WATCH_LOG)) {
    console.log(`${C.dim}Kein Log da: ${WATCH_LOG}${C.reset}\n`);
    return;
  }
  const stat = fs.statSync(WATCH_LOG);
  console.log(`${C.dim}== ${WATCH_LOG} (${stat.size} bytes, modified ${stat.mtime.toISOString().slice(0,19)}) ==${C.reset}`);
  const r = spawnSync("tail", ["-30", WATCH_LOG], { encoding: "utf8" });
  console.log(r.stdout || "(leer)");
  console.log();
}

function showState() {
  if (!fs.existsSync(STATE_FILE)) {
    console.log(`${C.dim}Keine State-Datei: ${STATE_FILE}${C.reset}\n`);
    return;
  }
  const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  console.log(`${C.dim}== ${STATE_FILE} ==${C.reset}`);
  for (const [token, info] of Object.entries(data)) {
    console.log(`${C.bold}${token}${C.reset}`);
    console.log(`  Letzter Check:  ${info.lastCheck}  (tick ${info.lastTick})`);
    if (info.patchVer)   console.log(`  Patch-Version:  v${info.patchVer}`);
    if (info.patchSize)  console.log(`  Patch-Groesse:  ${(info.patchSize/1024/1024/1024).toFixed(2)} GB`);
    if (info.foundIds?.length) console.log(`  Live im Store:  ${info.foundIds.join(", ")}`);
    if (info.platIds?.length)  console.log(`  PlatPrices IDs: ${info.platIds.join(", ")}`);
  }
  console.log();
}

// Queue-basierter Input: liest stdin event-driven, ask() pollt aus der Queue.
// Robuster gegenueber piped stdin als readline.question().
const _lineQueue = [];
const _waiters = [];
let _stdinEnded = false;

function setupInput(rl) {
  rl.on("line", (line) => {
    if (_waiters.length) _waiters.shift()(line);
    else _lineQueue.push(line);
  });
  rl.on("close", () => {
    _stdinEnded = true;
    while (_waiters.length) _waiters.shift()(null);
  });
}

function ask(_rl, q) {
  if (q) process.stdout.write(q);
  return new Promise(res => {
    if (_lineQueue.length) return res(_lineQueue.shift().trim());
    if (_stdinEnded) return res("");
    _waiters.push(line => res((line || "").trim()));
  });
}

function box(title, width = 64) {
  const pad = " ".repeat(Math.max(0, width - title.length - 4));
  return [
    `${C.bold}${C.cyan}╔${"═".repeat(width-2)}╗${C.reset}`,
    `${C.bold}${C.cyan}║  ${C.white}${title}${pad}${C.cyan}║${C.reset}`,
    `${C.bold}${C.cyan}╚${"═".repeat(width-2)}╝${C.reset}`,
  ].join("\n");
}

function row(label, value, opts = {}) {
  if (value === null || value === undefined || value === "") {
    return `  ${C.dim}${label.padEnd(15)}${C.reset}  ${C.dim}-${C.reset}`;
  }
  const color = opts.color || C.white;
  return `  ${C.bold}${label.padEnd(15)}${C.reset}  ${color}${value}${C.reset}`;
}

function checkmark(b, trueLabel = "ja", falseLabel = "nein") {
  if (b === true)  return `${C.green}✅ ${trueLabel}${C.reset}`;
  if (b === false) return `${C.red}❌ ${falseLabel}${C.reset}`;
  return `${C.dim}?${C.reset}`;
}

function decodeSystemVer(sysVer) {
  // PS4 system_ver is a 32-bit field; firmware version embedded in upper bytes.
  // Heuristic: ((n >> 24) & 0xff).((n >> 16) & 0xff) is typical for major.minor.
  const n = Number(sysVer);
  if (!Number.isFinite(n) || n === 0) return null;
  const major = (n >> 24) & 0xff;
  const minor = (n >> 16) & 0xff;
  // Decimal-encoded BCD style (e.g. 9.50 stored as 0x0950 in upper 16 bits)
  const bcd_major = (major >> 4) * 10 + (major & 0x0f);
  const bcd_minor = (minor >> 4) * 10 + (minor & 0x0f);
  return `${bcd_major}.${String(bcd_minor).padStart(2, "0")}`;
}

async function showRichDetail(productId, presetName = null) {
  const cusaMatch = productId.match(/CUSA\d+/);
  if (!cusaMatch) {
    console.log(`${C.red}Ungueltige Product-ID:${C.reset} ${productId}`);
    return;
  }
  const cusa = cusaMatch[0];

  console.log(`\n${C.dim}Hole Daten von Sony patch-server + Consumer-API (en-us, de-de) ...${C.reset}\n`);

  const [patch, gqlUs, gqlDe] = await Promise.all([
    lib.fetchPatchInfo(cusa),
    lib.gqlProduct(productId, "en-US", lib.DEFAULT_HASH_PRODUCT),
    lib.gqlProduct(productId, "de-DE", lib.DEFAULT_HASH_PRODUCT),
  ]);

  const gql = lib.summarizeProduct(gqlUs.json) || lib.summarizeProduct(gqlDe.json);
  const inStoreUs = !!lib.summarizeProduct(gqlUs.json);
  const inStoreDe = !!lib.summarizeProduct(gqlDe.json);
  const title = patch?.parsed?.title || gql?.name || presetName || "(unbekannter Titel)";

  console.log(box(title));
  console.log();
  console.log(`${C.bold}Produkt-Daten${C.reset}`);
  console.log(row("Product ID", productId, { color: C.cyan }));
  console.log(row("CUSA-Code", cusa, { color: C.cyan }));
  if (gql?.publisher) console.log(row("Publisher", gql.publisher));
  if (gql?.npTitleId) console.log(row("NP Title ID", gql.npTitleId));

  if (patch?.parsed) {
    const p = patch.parsed;
    const fw = decodeSystemVer(p.systemVer);
    console.log();
    console.log(`${C.bold}📦 Download (Sony Patch-Server)${C.reset}`);
    console.log(row("Groesse", `${lib.fmtBytes(p.size)}  ${C.dim}(${p.size.toLocaleString()} bytes)${C.reset}`, { color: C.green }));
    console.log(row("Version", p.version));
    console.log(row("Typ", p.type));
    console.log(row("PlayGo", checkmark(p.patchgo, "ja", "nein")));
    console.log(row("remaster-Flag", `${p.remaster}  ${C.dim}(technisches Patch-Flag, KEIN Remaster-Indikator)${C.reset}`));
    if (fw) console.log(row("Min PS4 FW", fw));
    console.log(row("Content ID", p.contentId, { color: C.dim }));
    if (p.digest) console.log(row("Digest", `${p.digest.slice(0, 32)}... ${C.dim}(SHA-256)${C.reset}`));
  } else if (patch?.notFound) {
    console.log();
    console.log(`${C.yellow}📦 Sony Patch-Server: nicht im Backend registriert${C.reset}`);
  } else if (patch?.error) {
    console.log();
    console.log(`${C.red}📦 Sony Patch-Server: Fehler${C.reset} ${patch.error}`);
  }

  console.log();
  console.log(`${C.bold}📅 Store-Listing (Consumer-API)${C.reset}`);
  console.log(row("US Store", checkmark(inStoreUs, "live", "nicht gelistet")));
  console.log(row("DE Store", checkmark(inStoreDe, "live", "nicht gelistet")));
  if (gql) {
    console.log(row("Release", gql.release));
    console.log(row("Genres", gql.genres));
    console.log(row("Klassifik.", gql.classification));
    if (gql.short) console.log(row("Tagline", gql.short.slice(0, 60)));
  }

  if (patch?.parsed) {
    console.log();
    console.log(`${C.bold}🔗 Quellen${C.reset}`);
    console.log(`  ${C.dim}ver.xml:${C.reset}    ${patch.url}`);
    console.log(`  ${C.dim}Manifest:${C.reset}   ${patch.parsed.manifestUrl}`);
  }
  console.log();
}

async function fetchSearchPage(query, page, locale = "en-us") {
  const url = `https://store.playstation.com/${locale}/search/${encodeURIComponent(query)}/${page}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": locale } });
    if (r.status !== 200) return { error: `HTTP ${r.status}`, results: [] };
    const body = await r.text();
    const m = body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (!m) return { error: "no nextdata", results: [] };
    const data = JSON.parse(m[1]);
    const apollo = data?.props?.apolloState || {};
    const seen = new Set();
    const results = [];
    for (const k of Object.keys(apollo)) {
      if (!k.startsWith("Product:")) continue;
      // Key format: "Product:<productId>:<locale>"
      const productId = k.slice("Product:".length).replace(/:[a-z]{2}-[a-z]{2}$/, "");
      if (seen.has(productId)) continue;
      seen.add(productId);
      const name = apollo[k]?.name;
      if (name) results.push({ productId, name });
    }
    return { results };
  } catch (e) {
    return { error: String(e), results: [] };
  }
}

async function searchFlow(rl) {
  const q = await ask(rl, `${C.cyan}Suchbegriff:${C.reset} `);
  if (!q) return;

  console.log(`${C.dim}Hole Seite 1 von store.playstation.com ...${C.reset}`);
  let page = 1;
  const buffer = []; // alle bisher geladenen results, alphabetisch sortiert
  let exhausted = false;

  async function loadNextSonyPage() {
    if (exhausted) return false;
    const r = await fetchSearchPage(q, page);
    page++;
    if (r.error) {
      console.log(`${C.red}! ${r.error}${C.reset}`);
      exhausted = true;
      return false;
    }
    if (r.results.length === 0) {
      exhausted = true;
      return false;
    }
    // duplikate filtern (ueber productId)
    const known = new Set(buffer.map(x => x.productId));
    for (const x of r.results) if (!known.has(x.productId)) buffer.push(x);
    buffer.sort((a, b) => a.name.localeCompare(b.name));
    if (r.results.length < 24) exhausted = true; // letzte Seite war kurz
    return true;
  }

  await loadNextSonyPage();
  if (buffer.length === 0) {
    console.log(`${C.yellow}Keine Treffer fuer "${q}".${C.reset}\n`);
    return;
  }

  let offset = 0;
  const PAGE_SIZE = 10;
  while (true) {
    // Wenn fast am Ende vom Buffer -> noch eine Sony-Seite nachladen
    if (offset + PAGE_SIZE >= buffer.length && !exhausted) {
      console.log(`${C.dim}... Sony-Seite ${page} nachladen ...${C.reset}`);
      await loadNextSonyPage();
    }

    const slice = buffer.slice(offset, offset + PAGE_SIZE);
    if (slice.length === 0) {
      console.log(`${C.dim}Keine weiteren Treffer.${C.reset}\n`);
      break;
    }

    console.log(`\n${C.bold}=== "${q}" - Treffer ${offset+1}-${offset+slice.length} (von ${buffer.length}${exhausted ? "" : "+"}) ===${C.reset}`);
    slice.forEach((r, i) => {
      const num = String(offset + i + 1).padStart(3, " ");
      console.log(`  ${C.green}[${num}]${C.reset} ${r.name}`);
      console.log(`        ${C.dim}${r.productId}${C.reset}`);
    });

    console.log();
    console.log(`  ${C.cyan}[n]${C.reset}  naechste 10`);
    console.log(`  ${C.cyan}[p]${C.reset}  vorherige 10`);
    console.log(`  ${C.cyan}[<nr>]${C.reset}  Produkt pruefen (z.B. ${offset+1})`);
    console.log(`  ${C.cyan}[b]${C.reset}  zurueck zum Hauptmenu`);

    const a = (await ask(rl, "> ")).toLowerCase();
    if (a === "b" || a === "q" || a === "") return;
    if (a === "n") { offset += PAGE_SIZE; continue; }
    if (a === "p") { offset = Math.max(0, offset - PAGE_SIZE); continue; }
    if (/^\d+$/.test(a)) {
      const idx = Number(a) - 1;
      if (idx >= 0 && idx < buffer.length) {
        await showRichDetail(buffer[idx].productId, buffer[idx].name);
        await ask(rl, `${C.dim}[Enter] zurueck zur Suche ...${C.reset}`);
      } else {
        console.log(`${C.red}Nummer ausserhalb des Bereichs.${C.reset}`);
      }
      continue;
    }
    console.log(`${C.red}Unbekannte Eingabe.${C.reset}`);
  }
}

async function chooseSanity(rl) {
  console.log(`${C.bold}Sanity-Check Auswahl:${C.reset}`);
  const keys = Object.keys(PRESETS);
  keys.forEach((k, i) => {
    console.log(`  ${C.green}[${i+1}]${C.reset} ${PRESETS[k].name}`);
  });
  console.log(`  ${C.dim}[Enter]${C.reset} zurueck\n`);
  const a = await ask(rl, "> ");
  if (!a) return;
  const idx = Number(a) - 1;
  if (idx < 0 || idx >= keys.length) {
    console.log(`${C.red}Ungueltige Auswahl.${C.reset}\n`);
    return;
  }
  const preset = PRESETS[keys[idx]];
  await runChecker(preset.args);
  console.log();
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });
  setupInput(rl);

  while (true) {
    banner();
    menu();
    const choice = (await ask(rl, "> ")).toLowerCase();
    console.log();

    if (choice === "q" || choice === "quit" || choice === "exit") {
      console.log(`${C.dim}Bye.${C.reset}`);
      rl.close();
      break;
    }

    switch (choice) {
      case "1":
        await runChecker(PRESETS.bo.args);
        break;
      case "2": {
        const c = await ask(rl, "CUSA-Code (z.B. CUSA57547): ");
        if (!c) break;
        if (!/^CUSA\d+$/i.test(c)) {
          console.log(`${C.red}Ungueltiges Format.${C.reset}`);
          break;
        }
        // Bei nur-CUSA: koennen wir noch keinen vollen ProductId konstruieren.
        // showRichDetail braucht eine volle ID fuer GraphQL, kann aber mit
        // Patch-Info-only umgehen wenn GraphQL leer ist.
        await showRichDetail(c.toUpperCase());
        break;
      }
      case "3": {
        const p = await ask(rl, "Volle Product-ID: ");
        if (!p) break;
        await showRichDetail(p);
        break;
      }
      case "4":
        await chooseSanity(rl);
        break;
      case "5": {
        const t = await ask(rl, "CUSA oder Product-ID: ");
        if (!t) break;
        await runChecker([t, "--locales", "de-de", "en-us", "ja-jp", "--quiet-404"]);
        break;
      }
      case "6": {
        const def = "CUSA57547 CUSA57548";
        const t = await ask(rl, `Targets (Enter = ${def}): `);
        const intervalStr = await ask(rl, "Intervall in Minuten (Enter = 15): ");
        const targets = (t || def).split(/\s+/).filter(Boolean);
        const interval = Number(intervalStr) || 15;
        startWatcher(targets, interval);
        break;
      }
      case "7":
        showWatchLog();
        break;
      case "8":
        stopWatcher();
        break;
      case "9":
        showState();
        break;
      case "0":
        await runChecker(["--help"]);
        break;
      case "s":
        await searchFlow(rl);
        break;
      default:
        console.log(`${C.red}Unbekannte Auswahl.${C.reset}`);
    }
    await ask(rl, `${C.dim}[Enter] fuer Menue ...${C.reset}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
