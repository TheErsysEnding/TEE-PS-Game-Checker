#!/usr/bin/env node
// psn_check.js - PSN Store metadata checker.
//
// Was es kann:
//   - Titel, Release-Datum, Beschreibung, Publisher, Klassifizierung (per Region)
//   - Optional: Download-Groesse via PlatPrices (braucht kostenlosen API-Key)
//
// Was es NICHT kann:
//   - Download-Groesse aus dem Consumer-Endpoint von Sony. Sonys oeffentliche
//     GraphQL-API (`metGetProductById`) gibt schlicht kein Groessenfeld zurueck.
//     Die Groesse kommt vom Delivery-CDN und ist nur ueber Tracker wie
//     PlatPrices/billbil-kun/PlayStationSize indirekt abrufbar.
//   - Unveroeffentlichte Produkte zeigen (Backend-Staging ist nicht ueber das
//     Consumer-API erreichbar - das machen nur privilegierte Datamine-Accounts).
//
// Eingabeformate:
//   - Volle Produkt-ID:   UP0002-CUSA08829_00-CODMWTHEGAME0001
//   - Store-URL:          https://store.playstation.com/de-de/product/UP0002-...
//   - Nur CUSA-Code:      CUSA57547  (probiert mehrere Region-Praefixe und
//                                     gaengige Aktivision-SKU-Suffixes)
//
// Optionen:
//   --locales de-de en-us ja-jp     Regionen abfragen
//   --platprices <KEY>              Groessen via PlatPrices (env PLATPRICES_KEY auch ok)
//   --hash <SHA256>                 metGetProductById-Hash ueberschreiben (falls Sony rotiert)
//   --quiet-404                     Bei CUSA-Probing 404er nicht ausgeben
//
// Beispiele:
//   node psn_check.js UP0002-CUSA08829_00-CODMWTHEGAME0001
//   node psn_check.js CUSA57547 CUSA57548 --quiet-404
//   PLATPRICES_KEY=xxx node psn_check.js UP0002-CUSA08829_00-CODMWTHEGAME0001 --platprices

const GRAPHQL_ENDPOINT = "https://web.np.playstation.com/api/graphql/v1/op";

// Sony PS4 patch server - liefert ver.xml mit Groesse + Content-ID + Manifest-URL
// fuer ALLE registrierten PS4-Titel, auch unveroeffentlichte. Self-signed TLS cert.
const PATCH_HMAC_KEY = Buffer.from(
  "AD62E37F905E06BC19593142281C112CEC0E7EC3E97EFDCAEFCDBAAFA6378D84", "hex"
);
const PATCH_HOST = "gs-sec.ww.np.dl.playstation.net";

// Persisted-query-Hashes (Stand 2026, aus mrt1m/playstation-store-api Postman-Collection).
// Falls Sony die Queries aendert -> --hash <neuer> ueberschreiben oder
// frischen Hash aus dem Network-Tab kopieren.
const DEFAULT_HASH_PRODUCT = "a128042177bd93dd831164103d53b73ef790d56f51dae647064cb8f9d9fc9d1a";

const DEFAULT_LOCALES = ["de-de", "en-us"];

// Bei nur-CUSA-Eingabe probieren wir diese Region-Praefixe.
// Activision hat historisch UP0002/EP0002/HP0002/JP0002 genutzt.
const CUSA_GUESS_PREFIXES = ["UP0002", "EP0002", "HP0002", "JP0002"];
const CUSA_BRUTE_PREFIXES = ["UP0002", "EP0002", "HP0002", "JP0002", "KP0002", "NP0002"];

