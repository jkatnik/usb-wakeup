#!/bin/bash
# Zapisuje wartosc "enabled"/"disabled" do /sys/bus/usb/devices/<id>/power/wakeup.
# Uruchamiane przez pkexec z appletu Cinnamon "usb-wakeup". Nie wywolywac recznie.
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
