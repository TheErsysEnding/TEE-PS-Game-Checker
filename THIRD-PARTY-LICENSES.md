# Third-party licences

TEE PS Game Checker itself is licensed under **GPL-3.0-or-later** (see [`LICENSE`](LICENSE)).

The repository contains no third-party code — `node_modules` is not committed. What follows is what
ends up **inside a packaged build**, so that anyone downloading a release knows what they are running.

---

## Bundled into every packaged build

Electron applications ship a complete browser runtime. Building this project with `npm run dist`
therefore redistributes the following, unmodified:

| Component | Licence | Project |
|---|---|---|
| Electron | MIT | https://github.com/electron/electron |
| Chromium | BSD-3-Clause and others | https://chromium.googlesource.com/chromium/src/+/main/LICENSE |
| Node.js | MIT | https://github.com/nodejs/node |
| V8 | BSD-3-Clause | https://chromium.googlesource.com/v8/v8/+/main/LICENSE |

Electron carries the licence texts of everything it bundles in a file named `LICENSES.chromium.html`,
which `electron-builder` places next to the executable in every build. That file — several megabytes
of it — is the authoritative and complete attribution for the runtime; nothing here replaces it.

## Build tooling (not redistributed)

| Package | Licence | Project |
|---|---|---|
| electron-builder | MIT | https://github.com/electron-userland/electron-builder |

---

## External services

The application talks to public endpoints only, and bundles no code from any of them:

| Service | Purpose |
|---|---|
| Sony patch server / PlayStation Store GraphQL | title and patch lookups (public endpoints) |
| [PlatPrices](https://platprices.com) | optional, needs an API key supplied by the user |
| [GRAC](https://www.grac.or.kr) | Korean age-rating search (public) |

No credentials ship with this repository. The PlatPrices key, if used, is entered by the user and
stored locally.

---

If you believe something is missing or attributed incorrectly, please open an issue — the aim here is
to credit everything properly.
