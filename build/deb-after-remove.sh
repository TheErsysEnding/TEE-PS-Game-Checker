#!/bin/bash
# Beim Deinstallieren: das mitgelieferte AppArmor-Profil wieder entladen + entfernen.
set +e
AA_PROFILE='/etc/apparmor.d/tee-ps-game-checker'
if [ -f "$AA_PROFILE" ]; then
  if command -v apparmor_parser >/dev/null 2>&1; then
    apparmor_parser -R "$AA_PROFILE" >/dev/null 2>&1 || true
  fi
  rm -f "$AA_PROFILE"
fi
exit 0
