#!/bin/bash
# Nach der .deb-Installation:
#  1) Electrons chrome-sandbox-Helper braucht setuid-root (4755), sonst bricht der
#     Renderer-Sandbox-Start ab.
#  2) Ubuntu 24.04+/26.04 setzt kernel.apparmor_restrict_unprivileged_userns=1 -> ohne
#     eigenes AppArmor-Profil darf Chromium (Electron) keine User-Namespaces anlegen und
#     die Zygote stirbt mit "zygote_host_impl_linux.cc Check failed". Fix wie bei Google
#     Chrome / VS Code: ein Profil ausliefern, das GENAU diesem Binary `userns` erlaubt
#     (Chromium-Sandbox bleibt voll aktiv -- nur das Namespace-Anlegen wird gestattet).
#  3) Desktop-/MIME-/Icon-Caches auffrischen (sofortiger 1-Click-Start aus dem App-Raster).
set +e

APPDIR='/opt/TEE PS Game Checker'
SANDBOX="$APPDIR/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX"
  chmod 4755 "$SANDBOX"
fi

# --- AppArmor-Profil (nur wenn AppArmor auf dem System aktiv ist) ---
AA_PROFILE='/etc/apparmor.d/tee-ps-game-checker'
if command -v apparmor_parser >/dev/null 2>&1 && [ -d /etc/apparmor.d ]; then
  cat > "$AA_PROFILE" <<'PROFILE'
# Erlaubt der TEE-PS-Game-Checker-Binary, unprivilegierte User-Namespaces anzulegen
# (noetig fuer die Chromium/Electron-Sandbox auf Ubuntu 24.04+/26.04).
abi <abi/4.0>,
include <tunables/global>

profile tee-ps-game-checker "/opt/TEE PS Game Checker/tee-ps-game-checker" flags=(unconfined) {
  userns,
  include if exists <local/tee-ps-game-checker>
}
PROFILE
  # Profil laden; wenn der Kernel die abi-4.0-Syntax nicht kennt, still ignorieren.
  apparmor_parser -r -T -W "$AA_PROFILE" >/dev/null 2>&1 || \
    apparmor_parser -r "$AA_PROFILE" >/dev/null 2>&1 || true
fi

update-mime-database /usr/share/mime >/dev/null 2>&1 || true
update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor >/dev/null 2>&1 || true

exit 0
