#!/usr/bin/env node
// grac.js - Abfrage der koreanischen GRAC-Spielebewertungen (Game Rating and
// Administration Committee). KEIN API-Key noetig - nutzt die oeffentliche Suche.
//
// Warum das fuer Leak-Verifikation wertvoll ist:
//   Rating-Boards tragen einen Titel oft Wochen VOR dem Store-Backend ein.
//   Beispiel Black Ops 1+2 (PS4/PS5-Ports 2026): GRAC-Eintrag 29.05.2026,
//   PSN-Backend (CUSA57547/57548) erst Wochen spaeter. GRAC ist also das
//   frueheste belastbare Signal, dass ein Titel real in Vorbereitung ist.
//
// Endpoint (per Live-Reverse-Engineering ermittelt):
//   GET https://www.grac.or.kr/Statistics/GameStatistics.aspx?gameTitle=<query>
//   Antwort: UTF-8 HTML-Tabelle aller passenden Einreichungen, neueste zuerst.
//
// WICHTIG: Neue Eintraege sind haeufig NUR unter koreanischem Titel registriert
//   (z.B. "콜 오브 듀티: 블랙 옵스" fuer Black Ops). Eine rein englische Suche
//   ("Black Ops") uebersieht sie. Fuer bekannte Reihen darum koreanisch suchen -
//   siehe KNOWN_KO_TITLES und gracVerifyTitle().

const GRAC_HOST = "https://www.grac.or.kr";
const SEARCH_PATH = "/Statistics/GameStatistics.aspx";

// Rating-Icon-Dateiname -> Klartext. Quelle: /Images/grade_icon/<name>.gif
const RATING_MAP = {
  rating_all:  { level: 0,   ko: "전체이용가",      de: "Ohne Altersbeschraenkung (ALL)" },
  rating_12:   { level: 12,  ko: "12세이용가",      de: "Ab 12 Jahren" },
  rating_15:   { level: 15,  ko: "15세이용가",      de: "Ab 15 Jahren" },
  rating_18:   { level: 18,  ko: "청소년 이용불가", de: "Ab 18 (Not for Teenagers)" },
  icon_reject: { level: -1,  ko: "거부",            de: "Abgelehnt" },
  icon_cancel1:{ level: -2,  ko: "취소",            de: "Zurueckgezogen/Storniert" },
};

// Bekannte englische -> koreanische Titel, damit aktuelle (nur-koreanische)
// Eintraege gefunden werden. Erweiterbar.
const KNOWN_KO_TITLES = {
  "black ops": "콜 오브 듀티: 블랙 옵스",
  "black ops 1": "콜 오브 듀티: 블랙 옵스",
  "black ops 2": "콜 오브 듀티: 블랙 옵스 II",
  "black ops ii": "콜 오브 듀티: 블랙 옵스 II",
  "call of duty": "콜 오브 듀티",
  "modern warfare": "콜 오브 듀티: 모던 워페어",
};

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

function stripTags(h) {
  return decodeEntities(String(h).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function parseRating(cellHtml) {
  const src = (cellHtml.match(/grade_icon\/([a-z0-9_]+)\.gif/i) ||
               cellHtml.match(/\/([a-z0-9_]+)\.gif/i) || [])[1];
  const alt = (cellHtml.match(/alt=['"]([^'"]+)['"]/) || [])[1];
  if (src && RATING_MAP[src]) return { ...RATING_MAP[src], icon: src, raw: alt || RATING_MAP[src].ko };
  if (alt) return { level: null, ko: alt, de: alt, icon: src || null, raw: alt };
  return null;
}

// Eine einzelne GRAC-Suche. Liefert { query, url, status, error?, entries:[...] }.
async function searchGrac(query, { timeoutMs = 25000 } = {}) {
  const url = `${GRAC_HOST}${SEARCH_PATH}?gameTitle=${encodeURIComponent(query)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let html;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept-Language": "ko,en" },
      signal: ctrl.signal,
    });
    if (r.status !== 200) return { query, url, status: r.status, error: `HTTP ${r.status}`, entries: [] };
    html = await r.text(); // Server liefert UTF-8
  } catch (e) {
    return { query, url, status: 0, error: String(e && e.message || e), entries: [] };
  } finally {
    clearTimeout(timer);
  }

  const entries = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (tds.length < 7) continue;                       // Header/Layout-Zeilen ueberspringen
    if (!tds.some(c => /\d{4}-\d{2}-\d{2}/.test(c))) continue;

    const titleCell = tds[0];
    const title = stripTags(titleCell);
    if (!title) continue;
    const detailHash = (titleCell.match(/Open_StatisticsDetailsEnc\('([0-9a-f]+)'\)/i) || [])[1] || null;

    entries.push({
      title,
      applicant: stripTags(tds[1]),
      fileDate: stripTags(tds[2]),         // 분류일자 (Einreichungs-/Klassifizierungsdatum)
      rating: parseRating(tds[3]),         // 등급
      regNo: stripTags(tds[4]),            // 분류번호 (Registriernummer)
      decisionDate: stripTags(tds[6]),     // 결정일
      organ: (tr[1].match(/OrCd=([A-Z0-9]+)/) || [])[1] || null,
      detailHash,                          // fuer kuenftige Detail-Abfrage
    });
  }
  return { query, url, status: 200, entries };
}

// Komfort: verifiziert einen (englischen) Titel, sucht bei Bedarf zusaetzlich
// koreanisch und dedupliziert ueber die Registriernummer.
async function gracVerifyTitle(titleEN, opts = {}) {
  const queries = new Set([titleEN]);
  const low = titleEN.trim().toLowerCase();
  // Exakter Treffer ...
  if (KNOWN_KO_TITLES[low]) queries.add(KNOWN_KO_TITLES[low]);
  // ... oder der Titel enthaelt einen bekannten Schluessel (z.B. Patch-Titel
  // "Call of Duty: Black Ops" -> koreanische Suche, sonst unsichtbar).
  for (const [en, ko] of Object.entries(KNOWN_KO_TITLES)) {
    if (low.includes(en)) queries.add(ko);
  }

  const all = [];
  const seen = new Set();
  let lastError = null;
  for (const q of queries) {
    const res = await searchGrac(q, opts);
    if (res.error) { lastError = res.error; continue; }
    for (const e of res.entries) {
      const key = e.regNo || `${e.title}|${e.fileDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(e);
    }
  }
  all.sort((a, b) => (b.fileDate || "").localeCompare(a.fileDate || ""));
  return { title: titleEN, queries: [...queries], error: all.length ? null : lastError, entries: all };
}

module.exports = { searchGrac, gracVerifyTitle, RATING_MAP, KNOWN_KO_TITLES };

// CLI-Schnelltest: node grac.js "Black Ops"
if (require.main === module) {
  const q = process.argv.slice(2).join(" ") || "Black Ops";
  gracVerifyTitle(q).then(r => {
    console.log(`GRAC "${q}"  (Suchen: ${r.queries.join(" | ")})`);
    if (r.error) { console.log("  ! " + r.error); return; }
    if (!r.entries.length) { console.log("  keine Treffer"); return; }
    for (const e of r.entries.slice(0, 15)) {
      const rate = e.rating ? `${e.rating.de}` : "(kein Rating)";
      console.log(`  ${e.fileDate}  ${rate.padEnd(34)}  ${e.regNo.padEnd(20)}  ${e.title}`);
      if (e.applicant) console.log(`             Einreicher: ${e.applicant}`);
    }
  }).catch(e => { console.error(e); process.exit(1); });
}
