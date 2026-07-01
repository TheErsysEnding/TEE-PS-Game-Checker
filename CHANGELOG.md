# Changelog

All notable changes to **TEE PS Game Checker** are documented here.

## [1.1.0] — 2026-07-01

### 🍎 macOS (Apple Silicon / arm64) support — **this release ships the macOS DMG**
- Native **arm64** build for Apple Silicon (M-series) Macs, packaged as a **`.dmg`** installer (and `.zip`).
- Native **traffic-light title bar** (`titleBarStyle: hiddenInset`) with the brand correctly inset — no more overlap.
- Native **macOS menu** (App / Edit / Window) so **⌘C / ⌘V / ⌘X / ⌘A / ⌘Q** work in text fields.
- Opaque, theme-aware window background (no black flash); window is shown only once the theme is applied (`ready-to-show`) — **no startup flicker**.
- macOS system fonts (SF Pro / SF Mono) added to the font stacks.
- Builds are **ad-hoc signed** (no Apple Developer ID). First launch: right-click → **Open**, or `xattr -cr "TEE PS Game Checker.app"`. See the README.
- **Windows behaviour is unchanged** — every macOS tweak is guarded by `process.platform`.

### 🔗 Manifest download-piece extractor (Check tab)
- New **"Show download pieces"** button under the Sony patch-server card.
- Reads the PlayGo manifest and lists the `.pkg` pieces in a **readable** layout: total size · piece count · digest, then the shared **host / path / filename template shown once** (no more wall of hash), followed by each piece with its **size + SHA-1** and a **per-row copy button** (📋).
- **Read-only inspection only — nothing is downloaded.** Clicking a copy button copies the link to the clipboard with a "✓ copied" toast; links are not clickable and never opened.
- Hardened: fetch is **restricted to `*.dl.playstation.net`** (SSRF guard), response is **size-capped**, all server data is HTML-escaped, malformed manifests fail gracefully.

### ➕ Presets & misc
- Added **MW2 (CUSA53705)** and **MW3 (CUSA53710)** quick-check chips next to Black Ops 1 / 2.
- App icon regenerated at higher resolution for crisp Retina rendering.

### 🐛 Fixes
- **Clipboard copy now works** in the sandboxed renderer — routed through the main process via IPC (the `clipboard` module is not available in a sandboxed preload).
- Manifest parsing: friendly error on non-JSON responses, url-less pieces are skipped (with a count), and the filename template is only shown when the `_N.pkg` pattern is actually present.

### 🪟 Coming next
- A **Windows build** including all of the above (manifest extractor, MW2/MW3 chips, robustness fixes) is planned for a follow-up release.

---

## [1.0.1] — 2026-06-13
- Security hardening: network/server query hardening (size caps, scheme restrictions, strict CSP escaping).

## [1.0.0] — 2026-06-11
- Initial release: verify PlayStation game leaks via Sony's public patch server, the Store backend, Korea's GRAC ratings, and local `.pkg` header checks. Electron GUI, multilingual (DE / EN / TR).
