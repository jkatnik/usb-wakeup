#!/bin/bash
# Invoked by the 99-usb-wakeup.rules udev rule on every USB device add
# event (including the boot-time coldplug pass). Restores the previously
# saved wake-up choice from /etc/usb-wakeup/config. Do not run manually.
set -euo pipefail

DEVPATH="${1:-}"
CONFIG_FILE="/etc/usb-wakeup/config"

[[ -z "$DEVPATH" ]] && exit 0
[[ -f "$CONFIG_FILE" ]] || exit 0

SYSPATH="/sys$DEVPATH"
WAKEUP_ATTR="$SYSPATH/power/wakeup"

[[ -f "$WAKEUP_ATTR" ]] || exit 0

VID="$(cat "$SYSPATH/idVendor" 2>/dev/null || true)"
PID="$(cat "$SYSPATH/idProduct" 2>/dev/null || true)"

[[ -z "$VID" || -z "$PID" ]] && exit 0

KEY="$VID:$PID"
ACTION="$(grep -F "$KEY=" "$CONFIG_FILE" 2>/dev/null | tail -n1 | cut -d'=' -f2 || true)"

[[ "$ACTION" == "enabled" || "$ACTION" == "disabled" ]] || exit 0

echo -n "$ACTION" > "$WAKEUP_ATTR"
