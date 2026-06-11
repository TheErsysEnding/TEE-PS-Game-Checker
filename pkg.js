#!/usr/bin/env node
// pkg.js - PS4-.pkg-Datei lesen und gegen Sonys Patch-Server (ver.xml) abgleichen.
//
// Zweck: pruefen, ob ein lokales .pkg echt zu einem Titel gehoert (Fake-Erkennung).
//
// Wie verifiziert wird - ehrlich eingeordnet:
//   * Content-ID (PKG-Header @0x40) == ver.xml content_id  -> ZUVERLAESSIGER Anker.
//     Identifiziert Titel/SKU eindeutig. Ein beliebiges/falsches PKG hat eine
//     andere Content-ID. Das ist der Hauptbeweis.
//   * Dateigroesse vs. ver.xml size  -> Plausibilitaet (nur exakt, wenn das PKG
//     GENAU die Version ist, die die ver.xml beschreibt = neuester Patch).
//   * SHA-256 der Datei == ver.xml digest  -> BONUS. Trifft nur zu, wenn das
//     lokale PKG bit-genau das in der ver.xml beschriebene (Patch-)Paket ist.
//     Weicht es ab (Base-Game statt Patch, andere Version), heisst das NICHT
//     "Fake" - darum wird ein Mismatch hier nie allein als Fake gewertet.
//
// PS4-PKG-Header ist BIG-ENDIAN (Erbe von PS3/Vita). Quelle: psdevwiki /ps4/PKG_files.

const fs = require("node:fs");
const crypto = require("node:crypto");

const PKG_MAGIC = 0x7f434e54; // "\x7FCNT"
const HEADER_BYTES = 0x1000;  // erste 4096 Bytes sind der Header

// pkg_content_type (@0x74) - gaengige Werte
const CONTENT_TYPE = {
  0x1a: "GD  (Game/App-Daten)",
  0x1b: "AC  (Additional Content)",
  0x1c: "AL  (Add-on ohne Entitlement)",
  0x1e: "DP  (Delta-Patch)",
  0x2d: "PS5-Content",
};
// pkg_drm_type (@0x70)
const DRM_TYPE = { 0x0: "frei", 0xf: "PS4", 0x1: "X", 0x3: "PS3", 0x4: "PSP" };

// Liest und parst den PKG-Header (nur die ersten 4 KB, also auch bei 50-GB-Dateien sofort).
async function readPkgHeader(filePath) {
  const fh = await fs.promises.open(filePath, "r");
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
    if (bytesRead < 0x80) throw new Error("Datei zu klein fuer einen PKG-Header");

    const magic = buf.readUInt32BE(0x00);
    const magicOk = magic === PKG_MAGIC;

    const contentId = buf.toString("latin1", 0x40, 0x40 + 36).replace(/\0.*$/s, "").trim();
    const drmType = buf.readUInt32BE(0x70);
    const contentType = buf.readUInt32BE(0x74);

    return {
      magic, magicOk,
      magicHex: "0x" + magic.toString(16).toUpperCase().padStart(8, "0"),
      pkgType: buf.readUInt32BE(0x04),
      fileCount: buf.readUInt32BE(0x0c),
      entryCount: buf.readUInt32BE(0x10),
      bodyOffset: Number(buf.readBigUInt64BE(0x20)),
      bodySize: Number(buf.readBigUInt64BE(0x28)),
      contentOffset: Number(buf.readBigUInt64BE(0x30)),
      contentSize: Number(buf.readBigUInt64BE(0x38)),
      contentId,
      titleId: (contentId.match(/(CUSA\d{4,5})/i) || [])[1] || null,
      drmType, drmLabel: DRM_TYPE[drmType] || ("0x" + drmType.toString(16)),
      contentType, contentTypeLabel: CONTENT_TYPE[contentType] || ("0x" + contentType.toString(16)),
    };
  } finally {
    await fh.close();
  }
}

