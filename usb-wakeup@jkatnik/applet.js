const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Tooltips = imports.ui.tooltips;
const ByteArray = imports.byteArray;

const HELPER_SCRIPT = "/usr/local/bin/usb-wakeup-helper.sh";
const SYSFS_USB_ROOT = "/sys/bus/usb/devices";
const LABELS_FILE = GLib.get_user_config_dir() + "/usb-wakeup/labels.json";

const STRINGS = {
    pl: {
        tooltip: "Wybudzanie z USB",
        title: "Urzadzenia mogace wybudzic komputer",
        noDevices: "Brak urzadzen USB obslugujacych wybudzanie",
        refresh: "Odswiez liste",
        notifyTitle: "Wybudzanie USB",
        notifyHelperFail: "Nie udalo sie uzyskac uprawnien administratora",
        notifySetFail: label => "Nie udalo sie zmienic ustawienia dla: " + label,
        rename: "Zmien nazwe (Enter - zapisz, Esc - anuluj)",
    },
    en: {
        tooltip: "USB wake-up",
        title: "Devices allowed to wake the computer",
        noDevices: "No USB devices supporting wake-up were found",
        refresh: "Refresh list",
        notifyTitle: "USB wake-up",
        notifyHelperFail: "Could not get administrator permission",
        notifySetFail: label => "Could not change the setting for: " + label,
        rename: "Rename (Enter to save, Esc to cancel)",
    },
};

function _detectLang() {
    let names = GLib.get_language_names();
    for (let name of names) {
        if (name.startsWith('pl')) return 'pl';
    }
    return 'en';
}

const S = STRINGS[_detectLang()];

class UsbWakeupApplet extends Applet.IconApplet {

