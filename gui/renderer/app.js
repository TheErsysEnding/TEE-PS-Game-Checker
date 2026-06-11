// app.js - Renderer-Logik. Spricht den Main-Prozess nur ueber window.api (preload).
// Texte kommen aus i18n.js via t(). lastRender() rendert den Hauptinhalt bei Sprachwechsel neu.

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let lastRender = null;   // () => void, rendert den aktuellen Hauptinhalt neu (fuer Sprachwechsel)

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.mode;
    $("#panel-check").classList.toggle("hidden", mode !== "check");
    $("#panel-search").classList.toggle("hidden", mode !== "search");
    $("#panel-pkg").classList.toggle("hidden", mode !== "pkg");
    $("#panel-watch").classList.toggle("hidden", mode !== "watch");
    if (mode === "watch") { clearResults(); refreshWatch(); }
  });
});

// ---------- Theme (mit Persistenz) ----------
const savedTheme = localStorage.getItem("theme");
let dark = savedTheme ? savedTheme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
function applyTheme() {
  document.body.classList.toggle("dark", dark);
  const btn = $("#themeBtn");
  btn.textContent = dark ? "☀" : "☾";
  btn.title = dark ? t("theme.toLight") : t("theme.toDark");
  window.api.win(dark ? "theme-dark" : "theme-light");
}
$("#themeBtn").addEventListener("click", () => {
  dark = !dark;
  localStorage.setItem("theme", dark ? "dark" : "light");
  applyTheme();
});

// ---------- Sprache ----------
function updateLangButtons() {
  document.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b.dataset.lang === getLang()));
}
document.querySelectorAll(".lang-btn").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
window.onLangChange = () => {
  updateLangButtons();
  applyTheme();
  if (typeof lastRender === "function") lastRender();
  if (!$("#panel-watch").classList.contains("hidden")) refreshWatch();
};

// ---------- Status ----------
function setStatus(msg, loading = false) {
  const s = $("#status");
  if (!msg) { s.classList.add("hidden"); s.innerHTML = ""; return; }
  s.classList.remove("hidden");
  s.innerHTML = (loading ? '<span class="spinner"></span>' : "") + `<span>${esc(msg)}</span>`;
}
function clearResults() { $("#results").innerHTML = ""; lastRender = null; }

// ---------- PRÜFEN ----------
async function runCheck(input, gracTitle) {
  if (!input) return;
  clearResults();
  setStatus(t("status.checking", { input }), true);
  try {
    const data = await window.api.lookup(input, gracTitle ? { gracTitle } : {});
    setStatus(null);
    lastRender = () => renderLookup(data);
    renderLookup(data);
  } catch (e) {
    setStatus(t("status.error", { msg: e.message || e }));
  }
}

$("#checkBtn").addEventListener("click", () => runCheck($("#checkInput").value.trim()));
$("#checkInput").addEventListener("keydown", (e) => { if (e.key === "Enter") runCheck($("#checkInput").value.trim()); });
document.querySelectorAll("#checkChips .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    $("#checkInput").value = chip.dataset.val;
    runCheck(chip.dataset.val, chip.dataset.grac || "");
  });
});

// ---------- Render: Gesamteinschätzung ----------
function renderVerdict(data) {
  const hasPatch = !!data.patch?.parsed;
  const liveUS = !!data.store?.us, liveDE = !!data.store?.de;
  const gracHits = data.grac?.entries?.length || 0;
  const gracFresh = (data.grac?.entries || []).filter((e) => (e.fileDate || "") >= "2026-01-01").length;

  let icon = "❔", text = t("vd.none");
  if (liveUS || liveDE) { icon = "✅"; text = t("vd.live"); }
  else if (hasPatch) { icon = "📦"; text = t("vd.backend"); }
  else if (gracHits) { icon = "📝"; text = t("vd.gracOnly"); }

  const live = t("bd.live"), dash = t("bd.dash");
  const bits = [];
  if (hasPatch) bits.push(`<span class="badge ok">${esc(t("bd.patch", { size: data.patch.parsed.sizePretty || t("bd.pkgFound") }))}</span>`);
  bits.push(`<span class="badge ${liveUS ? "ok" : "neutral"}">🇺🇸 US ${liveUS ? live : dash}</span>`);
  bits.push(`<span class="badge ${liveDE ? "ok" : "neutral"}">🇩🇪 DE ${liveDE ? live : dash}</span>`);
  if (gracHits) bits.push(`<span class="badge ${gracFresh ? "ok" : "neutral"}">📝 GRAC: ${gracHits}${gracFresh ? " " + t("bd.gracFrom", { fresh: gracFresh }) : ""}</span>`);

  return `<div class="verdict"><span class="big">${icon}</span><span>${esc(text)}</span></div>
          <div class="summary">${bits.join("")}</div>`;
}