// SKU-Suffix-Kandidaten - aus den bekannten Activision-Mustern abgeleitet.
// Reales Beispiel: MW 2019 = CODMWTHEGAME0001, MW II = CODMWIITHEGAME01
const CUSA_GUESS_SUFFIXES = [
  // Bekannte Patterns (aus historischen CoD-Releases)
  "CODBLACKOPSGAME01",
  "CODBO1THEGAME0001",
  "CODBO2THEGAME0001",
  "COD0BLACKOPS00000",
];
// --brute aktiviert diese zusaetzlich (~60 Kandidaten/CUSA).
const CUSA_BRUTE_SUFFIXES = [
  // BO1-spezifisch
  "CODBLACKOPS000001", "CODBLACKOPS000000", "CODBLACKOPS00001",
  "CODBO1THEGAME0001", "CODBO1THEGAME0002", "CODBO1THEGAME000",
  "COD0BLACKOPS00000", "COD0BLACKOPS00001", "COD0BO00000000000",
  "CALLOFDUTYBO0001", "CALLOFDUTYBO00001",
  "BLACKOPSGAME00001", "BLACKOPS00000_GAME", "BLACKOPS1GAME0001",
  // BO2-spezifisch
  "CODBO2THEGAME0001", "CODBO2THEGAME0002",
  "COD0BO2000000000", "COD0BO2000000001",
  "CODBLACKOPS200001", "CODBLACKOPSII0001",
  "BLACKOPS2GAME0001", "BLACKOPSIIGAME001",
  // Generisch (Bundle/Deluxe/Crossgen-Varianten)
  "CODBLACKOPSGAME01", "CODBLACKOPSBUNDLE",
  "CODBO1BUNDLE00001", "CODBO2BUNDLE00001",
  "CODBO1DELUXE00001", "CODBO2DELUXE00001",
  "CODBO1CROSSGEN001", "CODBO2CROSSGEN001",
  // PPSA-Style (PS5-native)
  "BO1THEGAME0000001", "BO2THEGAME0000001",
  "BLACKOPS100000001", "BLACKOPS200000001",
];

const FULL_ID_RE = /\b([A-Z]{2}\d{4}-(?:CUSA|PPSA)\d{4,5}_\d{2}-[A-Z0-9]+)\b/;
const CUSA_RE = /\b(CUSA\d{4,5})\b/i;

function parseArgs(argv) {
  const out = {
    targets: [], locales: DEFAULT_LOCALES,
    hash: DEFAULT_HASH_PRODUCT,
    platpricesKey: process.env.PLATPRICES_KEY || null,
    platpricesName: null,
    quiet404: false,
    watchMinutes: 0,
    brute: false,
    patch: true, // default ON: Sony patch-server ist der zuverlaessigste Pfad
    concurrency: 5,
  };
  let mode = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--locales") { mode = "locales"; out.locales = []; continue; }
    if (a === "--platprices") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { out.platpricesKey = next; i++; }
      else if (!out.platpricesKey) { console.error("--platprices needs key or env PLATPRICES_KEY"); process.exit(2); }
      mode = null;
      continue;
    }
    if (a === "--hash") { out.hash = argv[++i]; mode = null; continue; }
    if (a === "--platprices-name") { out.platpricesName = argv[++i]; mode = null; continue; }
    if (a === "--patch") { out.patch = true; mode = null; continue; }
    if (a === "--brute") { out.brute = true; mode = null; continue; }
    if (a === "--concurrency") { out.concurrency = Math.max(1, Number(argv[++i]) || 5); mode = null; continue; }
    if (a === "--quiet-404") { out.quiet404 = true; mode = null; continue; }
    if (a === "--no-patch") { out.patch = false; mode = null; continue; }
    if (a === "--watch") {
      const next = argv[i + 1];
      const n = next && /^\d+$/.test(next) ? Number(next) : null;
      if (n !== null) { out.watchMinutes = n; i++; } else { out.watchMinutes = 15; }
      mode = null;
      continue;
    }
    if (a === "-h" || a === "--help") { console.log(HELP); process.exit(0); }
    if (mode === "locales") {
      if (a.startsWith("--")) { mode = null; }
      else { out.locales.push(a.toLowerCase()); continue; }
    }
    out.targets.push(a);
  }
  if (out.locales.length === 0) out.locales = DEFAULT_LOCALES;
  return out;
}

const HELP = `Usage: node psn_check.js <id-or-url-or-cusa> [...] [options]

Options:
  --locales <locales...>     z. B. de-de en-us ja-jp  (default: de-de en-us)
  --platprices [<KEY>]       Groessen via PlatPrices (Key auch via env PLATPRICES_KEY)
                             Hol dir einen kostenlosen Key auf platprices.com/developers.php
  --platprices-name <QUERY>  PlatPrices-Namenssuche (z.B. "Black Ops") - liefert volle ID + Sizes
                             auch wenn das Consumer-API noch nichts kennt. Braucht --platprices.
  --hash <SHA256>            metGetProductById-Hash ueberschreiben
  --quiet-404                CUSA-Probing-404er nicht ausgeben
  --brute                    Aggressive SKU-Suffix-Liste (~60 Kandidaten/CUSA statt 12)
                             + mehr Region-Praefixe. Achtung: laengere Ticks, mehr API-Last.
  --patch / --no-patch       Sony patch-server ver.xml abfragen (default: ON).
                             Liefert die echte Paket-Groesse + Content-ID auch fuer
                             unveroeffentlichte Titel - praezisester Pfad.
  --concurrency <N>          Parallele Requests bei CUSA-Probing (default 5)
  --watch [<min>]            Endlosschleife: alle <min> Minuten checken (default 15),
                             nur Aenderungen + Erstfund melden. State: ~/.psn_check_state.json

Beispiele:
  node psn_check.js UP0002-CUSA08829_00-CODMWTHEGAME0001
  node psn_check.js CUSA57547 CUSA57548 --quiet-404
  node psn_check.js CUSA57547 CUSA57548 --watch 10 --quiet-404 --brute
  PLATPRICES_KEY=xxx node psn_check.js CUSA57547 --platprices --platprices-name "Black Ops"
`;

