# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this project is

A Linux Mint / Cinnamon 6.x tool for choosing which USB devices are allowed
to wake the computer from sleep (`/sys/bus/usb/devices/<id>/power/wakeup`).
Four entry points share one persistence model:

- `usb-wakeup@jkatnik/applet.js` — Cinnamon panel applet (GJS).
- `bin/usb-wakeup` — Python 3 + GTK3 tool: curses text menu (no args),
  `gui` (GTK window), `list`/`enable`/`disable` (scriptable CLI).
- `helper/usb-wakeup-helper.sh` — the only component that runs as root, via
  `pkexec`. Writes the sysfs `power/wakeup` attribute and persists the
  chosen state to `/etc/usb-wakeup/config`, keyed by USB `idVendor:idProduct`.
- `udev/usb-wakeup-apply.sh` + `udev/99-usb-wakeup.rules` — reapply the
  saved state on hotplug/boot, since the sysfs value does not survive reboot.
- `polkit/org.cinnamon.applets.usbwakeup.policy` — scopes `pkexec` to the
  exact helper script path.

All four UIs call the same helper for privileged writes, so a change made
in one is reflected everywhere else.

## Key conventions

- **No comments explaining what code does.** Identifiers are expected to be
  self-explanatory; only add a comment for a non-obvious *why*.
- **Bilingual UI strings.** `bin/usb-wakeup` and `applet.js` both keep a
  `STRINGS`/translation table with `pl` and `en` entries, selected from the
  system locale (`pl*` → Polish, otherwise English). Any user-facing string
  addition needs both.
- **Privilege boundary.** Only `usb-wakeup-helper.sh` runs as root, only via
  `pkexec`, and only for writing `power/wakeup` + the `/etc/usb-wakeup/config`
  wake-up state. It validates the device id against `[A-Za-z0-9._-]+`,
  rejects `..`, and resolves the target with `readlink -f` before writing —
  do not weaken these checks. Anything that doesn't need root (e.g. custom
  device labels) must NOT go through the helper/pkexec; it belongs in a
  user-owned file instead (see `~/.config/usb-wakeup/labels.json`).
- **Device identity.** The volatile sysfs path (e.g. `3-1.2.1`) is only
  used to locate the device right now. Anything meant to persist across
  reboots/reconnects (wake-up state, custom labels) is keyed by
  `idVendor:idProduct`, matching the udev rule's restore logic.
- **`list_devices()` in `bin/usb-wakeup`** is the single source of truth for
  device enumeration/labeling — the curses menu, the GTK window, and the
  CLI (`list`/`enable`/`disable`) all read from it, so a labeling or
  enumeration change there applies everywhere automatically.

## Testing changes

There is no automated test suite. Verify manually:

```bash
python3 -m py_compile bin/usb-wakeup   # syntax check
python3 bin/usb-wakeup list            # CLI path, no GTK needed
python3 bin/usb-wakeup gui             # GTK window (needs a display)
python3 bin/usb-wakeup                 # curses text menu (needs a terminal)
```

For the Cinnamon applet, changes under `usb-wakeup@jkatnik/` are only
picked up after restarting Cinnamon (`Alt+F2`, `r`, `Enter`) or re-running
`./install.sh`, which copies the applet into
`~/.local/share/cinnamon/applets/usb-wakeup@jkatnik`.

Do not test privileged writes (`pkexec`, editing `/etc/usb-wakeup/config`)
against the real system without the user's confirmation — it prompts for a
password and mutates real device wake-up state.

## Screenshots

`README.md` embeds `docs/screenshots/{applet-menu,gui-window,text-menu}.png`.
Regenerate a screenshot only for the surface you actually changed; the other
two stay valid otherwise.