// ---------- Render: Lookup ----------
function renderLookup(data) {
  const out = [];
  out.push(renderVerdict(data));

  if (data.patch?.parsed) {
    const p = data.patch.parsed;
    out.push(card("📦", t("card.patch"), data.cusa || "", `
      <div class="hero"><span class="hero-val">${esc(p.sizePretty || "")}</span>
        <span class="hero-unit">${p.size ? esc(p.size.toLocaleString()) + " " + t("m.bytes") : ""}</span></div>
      <dl class="kv">
        ${row(t("f.title"), p.title)}
        ${row(t("f.version"), p.version)}
        ${row(t("f.type"), `${esc(p.type || "—")} · PlayGo: ${p.patchgo ? "✓" : "✗"}`, true)}
        ${row(t("f.remaster"), `<span title="${esc(t("f.remasterTip"))}" style="border-bottom:1px dotted var(--text-faint);cursor:help">${p.remaster ? "true" : "false"} ⓘ</span>`, true)}
        ${rowMono(t("f.contentId"), p.contentId)}
        ${p.digest ? rowMono(t("f.digest"), p.digest) : ""}
        ${p.manifestUrl ? row(t("f.manifest"), `<a href="${esc(p.manifestUrl)}" target="_blank" rel="noopener">${esc(p.manifestUrl.slice(0, 70))}…</a>`, true) : ""}
      </dl>`));
  } else if (data.patch?.notFound) {
    out.push(card("📦", t("card.patch"), data.cusa || "", `<div class="hint">${esc(t("patch.notReg"))}</div>`));
  } else if (data.cusa) {
    out.push(card("📦", t("card.patch"), data.cusa, `<div class="hint">${esc(t("patch.noResp"))}</div>`));
  }

  const s = data.store?.us || data.store?.de;
  if (s) {
    const live = t("bd.live"), notListed = t("bd.notListed");
    out.push(card("🛒", t("card.store"), "Consumer-API", `
      <div class="summary" style="margin-bottom:12px">
        <span class="badge ${data.store.us ? "ok" : "neutral"}">US ${data.store.us ? live : notListed}</span>
        <span class="badge ${data.store.de ? "ok" : "neutral"}">DE ${data.store.de ? live : notListed}</span>
      </div>
      <dl class="kv">
        ${row(t("f.name"), s.name)}
        ${row(t("f.publisher"), s.publisher)}
        ${row(t("f.release"), s.release)}
        ${row(t("f.genres"), s.genres)}
        ${row(t("f.class"), s.classification)}
        ${rowMono(t("f.npTitleId"), s.npTitleId)}
        ${s.short ? row(t("f.tagline"), s.short) : ""}
      </dl>`));
  }

  if (data.grac && (data.grac.entries?.length || data.grac.error)) out.push(renderGracCard(data.grac));

  if (data.platprices) {
    const pp = data.platprices;
    out.push(card("💰", "PlatPrices", "", pp.error ? `<div class="hint">${esc(pp.error)}</div>` : `
      <dl class="kv">
        ${pp.ps4Size ? row(t("f.ps4Size"), fmtBytes(pp.ps4Size)) : ""}
        ${pp.ps5Size ? row(t("f.ps5Size"), fmtBytes(pp.ps5Size)) : ""}
        ${row(t("f.name"), pp.name)}
      </dl>`));
  }

  if (data.errors?.length) out.push(`<div class="hint">⚠ ${data.errors.map(esc).join(" · ")}</div>`);
  $("#results").innerHTML = out.join("");
}

function renderGracCard(grac) {
  if (grac.error) return card("📝", t("card.grac"), "", `<div class="hint">${esc(grac.error)}</div>`);
  const items = grac.entries.slice(0, 12).map((e) => {
    const fresh = (e.fileDate || "") >= "2026-01-01";
    const rate = e.rating ? (e.rating[getLang()] || e.rating.de) : "—";
    return `<div class="grac-item ${fresh ? "fresh" : ""}">
      <span class="grac-date">${esc(e.fileDate || "")}</span>
      <span class="grac-title">${esc(e.title)}</span>
      <span class="badge ${e.rating?.level === 18 ? "warn" : "neutral"}">${esc(rate)}</span>
      <span class="grac-reg">${esc(e.regNo || "")}</span>
      <span class="grac-applicant">${esc(e.applicant || "")}</span>
    </div>`;
  }).join("");
  const sub = `${t("grac.search")} ${esc((grac.queries || []).join(" · "))}`;
  return card("📝", t("card.grac"), sub,
    `<div class="hint">${t("grac.hint")}</div><div class="grac-list">${items}</div>`);
}

