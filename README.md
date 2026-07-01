# 🎮 TEE PS Game Checker

A friendly Windows desktop tool to **verify whether PlayStation game leaks are real** — by cross-checking Sony's own public endpoints, the Korean ratings database, and local `.pkg` files. Built with Electron in a clean Windows 11 / Fluent style.

> Made by **TheErsysEnding** (TEE) · [Linktree](https://linktr.ee/theersysending) · [YouTube](https://www.youtube.com/@TheErsysEnding) · [TikTok](https://www.tiktok.com/@TheErsysEnding) · [Instagram](https://www.instagram.com/TheErsysEnding) · [X](https://x.com/TheErsysEnding)

---

## ⚖️ What this is (and isn't)

This is a **research / verification tool**. It only queries **public** Sony endpoints and public rating databases and reads metadata you already have. It does **not** download games, host packages, bypass DRM, or help with piracy. The PKG check only reads a file's header to compare its Content ID against Sony's server — it never modifies or redistributes anything.

---

## ✨ Features

Four tabs, all multilingual (🇩🇪 Deutsch · 🇬🇧 English · 🇹🇷 Türkçe), light & dark mode:

| Tab | What it does |
|-----|--------------|
| 🔎 **Check** | Enter a CUSA code, full product ID or Store URL → queries Sony's patch server (real download size, version, Content ID, manifest), the Store backend (US/DE listing status, release, classification) and the Korean **GRAC** ratings database. |
| 🗂️ **Search** | Search the PlayStation Store by name and check any result in one click. |
| 🔐 **Verify PKG** | Pick a local `.pkg`, read its header, and match the **Content ID** (and optionally the full **SHA-256**) against Sony's `ver.xml` — to tell a genuine package from a fake. |
| 📡 **Watcher** | Monitor titles in the background and get a **desktop notification** the moment something changes — especially when a game **goes live in the store**. State survives restarts. |

### Why three sources?

A leak is only "real" if it shows up where it counts. This tool gives you **three independent signals**:

1. **Sony patch server** (`ver.xml`) — the package itself: real size, Content ID, SHA-256 digest.
2. **GRAC (Korea)** — rating boards often list a title **weeks before** the store. Earliest signal.
3. **Store backend** — whether it's actually purchasable yet.

---

## 🚀 Download & run

Grab a build from the [Releases](https://github.com/TheErsysEnding/TEE-PS-Game-Checker/releases) page:

- 🍎 **macOS (Apple Silicon / arm64)** — `TEE PS Game Checker-x.x.x-arm64.dmg` (open the DMG, drag the app to **Applications**).
- 🪟 **Windows — Installer** — `TEE PS Game Checker Setup x.x.x.exe` (Start-menu shortcut, clean uninstall).
- 🪟 **Windows — Portable** — `TEE-PS-Game-Checker-x.x.x-portable.exe` (single file, no install).

> **First launch (both platforms):** the builds are **not code-signed** (macOS builds are ad-hoc signed only). On **Windows**, SmartScreen shows a warning → **More info → Run anyway**. On **macOS**, Gatekeeper blocks it → **right-click the app → Open → Open**, or run `xattr -cr "/Applications/TEE PS Game Checker.app"`. This is expected for an open-source tool you can rebuild and verify yourself.

---

## 🛠️ Build from source

```bash
npm install
npm start            # run in dev

# Windows:
npm run dist         # build NSIS installer + portable .exe into dist/
npm run pack         # build the unpacked app only (no installer)

# macOS (Apple Silicon / arm64) — unsigned local build (ad-hoc signed):
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
# → dist/mac-arm64/TEE PS Game Checker.app  +  dist/*-arm64.dmg / *-arm64-mac.zip
```

Requires Node.js 18+ (developed on Node 24). The app icon is generated from `build/icon-src.html` via `electron build/render-icon.js`.

> **macOS first launch:** builds are **unsigned** (ad-hoc only, no Apple Developer ID), so Gatekeeper blocks them. Either right-click the app → **Open** → **Open**, or run `xattr -cr "/Applications/TEE PS Game Checker.app"` and then open it. This is expected for an open-source tool you can rebuild and verify yourself. Apple Silicon only (arm64) — runs natively on M-series chips.

### Command-line tools (no GUI)

```bash
node psn_check.js CUSA57547 CUSA57548      # patch-server + store + GRAC
node grac.js "Black Ops"                    # GRAC Korea ratings
node pkg.js path/to/game.pkg --hash         # verify a local PKG
```

---

## 📌 Good to know

- **The `remaster` flag is NOT a remaster indicator.** It's a technical Sony patch-system flag in the `ver.xml` (about package layout). Even a DLC pass can be `true` while a native game is `false`. The app labels it as a raw technical flag for that reason.
- **GRAC rate-limits aggressively.** After many requests its response time jumps from <1 s to 35–60 s. The Watcher therefore queries GRAC only once per title.
- **Windows Defender** may lock the freshly built `.exe` while scanning (`output file is locked for writing`), which can stall `electron-builder`. Add a Defender exclusion for the `dist\` folder if it hangs.

## 🔒 Privacy & security

- **The Watcher contacts public servers periodically.** Each interval it sends the CUSAs you track (together with your IP) to Sony / GRAC / PlatPrices. The tool never logs in and sends no account data — but if that visibility matters to you, run it behind a VPN.
- **The Sony patch-server channel is not CA-validated.** That single host (`gs-sec.ww.np.dl.playstation.net`) uses Sony's own CA, so its TLS certificate is not checked against a trust store (the exception is scoped strictly to this one host). On a hostile network (public Wi-Fi) a man-in-the-middle could in theory feed a faked `ver.xml` — so treat a *"genuine / fake"* verdict obtained on an untrusted network with caution. **All other** endpoints (GraphQL, Store, GRAC, PlatPrices) use normal, verified HTTPS.
- Hardening in place: responses are **size-capped** before parsing, outbound links are **scheme-restricted to https**, and the renderer escapes all server data under a strict CSP.

---

## 🧩 Data sources

Sony patch server · PlayStation Store GraphQL (public) · [PlatPrices](https://platprices.com) (optional API key) · [GRAC](https://www.grac.or.kr) (Korea, public search). Public endpoints only.

---

## 📜 License

[GPL-3.0-or-later](LICENSE). Free software — anyone can inspect, rebuild and verify it independently.

---

🤖 Built with [Claude Code](https://claude.com/claude-code) (Claude Opus 4.8). Every commit is co-authored accordingly — see [CONTRIBUTORS.md](CONTRIBUTORS.md).