    constructor(metadata, orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this.metadata = metadata;

        this.set_applet_icon_symbolic_name("drive-removable-media");
        this.set_applet_tooltip(S.tooltip);

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new PopupMenu.PopupMenu(this.actor, orientation);
        this.menuManager.addMenu(this.menu);
        Main.uiGroup.add_actor(this.menu.actor);
        this.menu.actor.hide();

        let title = new PopupMenu.PopupMenuItem(S.title, { reactive: false });
        this.menu.addMenuItem(title);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.deviceSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this.deviceSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let refreshItem = new PopupMenu.PopupMenuItem(S.refresh);
        refreshItem.connect('activate', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._updateDeviceSection();
                return GLib.SOURCE_REMOVE;
            });
        });
        this.menu.addMenuItem(refreshItem);

        this._updateDeviceSection();
    }

    on_applet_clicked(event) {
        if (!this.menu.isOpen) {
            this._updateDeviceSection();
        }
        this.menu.toggle();
    }

    on_applet_removed_from_panel() {
        this.menu.destroy();
    }

    _readFile(path) {
        try {
            let [ok, contents] = GLib.file_get_contents(path);
            if (!ok) return null;
            return ByteArray.toString(contents);
        } catch (e) {
            return null;
        }
    }

    _loadLabelOverrides() {
        let contents = this._readFile(LABELS_FILE);
        if (!contents) return {};
        try {
            let data = JSON.parse(contents);
            return (data && typeof data === 'object') ? data : {};
        } catch (e) {
            return {};
        }
    }

    _saveLabelOverrides(overrides) {
        GLib.mkdir_with_parents(GLib.path_get_dirname(LABELS_FILE), 0o755);
        GLib.file_set_contents(LABELS_FILE, JSON.stringify(overrides, null, 2));
    }

    _setLabelOverride(key, customLabel) {
        let overrides = this._loadLabelOverrides();
        if (customLabel) {
            overrides[key] = customLabel;
        } else {
            delete overrides[key];
        }
        this._saveLabelOverrides(overrides);
    }

    _listUsbDevices() {
        let devices = [];
        let baseDir = Gio.File.new_for_path(SYSFS_USB_ROOT);
        let enumerator;

        try {
            enumerator = baseDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            global.logError("usb-wakeup: cannot read " + SYSFS_USB_ROOT + ": " + e);
            return devices;
        }

        let overrides = this._loadLabelOverrides();

        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            let name = info.get_name();
            let devPath = SYSFS_USB_ROOT + '/' + name;
            let wakeupPath = devPath + '/power/wakeup';

            if (!GLib.file_test(wakeupPath, GLib.FileTest.EXISTS)) {
                continue;
            }

            let wakeupState = this._readFile(wakeupPath);
            if (wakeupState === null) continue;
            wakeupState = wakeupState.trim();

            let manufacturer = (this._readFile(devPath + '/manufacturer') || '').trim();
            let product = (this._readFile(devPath + '/product') || '').trim();
            let vendorId = (this._readFile(devPath + '/idVendor') || '').trim();
            let productId = (this._readFile(devPath + '/idProduct') || '').trim();

            let defaultLabel = [manufacturer, product].filter(s => s.length > 0).join(' ');
            if (defaultLabel.length === 0) {
                defaultLabel = "USB " + vendorId + ":" + productId;
            }

            let key = (vendorId && productId) ? (vendorId + ':' + productId) : ('id:' + name);
            let label = overrides[key] || defaultLabel;

            devices.push({
                id: name,
                key: key,
                label: label,
                defaultLabel: defaultLabel,
                enabled: wakeupState === 'enabled'
            });
        }
        enumerator.close(null);

        devices.sort((a, b) => a.label.localeCompare(b.label));
        return devices;
    }

    _updateDeviceSection() {
        this.deviceSection.removeAll();
        this._activeEditItem = null;
        this._activeEditDev = null;

        let devices = this._listUsbDevices();

        if (devices.length === 0) {
            this.deviceSection.addMenuItem(new PopupMenu.PopupMenuItem(
                S.noDevices, { reactive: false }));
        } else {
            for (let dev of devices) {
                let item = new PopupMenu.PopupSwitchMenuItem(
                    dev.label + " (" + dev.id + ")", dev.enabled);
                item.connect('toggled', (menuItem, state) => {
                    this._setWakeup(dev.id, dev.label, state, menuItem);
                });

                let icon = new St.Icon({
                    style_class: 'popup-menu-icon',
                    icon_name: 'document-edit-symbolic',
                    icon_type: St.IconType.SYMBOLIC
                });
                let editButton = new St.Button({ child: icon, can_focus: true });
                new Tooltips.Tooltip(editButton, S.rename);
                editButton.connect('clicked', () => {
                    this._toggleInlineEdit(item, dev);
                });
                // Inserted before the switch's status bin (which uses span:-1
                // to fill remaining width), so it gets its own natural-width
                // column instead of being crowded out by it.
                item.addActor(editButton, { position: 2 });

                this.deviceSection.addMenuItem(item);
            }
        }
    }

    _toggleInlineEdit(item, dev) {
        if (this._activeEditDev === dev.key) {
            this._closeActiveEdit(false);
            return;
        }
        this._closeActiveEdit(true);

        let entry = new St.Entry({
            text: dev.label,
            can_focus: true,
            x_expand: true
        });

        let editItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, activate: false });
        editItem.addActor(entry, { expand: true, span: -1 });

        let items = this.deviceSection.box.get_children();
        let index = items.indexOf(item.actor);
        this.deviceSection.addMenuItem(editItem, index + 1);

        let finished = false;
        let finish = (save) => {
            if (finished) return;
            finished = true;
            this._activeEditItem = null;
            this._activeEditDev = null;
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (save) {
                    let newLabel = entry.get_text().trim();
                    if (newLabel && newLabel !== dev.defaultLabel) {
                        this._setLabelOverride(dev.key, newLabel);
                    } else {
                        this._setLabelOverride(dev.key, null);
                    }
                }
                // Move key focus back onto the menu before destroying the
                // focused entry: if focus briefly becomes null, the popup
                // menu manager treats that as "focus left the menu" and
                // closes the whole menu (see PopupMenuManager._onKeyFocusChanged).
                this.menu.actor.grab_key_focus();
                editItem.destroy();
                this._updateDeviceSection();
                return GLib.SOURCE_REMOVE;
            });
        };

        entry.clutter_text.connect('key-press-event', (actor, event) => {
            let symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                finish(true);
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Escape) {
                finish(false);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        entry.clutter_text.connect('key-focus-out', () => finish(true));

        this._activeEditItem = { editItem: editItem, entry: entry, dev: dev };
        this._activeEditDev = dev.key;

        entry.grab_key_focus();
        entry.clutter_text.set_selection(0, -1);
    }

    _closeActiveEdit(save) {
        if (!this._activeEditItem) return;
        let { editItem, entry, dev } = this._activeEditItem;
        this._activeEditItem = null;
        this._activeEditDev = null;
        if (save) {
            let newLabel = entry.get_text().trim();
            if (newLabel && newLabel !== dev.defaultLabel) {
                this._setLabelOverride(dev.key, newLabel);
            } else {
                this._setLabelOverride(dev.key, null);
            }
        }
        this.menu.actor.grab_key_focus();
        editItem.destroy();
    }

    _setWakeup(deviceId, deviceLabel, enable, menuItem) {
        let action = enable ? 'enabled' : 'disabled';

        let proc;
        try {
            proc = new Gio.Subprocess({
                argv: ['pkexec', HELPER_SCRIPT, deviceId, action],
                flags: Gio.SubprocessFlags.STDERR_PIPE
            });
            proc.init(null);
        } catch (e) {
            global.logError("usb-wakeup: failed to launch the helper: " + e);
            menuItem.setToggleState(!enable);
            Main.notify(S.notifyTitle, S.notifyHelperFail);
            return;
        }

        proc.communicate_utf8_async(null, null, (source, res) => {
            let stderr = "";
            try {
                let [, , errOut] = source.communicate_utf8_finish(res);
                stderr = errOut || "";
            } catch (e) {
                stderr = "" + e;
            }

            if (!source.get_successful()) {
                global.logError("usb-wakeup: helper returned an error for " + deviceId + ": " + stderr);
                menuItem.setToggleState(!enable);
                Main.notify(S.notifyTitle, S.notifySetFail(deviceLabel));
            }
        });
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new UsbWakeupApplet(metadata, orientation, panel_height, instance_id);
}