// Liest einen fetch-Response-Body mit hartem Byte-Limit — DoS-Schutz gegen
// boesartig grosse Antworten (z.B. via MITM), bevor irgendetwas geparst wird.
// Zentral hier definiert und exportiert, damit alle Netzwerkpfade denselben Cap nutzen.
async function readCapped(r, maxBytes = 8 * 1024 * 1024) {
  const reader = r.body && r.body.getReader ? r.body.getReader() : null;
  if (!reader) { const txt = await r.text(); if (txt.length > maxBytes) throw new Error("response too large"); return txt; }
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { try { await reader.cancel(); } catch {} throw new Error("response too large"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function gqlProduct(productId, locale, hash) {
  const vars = encodeURIComponent(JSON.stringify({ productId }));
  const ext = encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }));
  const url = `${GRAPHQL_ENDPOINT}?operationName=metGetProductById&variables=${vars}&extensions=${ext}`;
  try {
    const r = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "x-psn-store-locale-override": locale,
        "apollo-require-preflight": "true",
        "x-apollo-operation-name": "metGetProductById",
      },
    });
    const text = await readCapped(r);
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  } catch (e) {
    return { status: 0, error: String(e) };
  }
}

async function platprices(productId, region, key) {
  const url = `https://platprices.com/api.php?key=${encodeURIComponent(key)}&psnid=${encodeURIComponent(productId)}&region=${encodeURIComponent(region)}`;
  return platpricesFetch(url);
}

async function platpricesByName(name, region, key) {
  const url = `https://platprices.com/api.php?key=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}&region=${encodeURIComponent(region)}`;
  return platpricesFetch(url);
}

async function platpricesFetch(url) {
  try {
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    const text = await readCapped(r);
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  } catch (e) {
    return { status: 0, error: String(e) };
  }
}

function fmtBytes(n) {
  let x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return null;
  for (const u of ["B", "KB", "MB", "GB", "TB"]) {
    if (x < 1024) return `${x.toFixed(2)} ${u}`;
    x /= 1024;
  }
  return `${x.toFixed(2)} PB`;
}

function summarizeProduct(json) {
  const p = json?.data?.productRetrieve;
  if (!p) return null;
  const concept = p.concept || {};
  const descs = (concept.descriptions || []).reduce((m, d) => { m[d.type] = d.value; return m; }, {});
  const cover = (concept.media || []).find(m => m.role === "GAMEHUB_COVER_ART" || m.role === "MASTER")?.url;
  const rel = concept.releaseDate || p.releaseDate;
  const releaseStr = typeof rel === "string" ? rel : (rel?.value ? rel.value.slice(0, 10) : null);
  const classification = p.localizedStoreDisplayClassification;
  const classStr = typeof classification === "string" ? classification : classification?.value;
  return {
    name: concept.invariantName || p.name,
    publisher: concept.publisherName,
    release: releaseStr,
    genres: (concept.combinedLocalizedGenres || []).map(g => g.value).join(", "),
    short: descs.SHORT,
    npTitleId: concept.npTitleId,
    classification: classStr || p.storeDisplayClassification,
    cover,
  };
}

