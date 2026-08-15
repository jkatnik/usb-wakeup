#!/bin/bash
# Instaluje applet Cinnamon "USB Wake-up" wraz z helperem uprawnien i regula polkit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="usb-wakeup@jkatnik"
APPLETS_DIR="$HOME/.local/share/cinnamon/applets"

echo "==> Instaluje applet do $APPLETS_DIR/$UUID"
mkdir -p "$APPLETS_DIR"
rm -rf "${APPLETS_DIR:?}/$UUID"
cp -r "$SCRIPT_DIR/$UUID" "$APPLETS_DIR/$UUID"

echo "==> Instaluje helper /usr/local/bin/usb-wakeup-helper.sh (wymaga sudo)"
sudo install -m 0755 -o root -g root "$SCRIPT_DIR/helper/usb-wakeup-helper.sh" /usr/local/bin/usb-wakeup-helper.sh

echo "==> Instaluje regule polkit (wymaga sudo)"
sudo install -m 0644 -o root -g root "$SCRIPT_DIR/polkit/org.cinnamon.applets.usbwakeup.policy" \
    /usr/share/polkit-1/actions/org.cinnamon.applets.usbwakeup.policy

echo "==> Instaluje CLI/GUI /usr/local/bin/usb-wakeup (wymaga sudo)"
sudo install -m 0755 -o root -g root "$SCRIPT_DIR/bin/usb-wakeup" /usr/local/bin/usb-wakeup

echo "==> Instaluje wpis w menu Cinnamon"
mkdir -p "$HOME/.local/share/applications"
install -m 0644 "$SCRIPT_DIR/desktop/usb-wakeup.desktop" "$HOME/.local/share/applications/usb-wakeup.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

echo
echo "Gotowe."
echo "- Applet: kliknij prawym na panel -> Applets, znajdz 'USB Wake-up' i wlacz."
echo "  (jesli nie widac od razu, uruchom: Alt+F2, wpisz 'r', Enter - restart Cinnamon)"
echo "- W menu Cinnamon powinna byc teraz pozycja 'USB Wake-up' (GUI)."
echo "- Z terminala: usb-wakeup list | usb-wakeup enable <id> | usb-wakeup disable <id> | usb-wakeup"
