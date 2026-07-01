// afterPack.js - signiert die macOS-.app nach dem Packen explizit ad-hoc ("-").
//
// Warum: electron-builder 25 ueberspringt ohne echte Apple-Developer-ID die Signierung
// ("skipped macOS application code signing"). Zurueck bleibt ein Bundle, dessen Top-Level-
// Signatur nach dem Umbenennen/Repacken nicht mehr konsistent ist
// (`codesign --verify --strict` -> "code has no resources ..."). Auf Apple Silicon ist eine
// gebrochene/fehlende Bundle-Signatur unzuverlaessig. Ein sauberes ad-hoc Re-Sign versiegelt
// das komplette Bundle neu, sodass es lokal startet und `codesign --verify --deep --strict`
// besteht. Ad-hoc ("-") braucht kein Zertifikat und ist maschinenlokal.
//
// Laeuft nur auf darwin; Windows/Linux-Builds bleiben unberuehrt.

const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  // --force: bestehende (linker-)Signatur ueberschreiben; --deep: eingebettete Frameworks/
  // Helper mitnehmen; --sign -: ad-hoc (kein Zertifikat noetig).
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  console.log(`  • ad-hoc re-signed  ${appPath}`);
};
