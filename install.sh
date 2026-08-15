#!/bin/bash
# Installs the "USB Wake-up" Cinnamon applet along with the privilege
# helper, the Polkit rule, the CLI/GUI, the menu entry, and the udev rule
# that restores settings on reboot. Can be run normally ("./install.sh",
# prompts for sudo at individual steps), entirely as "sudo ./install.sh",
# or as a single command without cloning the repo yourself:
#   curl -fsSL https://raw.githubusercontent.com/jkatnik/usb-wakeup/master/install.sh | bash
set -euo pipefail

REPO_URL="https://github.com/jkatnik/usb-wakeup.git"
REPO_TARBALL="https://github.com/jkatnik/usb-wakeup/archive/refs/heads/master.tar.gz"
UUID="usb-wakeup@jkatnik"

SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
if [[ -n "$SCRIPT_SOURCE" && -f "$SCRIPT_SOURCE" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
else
    SCRIPT_DIR=""
fi

if [[ -z "$SCRIPT_DIR" || ! -d "$SCRIPT_DIR/$UUID" ]]; then
    # Running from a pipe (e.g. curl | bash) - the rest of the repo isn't
    # available on disk, so fetch it into a temp dir first.
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT

    echo "==> Downloading usb-wakeup to $TMP_DIR"
    if command -v git >/dev/null 2>&1; then
        git clone --depth 1 "$REPO_URL" "$TMP_DIR/usb-wakeup" >/dev/null
    else
        curl -fsSL "$REPO_TARBALL" | tar xz -C "$TMP_DIR"
        mv "$TMP_DIR"/usb-wakeup-* "$TMP_DIR/usb-wakeup"
    fi

    bash "$TMP_DIR/usb-wakeup/install.sh" "$@"
    exit $?
fi

if [[ $EUID -eq 0 && -n "${SUDO_USER:-}" ]]; then
    REAL_USER="$SUDO_USER"
else
    REAL_USER="$(id -un)"
fi
REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"

as_user() {
    if [[ $EUID -eq 0 && "$REAL_USER" != "root" ]]; then
        sudo -u "$REAL_USER" "$@"
    else
        "$@"
    fi
}

as_root() {
    if [[ $EUID -eq 0 ]]; then
        "$@"
    else
        sudo "$@"
    fi
}

APPLETS_DIR="$REAL_HOME/.local/share/cinnamon/applets"

echo "==> Installing the applet to $APPLETS_DIR/$UUID"
as_user mkdir -p "$APPLETS_DIR"
as_user rm -rf "${APPLETS_DIR:?}/$UUID"
as_user cp -r "$SCRIPT_DIR/$UUID" "$APPLETS_DIR/$UUID"

echo "==> Installing the helper /usr/local/bin/usb-wakeup-helper.sh (needs sudo)"
as_root install -m 0755 -o root -g root "$SCRIPT_DIR/helper/usb-wakeup-helper.sh" /usr/local/bin/usb-wakeup-helper.sh

echo "==> Installing the Polkit rule (needs sudo)"
as_root install -m 0644 -o root -g root "$SCRIPT_DIR/polkit/org.cinnamon.applets.usbwakeup.policy" \
    /usr/share/polkit-1/actions/org.cinnamon.applets.usbwakeup.policy

echo "==> Installing the CLI/GUI /usr/local/bin/usb-wakeup (needs sudo)"
as_root install -m 0755 -o root -g root "$SCRIPT_DIR/bin/usb-wakeup" /usr/local/bin/usb-wakeup

echo "==> Installing the udev script and rule that restore settings on reboot (needs sudo)"
as_root install -m 0755 -o root -g root "$SCRIPT_DIR/udev/usb-wakeup-apply.sh" /usr/local/bin/usb-wakeup-apply.sh
as_root install -m 0644 -o root -g root "$SCRIPT_DIR/udev/99-usb-wakeup.rules" /etc/udev/rules.d/99-usb-wakeup.rules
as_root udevadm control --reload-rules

echo "==> Installing the Cinnamon menu entry"
as_user mkdir -p "$REAL_HOME/.local/share/applications"
as_user install -m 0644 "$SCRIPT_DIR/desktop/usb-wakeup.desktop" "$REAL_HOME/.local/share/applications/usb-wakeup.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then
    as_user update-desktop-database "$REAL_HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

echo
echo "Done."
echo "- Applet: right-click the panel -> Applets, find 'USB Wake-up' and enable it."
echo "  (if it doesn't show up right away, run: Alt+F2, type 'r', Enter - restarts Cinnamon)"
echo "- The Cinnamon menu should now have a 'USB Wake-up' entry (GUI)."
echo "- From a terminal: usb-wakeup (text menu) | usb-wakeup gui | usb-wakeup list | usb-wakeup enable/disable <id>"
echo "- Wake-up settings are now persisted and survive a reboot."