function expandTargets(token, brute = false) {
  const fm = token.match(FULL_ID_RE);
  if (fm) return { kind: "exact", ids: [fm[1]] };
  const cm = token.match(CUSA_RE);
  if (cm) {
    const cusa = cm[1].toUpperCase();
    const prefixes = brute ? CUSA_BRUTE_PREFIXES : CUSA_GUESS_PREFIXES;
    const suffixes = brute ? CUSA_BRUTE_SUFFIXES : CUSA_GUESS_SUFFIXES;
    const ids = [];
    for (const pre of prefixes) for (const suf of suffixes) ids.push(`${pre}-${cusa}_00-${suf}`);
    return { kind: "guess", ids, cusa };
  }
  return { kind: "none", ids: [] };
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function regionFromProductId(id) {
  const pre = id.slice(0, 2);
  return { UP: "US", EP: "DE", JP: "JP", HP: "JP", KP: "KR" }[pre] || "US";
}

async function processId(productId, locales, opts) {
  const lines = [];
  let anyFound = false;
  for (const loc of locales) {
    const r = await gqlProduct(productId, loc, opts.hash);
    if (r.error) { lines.push(`  [${loc}]  ! ${r.error}`); continue; }
    if (r.status !== 200) {
      const msg = r.json?.errors?.[0]?.message || `HTTP ${r.status}`;
      lines.push(`  [${loc}]  ! ${msg.split("\n")[0]}`);
      continue;
    }
    const s = summarizeProduct(r.json);
    if (!s) {
      // 200 ohne Produktdaten = Produkt existiert (noch) nicht im Consumer-API
      lines.push(`  [${loc}]  - nicht gelistet (Consumer-API gibt null zurueck)`);
      continue;
    }
    anyFound = true;
    lines.push(`  [${loc}]  ${s.name || "(no name)"}`);
    if (s.publisher) lines.push(`           Publisher: ${s.publisher}`);
    if (s.release)   lines.push(`           Release:   ${s.release}`);
    if (s.genres)    lines.push(`           Genres:    ${s.genres}`);
    if (s.classification) lines.push(`           Class:     ${s.classification}`);
    if (s.npTitleId) lines.push(`           NP Title:  ${s.npTitleId}`);
    if (s.short)     lines.push(`           Tagline:   ${s.short.slice(0, 100)}`);
  }

  if (opts.platpricesKey && anyFound) {
    const region = regionFromProductId(productId);
    const pp = await platprices(productId, region, opts.platpricesKey);
    const s = summarizePlatPrices(pp.json);
    if (s) {
      lines.push(`  [PlatPrices/${region}]`);
      if (s.ps4Size) lines.push(`           PS4 Size:  ${fmtBytes(s.ps4Size)}  (${s.ps4Size} bytes)`);
      if (s.ps5Size) lines.push(`           PS5 Size:  ${fmtBytes(s.ps5Size)}  (${s.ps5Size} bytes)`);
      if (!s.ps4Size && !s.ps5Size) lines.push(`           Size:      (PlatPrices hat keine Groesse)`);
    } else if (pp.json?.errorDesc) {
      lines.push(`  [PlatPrices]  ! ${pp.json.errorDesc}`);
    } else {
      lines.push(`  [PlatPrices]  ! HTTP ${pp.status}`);
    }
  }
  return { lines, anyFound };
}

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const https = require("node:https");
const { execSync } = require("node:child_process");

function patchVerUrl(cusa) {
  const data = Buffer.from("np_" + cusa, "ascii");
  const hash = crypto.createHmac("sha256", PATCH_HMAC_KEY).update(data).digest("hex").toLowerCase();
  return `https://${PATCH_HOST}/plo/np/${cusa}/${hash}/${cusa}-ver.xml`;
}

// HTTPS GET fuer den PS4-Patch-Server, der ein Cert einer eigenen (Sony-)CA nutzt.
// WICHTIG: Dieser EINE Kanal ist NICHT CA-validiert (rejectUnauthorized:false) —
// alle anderen Endpunkte des Tools nutzen normales, geprueftes HTTPS.
// Host-Guard: die Cert-Ausnahme wird AUSSCHLIESSLICH fuer PATCH_HOST angewendet
// (Schutz vor versehentlicher Wiederverwendung fuer fremde Hosts).
// Byte-Cap: begrenzt die Antwortgroesse (real wenige KB) gegen Speicher-DoS.
const PATCH_MAX_BYTES = 512 * 1024;
function httpsGetInsecure(url) {
  return new Promise((resolve) => {
    let host = "";
    try { host = new URL(url).hostname; } catch { return resolve({ status: 0, body: "", error: "bad url" }); }
    const opts = { timeout: 15000 };
    if (host === PATCH_HOST) opts.rejectUnauthorized = false; // nur dieser eine Sony-Host
    const req = https.get(url, opts, (res) => {
      const chunks = []; let total = 0;
      res.on("data", c => {
        total += c.length;
        if (total > PATCH_MAX_BYTES) { req.destroy(); resolve({ status: 0, body: "", error: "response too large" }); return; }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", e => resolve({ status: 0, body: "", error: String(e) }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "", error: "timeout" }); });
  });
}

// Version "NN.NN" -> vergleichbare Zahl (01.03 -> 1003, 01.69 -> 1069).
function verNum(v) {
  const [a, b] = String(v || "").split(".");
  return (parseInt(a, 10) || 0) * 1000 + (parseInt(b, 10) || 0);
}

// ver.xml kann MEHRERE Pakete enthalten: das oeffentliche unter <tag>, und
// gestaffelte/entitlement-gebundene Versionen unter <selective_tag distro_type="entitlement">.
// Genau DAS ist die Staging-Erkennung: Sony legt kommende/gated Versionen hier ab, BEVOR
// sie oeffentlich als Standard-Patch ausgerollt werden (z. B. BO1/BO2 v01.03 vs public v01.01).
function packageFromAttrs(attrStr, ctx) {
  const attrs = {};
  for (const m of String(attrStr).matchAll(/(\w+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  return {
    tagType: ctx.tagType,                 // "tag" | "selective_tag"
    distroType: ctx.distroType || "",     // z. B. "entitlement" | "predownload"
    entitlement: ctx.entitlement || "",   // benoetigte Entitlement-ID, falls gated
    installableDate: ctx.installableDate || "", // Predownload-Fenster: ab wann installierbar (Go-Live)
    rolloutPercent: ctx.rolloutPercent || 0,    // gestaffelter Rollout (max. % aus distribution_date)
    version: attrs.version,
    versionNum: verNum(attrs.version),
    size: Number(attrs.size) || 0,
    digest: attrs.digest,
    contentId: attrs.content_id,
    systemVer: attrs.system_ver,
    type: attrs.type,
    remaster: attrs.remaster === "true",
    patchgo: attrs.patchgo === "true",
    manifestUrl: attrs.manifest_url,
  };
}

function parseVerXml(xml) {
  if (!xml || xml.trim() === "Not found") return null;
  const out = {};
  const titleM = xml.match(/<paramsfo>\s*<title>([^<]+)<\/title>/);
  if (titleM) out.title = titleM[1];

  // Alle <tag>/<selective_tag>-Bloecke durchgehen und jedes <package> extrahieren.
  const packages = [];
  for (const block of xml.matchAll(/<(tag|selective_tag)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const tagType = block[1];
    const tagAttrs = block[2] || "";
    const inner = block[3] || "";
    const distroType = (tagAttrs.match(/distro_type="([^"]*)"/) || [])[1] || "";
    const entitlement = (inner.match(/<entitlement\s+id="([^"]*)"/) || [])[1] || "";
    // Predownload-Fenster (falls vorhanden): Go-Live-Datum + gestaffelter Rollout-%-Satz.
    // PS4: <predownload_setting>…<installable_date date="…">; PS5: <distro_predownload><installable_date date="…">.
    const installableDate = (inner.match(/<installable_date\s+date="([^"]*)"/) || [])[1] || "";
    const rolloutPercent = [...inner.matchAll(/<distribution_date[^>]*\bpercent(?:age)?="(\d+)"/g)]
      .map(m => parseInt(m[1], 10)).reduce((a, b) => Math.max(a, b), 0);
    for (const pm of inner.matchAll(/<package\s+([^>]+)>/g)) {
      packages.push(packageFromAttrs(pm[1], { tagType, distroType, entitlement, installableDate, rolloutPercent }));
    }
  }
  // Fallback: falls die Blockstruktur mal fehlt, das erste <package> global nehmen.
  if (!packages.length) {
    const pm = xml.match(/<package\s+([^>]+)>/);
    if (pm) packages.push(packageFromAttrs(pm[1], { tagType: "tag" }));
  }
  if (!packages.length) return Object.keys(out).length ? out : null;

  // Oeffentliches Paket = erstes normales <tag> (kein selective_tag); sonst hoechste Version.
  const publicPkg = packages.find(p => p.tagType === "tag") || packages.slice().sort((a, b) => b.versionNum - a.versionNum)[0];

  // Rueckwaerts-kompatibel: die Top-Level-Felder beschreiben weiterhin das oeffentliche Paket.
  Object.assign(out, {
    version: publicPkg.version, size: publicPkg.size, digest: publicPkg.digest,
    contentId: publicPkg.contentId, systemVer: publicPkg.systemVer, type: publicPkg.type,
    remaster: publicPkg.remaster, patchgo: publicPkg.patchgo, manifestUrl: publicPkg.manifestUrl,
  });
  out.packages = packages;

  // Staging: hoechste Version, die ECHT NEUER ist als das oeffentliche Paket. Nur so ist die
  // Anzeige „neuere Version, noch nicht oeffentlich" ehrlich — ein aelteres/gleich altes
  // gated Paket ist kein Staging eines kommenden Updates.
  const candidates = packages
    .filter(p => p !== publicPkg && p.versionNum > publicPkg.versionNum)
    .sort((a, b) => b.versionNum - a.versionNum);
  out.staged = candidates[0] || null;
  return out;
}

async function fetchPatchInfo(cusa) {
  const url = patchVerUrl(cusa);
  const { status, body, error } = await httpsGetInsecure(url);
  if (error) return { cusa, url, error };
  if (status === 404 || /Not found/i.test(body)) return { cusa, url, notFound: true };
  const parsed = parseVerXml(body);
  return { cusa, url, status, parsed, body };
}
const STATE_FILE = path.join(os.homedir(), ".psn_check_state.json");

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return {}; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }
  catch (e) { console.error("! state save failed:", e.message); }
}

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function tryTermuxNotify(title, body) {
  try {
    execSync(`termux-notification --title ${JSON.stringify(title)} --content ${JSON.stringify(body)}`,
      { stdio: "ignore", timeout: 5000 });
  } catch { /* termux-api not installed - silently ignore */ }
}

function summarizePlatPrices(j) {
  // V1 success: no "error" field or error=0. Error: {error:1, errorDesc:"..."}.
  if (!j || j.error === 1 || (j.error && j.error !== 0)) return null;
  const psnid = j.PSNID || j.PsnId || j.psnid;
  const name = j.Name || j.name;
  if (!psnid && !name) return null;
  return {
    psnid,
    name,
    publisher: j.Publisher || j.publisher,
    release: j.ReleaseDate || j.releaseDate,
    ps4Size: Number(j.PS4Size || j.ps4Size) || 0,
    ps5Size: Number(j.PS5Size || j.ps5Size) || 0,
  };
}

function printPlatPricesHit(prefix, s) {
  console.log(`${prefix} PlatPrices Treffer:`);
  if (s.psnid)     console.log(`     Full ID:   ${s.psnid}`);
  if (s.name)      console.log(`     Name:      ${s.name}`);
  if (s.publisher) console.log(`     Publisher: ${s.publisher}`);
  if (s.release)   console.log(`     Release:   ${s.release}`);
  if (s.ps4Size)   console.log(`     PS4 Size:  ${fmtBytes(s.ps4Size)}  (${s.ps4Size} bytes)`);
  if (s.ps5Size)   console.log(`     PS5 Size:  ${fmtBytes(s.ps5Size)}  (${s.ps5Size} bytes)`);
  if (!s.ps4Size && !s.ps5Size) console.log(`     Size:      (PlatPrices kennt keine Groesse)`);
}

async function tryPlatPricesNameSearch(opts, silent) {
  // Wenn --platprices + --platprices-name gesetzt: suche bei PlatPrices nach Namen,
  // hole volle Produkt-ID und Sizes. Funktioniert auch wenn das Consumer-API noch null gibt.
  if (!opts.platpricesKey || !opts.platpricesName) return [];
  const regions = ["US", "DE", "GB", "JP"]; // mehrere probieren
  const found = [];
  for (const region of regions) {
    const pp = await platpricesByName(opts.platpricesName, region, opts.platpricesKey);
    if (pp.error) {
      if (!silent) console.log(`  [PlatPrices/${region}]  ! ${pp.error}`);
      continue;
    }
    if (pp.json?.error === 1 || pp.json?.errorDesc) {
      if (!silent) console.log(`  [PlatPrices/${region}]  ! ${pp.json.errorDesc || "error"}`);
      continue;
    }
    const s = summarizePlatPrices(pp.json);
    if (s) {
      found.push({ region, summary: s });
      if (!silent) printPlatPricesHit(`  [PlatPrices/${region}]`, s);
    } else if (!silent) {
      console.log(`  [PlatPrices/${region}]  - kein Treffer`);
    }
  }
  return found;
}

async function runOnce(opts, opts_watchSilent = false) {
  const results = []; // [{token, kind, cusa, found: [{pid, summary}], misses: [pid], platHits: []}]

  // Schritt 1: PlatPrices-Namenssuche einmal vorab (wenn aktiviert).
  let platHits = [];
  if (opts.platpricesKey && opts.platpricesName) {
    if (!opts_watchSilent) console.log(`\n=== PlatPrices-Namenssuche: "${opts.platpricesName}" ===`);
    platHits = await tryPlatPricesNameSearch(opts, opts_watchSilent);
    if (!opts_watchSilent && platHits.length === 0) {
      console.log(`  (keine Treffer in US/DE/GB/JP - moeglicherweise noch nicht indiziert)`);
    }
  }

  // Schritt 2: CUSA-Probing / volle IDs via Consumer-GraphQL.
  for (const token of opts.targets) {
    const { kind, ids, cusa } = expandTargets(token, opts.brute);
    if (kind === "none") {
      if (!opts_watchSilent) console.log(`\n=== ${token} ===\n  ! Konnte keine Produkt-ID extrahieren.`);
      results.push({ token, kind, ids: [], found: [], misses: [], platHits, patchInfo: null });
      continue;
    }

    // Schritt 2a: Sony patch-server abfragen, sobald wir eine CUSA haben.
    let patchInfo = null;
    if (opts.patch) {
      const cusaToProbe = cusa || (ids[0] && ids[0].match(/CUSA\d+/)?.[0]);
      if (cusaToProbe) {
        const info = await fetchPatchInfo(cusaToProbe);
        if (info.parsed) {
          patchInfo = info;
          if (!opts_watchSilent) {
            console.log(`\n=== ${token} - Sony patch-server (${cusaToProbe}) ===`);
            const p = info.parsed;
            console.log(`  Content ID: ${p.contentId}`);
            console.log(`  Title:      ${p.title}`);
            console.log(`  Size:       ${fmtBytes(p.size)}   (${p.size} bytes)`);
            console.log(`  Version:    ${p.version}`);
            console.log(`  Type:       ${p.type}  remaster=${p.remaster}  patchgo=${p.patchgo}`);
            console.log(`  ver.xml:    ${info.url}`);
            console.log(`  manifest:   ${p.manifestUrl}`);
            if (p.staged) {
              const s = p.staged;
              console.log(`  🔎 STAGED:  v${s.version}  ${fmtBytes(s.size)}   (noch nicht oeffentlich)`);
              console.log(`             ${s.tagType}${s.distroType ? "/" + s.distroType : ""}${s.entitlement ? "  entitlement=" + s.entitlement : ""}  firmware=${s.systemVer}`);
            }
          }
        } else if (info.notFound) {
          if (!opts_watchSilent) console.log(`\n  [patch-server] ${cusaToProbe}: Not found (Titel im Backend nicht registriert)`);
        } else if (info.error) {
          if (!opts_watchSilent) console.log(`\n  [patch-server] ${cusaToProbe}: ! ${info.error}`);
        }
      }
    }

    if (!opts_watchSilent && kind === "guess") {
      const mode = opts.brute ? "BRUTE" : "standard";
      console.log(`\n=== ${token} (CUSA-only [${mode}]: ${ids.length} ID-Kandidaten, ${opts.concurrency} parallel) ===`);
    }

    // Parallel processen, Reihenfolge bewahren.
    const perId = await mapWithConcurrency(ids, opts.concurrency, (pid) =>
      processId(pid, opts.locales, opts).then(res => ({ pid, ...res }))
    );

    const found = [], misses = [];
    let guessHits = 0;
    for (const { pid, lines, anyFound } of perId) {
      if (anyFound) { guessHits++; found.push({ pid, lines }); }
      else misses.push(pid);
      if (opts_watchSilent) continue;
      if (kind === "guess" && !anyFound && opts.quiet404) continue;
      console.log(`\n--- ${pid} ---`);
      for (const l of lines) console.log(l);
    }
    if (!opts_watchSilent && kind === "guess") {
      if (guessHits === 0) console.log(`\n  ${cusa}: keiner der ${ids.length} Kandidaten ist im Consumer-API live.`);
      else console.log(`\n  ${cusa}: ${guessHits} Treffer von ${ids.length} Kandidaten!`);
      console.log(`  Hinweis: SKU-Suffix unbekannt - Kandidaten sind heuristisch geraten.`);
    }
    results.push({ token, kind, cusa, ids, found, misses, platHits, patchInfo });
  }
  return results;
}

async function watchLoop(opts) {
  const intervalMs = opts.watchMinutes * 60 * 1000;
  console.log(`[${ts()}] watch mode: ${opts.targets.length} target(s), interval ${opts.watchMinutes}min`);
  console.log(`           state file: ${STATE_FILE}`);
  console.log(`           Ctrl+C zum Abbrechen.`);

  const state = loadState();
  let tick = 0;

  while (true) {
    tick++;
    const isFirstTick = tick === 1;
    const results = await runOnce(opts, /*silent*/ !isFirstTick);

    // Compare to state, emit only changes after first tick.
    const changes = [];
    for (const r of results) {
      if (r.kind === "none") continue;
      const stateKey = r.token;
      const prev = state[stateKey] || { foundIds: [], platIds: [], patchVer: null, patchSize: 0, lastTick: null };
      const nowFoundIds = r.found.map(f => f.pid).sort();
      const nowPlatIds = (r.platHits || []).map(h => h.summary.psnid).filter(Boolean).sort();
      const nowPatchVer = r.patchInfo?.parsed?.version || null;
      const nowPatchSize = r.patchInfo?.parsed?.size || 0;
      const newlyFound = nowFoundIds.filter(p => !prev.foundIds.includes(p));
      const lost = prev.foundIds.filter(p => !nowFoundIds.includes(p));
      const newPlatIds = nowPlatIds.filter(p => !(prev.platIds || []).includes(p));
      const patchChanged = nowPatchVer && (nowPatchVer !== prev.patchVer || nowPatchSize !== prev.patchSize);
      if (newlyFound.length || lost.length || newPlatIds.length || patchChanged) {
        changes.push({
          token: r.token, newlyFound, lost, newPlatIds,
          found: r.found, platHits: r.platHits,
          patchChanged, prevPatch: { version: prev.patchVer, size: prev.patchSize },
          patchInfo: r.patchInfo,
        });
      }
      state[stateKey] = {
        foundIds: nowFoundIds,
        platIds: nowPlatIds,
        patchVer: nowPatchVer,
        patchSize: nowPatchSize,
        lastCheck: ts(),
        lastTick: tick,
      };
    }
    saveState(state);

    if (!isFirstTick) {
      const summary = results.map(r =>
        r.kind === "none" ? `${r.token}: invalid`
        : `${r.token}: ${r.found.length}/${r.ids.length} live` +
          ((r.platHits && r.platHits.length) ? ` (PP:${r.platHits.length})` : "")
      ).join("  |  ");
      console.log(`[${ts()}] tick ${tick}  ${summary}`);
    }

    for (const c of changes) {
      console.log(`\n*** [${ts()}] STATUSWECHSEL: ${c.token} ***`);
      if (c.newlyFound.length) {
        console.log(`    NEU LIVE:`);
        for (const pid of c.newlyFound) {
          console.log(`      -> ${pid}`);
          const f = c.found.find(x => x.pid === pid);
          if (f) for (const l of f.lines) console.log(`     ${l}`);
        }
        tryTermuxNotify(
          `PSN: ${c.token} live!`,
          `${c.newlyFound.length} Kandidat(en) jetzt im Consumer-API: ${c.newlyFound.join(", ")}`
        );
      }
      if (c.lost.length) {
        console.log(`    WIEDER WEG (zurueckgezogen?):`);
        for (const pid of c.lost) console.log(`      -> ${pid}`);
        tryTermuxNotify(`PSN: ${c.token} wieder weg`, c.lost.join(", "));
      }
      if (c.patchChanged && c.patchInfo?.parsed) {
        const p = c.patchInfo.parsed;
        const prev = c.prevPatch;
        console.log(`    PATCH-SERVER:  Version/Size geaendert`);
        console.log(`      Vorher:   v${prev.version || "?"}  ${prev.size ? fmtBytes(prev.size) : "?"}`);
        console.log(`      Jetzt:    v${p.version}  ${fmtBytes(p.size)}  (${p.size} bytes)`);
        console.log(`      ContentID: ${p.contentId}`);
        tryTermuxNotify(
          `PSN: ${c.token} patch-update`,
          `v${p.version}, ${fmtBytes(p.size)}, ${p.contentId}`
        );
      }
      if (c.newPlatIds && c.newPlatIds.length) {
        console.log(`    PLATPRICES - neue volle ID(s) gefunden:`);
        for (const pid of c.newPlatIds) {
          console.log(`      -> ${pid}`);
          const h = (c.platHits || []).find(x => x.summary.psnid === pid);
          if (h) printPlatPricesHit(`         [${h.region}]`, h.summary);
        }
        tryTermuxNotify(
          `PSN: PlatPrices kennt ${c.token}!`,
          `Volle ID(s): ${c.newPlatIds.join(", ")}`
        );
      }
    }

    // Sleep
    await new Promise(res => setTimeout(res, intervalMs));
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.targets.length === 0) { console.log(HELP); process.exit(1); }

  if (opts.watchMinutes > 0) {
    await watchLoop(opts);
  } else {
    await runOnce(opts);
  }
}

// Als Library importierbar (psn_cli.js nutzt das).
module.exports = {
  fetchPatchInfo, patchVerUrl, parseVerXml,
  gqlProduct, summarizeProduct,
  platprices, platpricesByName, summarizePlatPrices,
  fmtBytes, readCapped,
  DEFAULT_HASH_PRODUCT,
  PATCH_HMAC_KEY, PATCH_HOST,
};

// CLI-Modus nur, wenn direkt aufgerufen.
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
