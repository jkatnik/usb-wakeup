#!/bin/bash
# Writes "enabled"/"disabled" to /sys/bus/usb/devices/<id>/power/wakeup.
# Invoked via pkexec by the "usb-wakeup" Cinnamon applet/CLI. Do not run manually.
set -euo pipefail

DEVID="${1:-}"
ACTION="${2:-}"

if [[ -z "$DEVID" || -z "$ACTION" ]]; then
    echo "Usage: usb-wakeup-helper.sh <device-id> <enabled|disabled>" >&2
    exit 1
fi

if [[ ! "$DEVID" =~ ^[A-Za-z0-9._-]+$ ]] || [[ "$DEVID" == *".."* ]]; then
    echo "Invalid device id: $DEVID" >&2
    exit 1
fi

if [[ "$ACTION" != "enabled" && "$ACTION" != "disabled" ]]; then
    echo "Invalid action: $ACTION" >&2
    exit 1
fi

TARGET="/sys/bus/usb/devices/$DEVID/power/wakeup"

if [[ ! -e "$TARGET" ]]; then
    echo "No such device: $TARGET" >&2
    exit 1
fi

REAL="$(readlink -f "$TARGET")"
case "$REAL" in
    /sys/devices/*/power/wakeup) ;;
    *)
        echo "Refusing to write outside sysfs USB device tree: $REAL" >&2
        exit 1
        ;;
esac

echo -n "$ACTION" > "$TARGET"

# Persist the choice by VID:PID so the udev rule can restore it on reboot
# or reconnection (the sysfs value itself does not survive a reboot).
VID="$(cat "/sys/bus/usb/devices/$DEVID/idVendor" 2>/dev/null || true)"
PID="$(cat "/sys/bus/usb/devices/$DEVID/idProduct" 2>/dev/null || true)"

if [[ -n "$VID" && -n "$PID" ]]; then
    CONFIG_DIR="/etc/usb-wakeup"
    CONFIG_FILE="$CONFIG_DIR/config"
    LOCK_FILE="$CONFIG_DIR/.config.lock"
    KEY="$VID:$PID"

    mkdir -p "$CONFIG_DIR"
    touch "$CONFIG_FILE"

    (
        flock -x 200
        TMP="$(mktemp "$CONFIG_FILE.XXXXXX")"
        grep -v -F "$KEY=" "$CONFIG_FILE" > "$TMP" 2>/dev/null || true
        echo "$KEY=$ACTION" >> "$TMP"
        mv "$TMP" "$CONFIG_FILE"
        chmod 0644 "$CONFIG_FILE"
    ) 200>"$LOCK_FILE"
fi
