# 🎮 TEE PS Game Checker

A friendly Windows desktop tool to **verify whether PlayStation game leaks are real** — by cross-checking Sony's own public endpoints, the Korean ratings database, and local `.pkg` files. Built with Electron in a clean Windows 11 / Fluent style.

> Made by **TheErsysEnding** (TEE) · [YouTube](https://www.youtube.com/@TheErsysEnding) · [TikTok](https://www.tiktok.com/@TheErsysEnding) · [Instagram](https://www.instagram.com/TheErsysEnding) · [X](https://x.com/TheErsysEnding)

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

Grab a build from the [Releases](#) page:

- **Installer** — `TEE PS Game Checker Setup x.x.x.exe` (Start-menu shortcut, clean uninstall).
- **Portable** — `TEE-PS-Game-Checker-x.x.x-portable.exe` (single file, no install).

> **First launch:** the builds are **not code-signed**, so Windows SmartScreen shows a warning. Click **More info → Run anyway**. This is expected for an open-source tool you can rebuild and verify yourself — that's the whole point of it being open source.

---

## 🛠️ Build from source

```bash
npm install
npm start            # run in dev
npm run dist         # build NSIS installer + portable .exe into dist/
npm run pack         # build the unpacked app only (no installer)
```

Requires Node.js 18+ (developed on Node 24). The app icon is generated from `build/icon-src.html` via `electron build/render-icon.js`.

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

---

## 🧩 Data sources

Sony patch server · PlayStation Store GraphQL (public) · [PlatPrices](https://platprices.com) (optional API key) · [GRAC](https://www.grac.or.kr) (Korea, public search). Public endpoints only.

---

## 📜 License

[GPL-3.0-or-later](LICENSE). Free software — anyone can inspect, rebuild and verify it independently.