// SHA-256 per Streaming (RAM-schonend, mit Fortschritt).
function sha256File(filePath, onProgress) {
  return new Promise((resolve, reject) => {
    let total = 0;
    try { total = fs.statSync(filePath).size; } catch {}
    const hash = crypto.createHash("sha256");
    let read = 0, lastTick = 0;
    const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 22 }); // 4-MB-Bloecke
    stream.on("data", (chunk) => {
      hash.update(chunk);
      read += chunk.length;
      // gedrosselt melden (alle ~64 MB), um IPC nicht zu fluten
      if (onProgress && (read - lastTick > (1 << 26) || read === total)) {
        lastTick = read;
        onProgress(read, total);
      }
    });
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// Kombiniert Header + Server-ver.xml zu einem ehrlichen Urteil.
// ver = { contentId, size, digest, version, title }  (aus psn_check.fetchPatchInfo .parsed)
async function verifyPkg(filePath, ver, { computeHash = false, onProgress = null } = {}) {
  const header = await readPkgHeader(filePath);
  const fileSize = (await fs.promises.stat(filePath)).size;

  const checks = {
    validPkg: header.magicOk,
    contentIdMatch: !!(ver?.contentId && header.contentId && header.contentId === ver.contentId),
    sizeKnown: !!ver?.size,
    sizeExact: ver?.size ? fileSize === Number(ver.size) : null,
    digestMatch: null,
  };

  let hash = null;
  if (computeHash) {
    hash = await sha256File(filePath, onProgress);
    if (ver?.digest) checks.digestMatch = hash.toLowerCase() === String(ver.digest).toLowerCase();
  }

  // --- Urteil als sprachneutrale {level, code, params} (Renderer uebersetzt via i18n) ---
  let level = "warn", code = "", params = {};
  if (!header.magicOk) {
    level = "bad"; code = "invalid"; params = { magic: header.magicHex };
  } else if (!ver) {
    level = "warn"; code = "noServer"; params = { contentId: header.contentId, titleId: header.titleId || "?" };
  } else if (checks.contentIdMatch) {
    level = "ok"; code = "real";
    params = { contentId: header.contentId, version: ver.version || "?" };
    if (checks.digestMatch === true) params.hashState = "match";
    else if (checks.digestMatch === false) params.hashState = "diff";
  } else {
    level = "bad"; code = "mismatch";
    params = { headerCid: header.contentId, title: ver.title || ver.contentId, verCid: ver.contentId };
  }

  return { ok: true, header, fileSize, ver, checks, hash, verdict: { level, code, params } };
}

module.exports = { readPkgHeader, sha256File, verifyPkg, PKG_MAGIC, CONTENT_TYPE, DRM_TYPE };

// CLI-Test: node pkg.js <datei.pkg> [--hash]
if (require.main === module) {
  const file = process.argv[2];
  const wantHash = process.argv.includes("--hash");
  if (!file) { console.log("Usage: node pkg.js <datei.pkg> [--hash]"); process.exit(1); }
  const PSN = require("./psn_check.js");
  (async () => {
    const header = await readPkgHeader(file);
    console.log("Header:");
    console.log("  Magic:       ", header.magicHex, header.magicOk ? "(gültig)" : "(UNGÜLTIG)");
    console.log("  Content-ID:  ", header.contentId);
    console.log("  Title-ID:    ", header.titleId);
    console.log("  Content-Size:", PSN.fmtBytes(header.contentSize), `(${header.contentSize} bytes)`);
    console.log("  DRM/Type:    ", header.drmLabel, "/", header.contentTypeLabel);
    if (!header.titleId) { console.log("Keine CUSA im Header — kein Server-Abgleich."); return; }
    console.log(`\nHole ver.xml für ${header.titleId} …`);
    const info = await PSN.fetchPatchInfo(header.titleId);
    const v = await verifyPkg(file, info.parsed, {
      computeHash: wantHash,
      onProgress: (r, t) => process.stdout.write(`\r  SHA-256 … ${(r / t * 100).toFixed(1)}%   `),
    });
    if (wantHash) console.log("");
    console.log(`\n[${v.verdict.level.toUpperCase()}] ${v.verdict.code}  ${JSON.stringify(v.verdict.params)}`);
    if (v.hash) console.log("  SHA-256:", v.hash);
  })().catch((e) => { console.error(e); process.exit(1); });
}