// ---------- Render: Suche ----------
async function runSearch(query) {
  if (!query) return;
  $("#searchResults").innerHTML = "";
  setStatus(t("status.searching", { query }), true);
  try {
    const r = await window.api.storeSearch(query, 1);
    setStatus(null);
    if (r.error) { $("#searchResults").innerHTML = `<div class="hint">${t("status.error", { msg: esc(r.error) })}</div>`; return; }
    if (!r.results.length) { $("#searchResults").innerHTML = `<div class="hint">${t("search.none")}</div>`; return; }
    $("#searchResults").innerHTML = r.results.map((x) => `
      <div class="sr-item" data-id="${esc(x.productId)}">
        <span class="sr-name">${esc(x.name)}</span>
        <span class="sr-id">${esc(x.productId)}</span>
      </div>`).join("");
    document.querySelectorAll(".sr-item").forEach((item) => {
      item.addEventListener("click", () => {
        document.querySelector('.tab[data-mode="check"]').click();
        $("#checkInput").value = item.dataset.id;
        runCheck(item.dataset.id);
      });
    });
  } catch (e) {
    setStatus(t("status.error", { msg: e.message || e }));
  }
}
$("#searchBtn").addEventListener("click", () => runSearch($("#searchInput").value.trim()));
$("#searchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch($("#searchInput").value.trim()); });

// ---------- Helfer ----------
function card(ico, title, sub, bodyHtml) {
  return `<div class="card">
    <div class="card-head"><span class="card-ico">${ico}</span>
      <span class="card-title">${esc(title)}</span>
      ${sub ? `<span class="card-sub">${esc(sub)}</span>` : ""}</div>
    <div class="card-body">${bodyHtml}</div>
  </div>`;
}
function row(label, value, isHtml = false) {
  if (value == null || value === "") return "";
  return `<dt>${esc(label)}</dt><dd>${isHtml ? value : esc(value)}</dd>`;
}
function rowMono(label, value) {
  if (value == null || value === "") return "";
  return `<dt>${esc(label)}</dt><dd class="mono">${esc(value)}</dd>`;
}
function fmtBytes(n) {
  let x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return "—";
  for (const u of ["B", "KB", "MB", "GB", "TB"]) { if (x < 1024) return `${x.toFixed(2)} ${u}`; x /= 1024; }
  return `${x.toFixed(2)} PB`;
}

// ---------- PKG prüfen ----------
let pkgFile = null;
$("#pickPkgBtn").addEventListener("click", async () => {
  const f = await window.api.pickPkg();
  if (f) {
    pkgFile = f;
    $("#pkgPath").textContent = f;
    $("#pkgPath").classList.add("chosen");
    $("#verifyPkgBtn").disabled = false;
  }
});

$("#verifyPkgBtn").addEventListener("click", async () => {
  if (!pkgFile) return;
  const computeHash = $("#pkgHash").checked;
  clearResults();
  const prog = $("#pkgProgress"), bar = $("#pkgProgressBar"), txt = $("#pkgProgressTxt");
  let unsub = null;
  if (computeHash) {
    prog.classList.remove("hidden");
    bar.style.width = "0%";
    txt.textContent = "SHA-256 …";
    unsub = window.api.onHashProgress(({ read, total }) => {
      const pct = total ? (read / total * 100) : 0;
      bar.style.width = pct.toFixed(1) + "%";
      txt.textContent = `${pct.toFixed(1)} %  (${fmtBytes(read)} / ${fmtBytes(total)})`;
    });
  }
  setStatus(t("status.pkgReading"), true);
  try {
    const r = await window.api.verifyPkg(pkgFile, computeHash);
    setStatus(null);
    if (unsub) unsub();
    prog.classList.add("hidden");
    lastRender = () => renderPkgVerify(r);
    renderPkgVerify(r);
  } catch (e) {
    if (unsub) unsub();
    prog.classList.add("hidden");
    setStatus(t("status.error", { msg: e.message || e }));
  }
});

// Baut Verdict-Text aus {level, code, params} (i18n).
function pkgVerdictText(v) {
  const p = v.params || {};
  switch (v.code) {
    case "invalid": return { h: t("pv.invalidH"), d: t("pv.invalidD", { magic: p.magic }) };
    case "noServer": return { h: t("pv.noServerH"), d: t("pv.noServerD", { contentId: p.contentId, titleId: p.titleId || "?" }) };
    case "real": {
      let d = t("pv.realD", { contentId: p.contentId });
      if (p.hashState === "match") return { h: t("pv.verifiedH"), d: d + t("pv.verifiedExtra", { version: p.version || "?" }) };
      if (p.hashState === "diff") d += t("pv.hashDiff", { version: p.version || "?" });
      return { h: t("pv.realH"), d };
    }
    case "mismatch": return { h: t("pv.mismatchH"), d: t("pv.mismatchD", { headerCid: p.headerCid, title: p.title, verCid: p.verCid }) };
    default: return { h: "", d: "" };
  }
}

function renderPkgVerify(r) {
  if (!r || r.ok === false) {
    $("#results").innerHTML = `<div class="verdict"><span class="big">⚠️</span><span>${esc(r?.error || t("err.unknown"))}</span></div>`;
    return;
  }
  const v = r.verdict;
  const vt = pkgVerdictText(v);
  const icon = v.level === "ok" ? "✅" : v.level === "bad" ? "❌" : "⚠️";
  const out = [];
  out.push(`<div class="verdict verdict-${v.level}"><span class="big">${icon}</span>
    <div><div style="font-weight:650">${esc(vt.h)}</div>
    <div style="font-weight:400;color:var(--text-soft);font-size:13px;margin-top:3px">${esc(vt.d)}</div></div></div>`);

  const h = r.header;
  out.push(card("🔐", t("card.pkgHeader"), "", `
    <dl class="kv">
      ${row(t("f.magic"), `${esc(h.magicHex)} ${h.magicOk ? "✓ " + t("m.valid") : "✗ " + t("m.invalid")}`, true)}
      ${rowMono(t("f.contentId"), h.contentId)}
      ${row(t("f.titleId"), h.titleId)}
      ${row(t("f.contentSize"), `${fmtBytes(h.contentSize)} (${h.contentSize.toLocaleString()} ${t("m.bytes")})`)}
      ${row(t("f.fileSize"), `${fmtBytes(r.fileSize)} (${r.fileSize.toLocaleString()} ${t("m.bytes")})`)}
      ${row(t("f.drmType"), `${h.drmLabel} / ${h.contentTypeLabel}`)}
    </dl>`));

  if (r.ver) {
    const c = r.checks;
    out.push(card("🛰️", t("card.serverMatch"), r.ver.version ? "v" + r.ver.version : "", `
      <dl class="kv">
        ${row(t("f.contentId"), checkRow(c.contentIdMatch, r.ver.contentId), true)}
        ${row(t("f.serverSize"), `${fmtBytes(r.ver.size)} ${c.sizeExact === true ? "✓ " + t("m.exact") : c.sizeExact === false ? "— " + t("m.deviates") : ""}`)}
        ${rowMono(t("f.verDigest"), r.ver.digest)}
        ${r.hash ? row(t("f.fileSha"), checkRow(c.digestMatch, r.hash), true) : ""}
      </dl>`));
  } else {
    out.push(`<div class="hint">${esc(t("pkg.noServer"))}</div>`);
  }
  $("#results").innerHTML = out.join("");
}

function checkRow(match, value) {
  const mark = match === true ? `<span class="badge ok">✓ ${t("m.match")}</span>`
    : match === false ? `<span class="badge bad">✗ ${t("m.differs")}</span>` : "";
  return `<span class="mono" style="font-size:12px">${esc(value)}</span> ${mark}`;
}

// ---------- Watcher ----------
async function refreshWatch() {
  const w = await window.api.watchGet();
  $("#watchInterval").value = String(w.intervalMin || 15);
  updateWatchUI(w.running);
  renderWatchTargets(w.targets, w.state);
  renderWatchLog(w.log);
}

function updateWatchUI(running) {
  $("#watchStartBtn").classList.toggle("hidden", running);
  $("#watchStopBtn").classList.toggle("hidden", !running);
  const txt = $("#watchStateTxt");
  txt.textContent = running ? t("watch.running") : t("watch.stopped");
  txt.className = "watch-state-txt" + (running ? " running" : "");
}

function watchBadges(s) {
  if (!s) return `<span class="badge neutral">${t("watch.notChecked")}</span>`;
  const live = t("bd.live"), dash = t("bd.dash");
  const b = [
    `<span class="badge ${s.storeUS ? "ok" : "neutral"}">US ${s.storeUS ? live : dash}</span>`,
    `<span class="badge ${s.storeDE ? "ok" : "neutral"}">DE ${s.storeDE ? live : dash}</span>`,
  ];
  if (s.patchVer) b.push(`<span class="badge neutral">v${esc(s.patchVer)} · ${fmtBytes(s.patchSize)}</span>`);
  if (s.gracFresh) b.push(`<span class="badge ok">GRAC ${s.gracFresh}×2026</span>`);
  return b.join("");
}

// Watcher-Change-Eintrag (vom Main als {code, params}) -> übersetzter Text
function watchChangeText(c) {
  if (typeof c === "string") return c;       // Rückwärtskompat
  return t("wchg." + c.code, c.params || {});
}

function renderWatchTargets(targets, state) {
  const wrap = $("#watchTargets");
  if (!targets || !targets.length) { wrap.innerHTML = `<div class="hint">${t("watch.noTargets")}</div>`; return; }
  wrap.innerHTML = targets.map((tg) => {
    const s = state[tg];
    const when = s?.lastCheck ? new Date(s.lastCheck).toLocaleTimeString() : "—";
    return `<div class="watch-item" id="wt-${esc(tg)}">
      <div class="wt-main">
        <div class="wt-name">${esc(s?.name || tg)}</div>
        <div class="wt-badges">${watchBadges(s)}</div>
        <div class="wt-meta"><span class="wt-id">${esc(tg)}</span><span class="wt-when">${t("watch.lastCheck")} ${esc(when)}</span></div>
      </div>
      <button class="wt-remove icon-btn" title="${t("watch.remove")}" data-t="${esc(tg)}">✕</button>
    </div>`;
  }).join("");
  wrap.querySelectorAll(".wt-remove").forEach((b) =>
    b.addEventListener("click", async () => { await window.api.watchRemove(b.dataset.t); refreshWatch(); }));
}

function renderWatchLog(log) {
  const wrap = $("#watchLogWrap"), el = $("#watchLog");
  if (!log || !log.length) { wrap.classList.add("hidden"); el.innerHTML = ""; return; }
  wrap.classList.remove("hidden");
  el.innerHTML = log.slice().reverse().map((e) => {
    const ts = e.at ? new Date(e.at).toLocaleString() : "";
    const changes = (e.changes || []).map((c) => esc(watchChangeText(c))).join(" · ");
    return `<div class="wl-item"><span class="wl-time">${esc(ts)}</span>
      <span class="wl-name">${esc(e.name || e.target)}</span>
      <span class="wl-changes">${changes}</span></div>`;
  }).join("");
}

$("#watchAddBtn").addEventListener("click", async () => {
  const v = $("#watchInput").value.trim();
  if (!v) return;
  await window.api.watchAdd(v);
  $("#watchInput").value = "";
  refreshWatch();
});
$("#watchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#watchAddBtn").click(); });
$("#watchStartBtn").addEventListener("click", async () => { await window.api.watchStart(Number($("#watchInterval").value)); updateWatchUI(true); });
$("#watchStopBtn").addEventListener("click", async () => { await window.api.watchStop(); updateWatchUI(false); });
$("#watchNowBtn").addEventListener("click", async () => { $("#watchStateTxt").textContent = t("watch.checking"); await window.api.watchCheckNow(); refreshWatch(); });

window.api.onWatchStatus(({ target, snap }) => {
  const cardEl = document.getElementById("wt-" + target);
  if (!cardEl) return;
  cardEl.querySelector(".wt-badges").innerHTML = watchBadges(snap);
  cardEl.querySelector(".wt-name").textContent = snap.name || target;
  const when = snap.lastCheck ? new Date(snap.lastCheck).toLocaleTimeString() : "—";
  cardEl.querySelector(".wt-when").textContent = t("watch.lastCheck") + " " + when;
});
window.api.onWatchChange((entry) => {
  const cardEl = document.getElementById("wt-" + entry.target);
  if (cardEl) { cardEl.classList.add("flash"); setTimeout(() => cardEl.classList.remove("flash"), 2200); }
  refreshWatch();
});
window.api.onWatchTick(({ running }) => updateWatchUI(running));

// ---------- Initialisierung ----------
applyStaticI18n();
updateLangButtons();
applyTheme();
window.api.appInfo().then((i) => {
  $("#appInfo").textContent = `Electron ${i.electron} · Node ${i.node} · Chromium ${i.chrome?.split(".")[0]}`;
});
if (window.api.setLang) window.api.setLang(getLang());   // Main-Prozess (Notifications) initial informieren
