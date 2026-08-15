const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;

const HELPER_SCRIPT = "/usr/local/bin/usb-wakeup-helper.sh";
const SYSFS_USB_ROOT = "/sys/bus/usb/devices";

const STRINGS = {
    pl: {
        tooltip: "Wybudzanie z USB",
        title: "Urzadzenia mogace wybudzic komputer",
        noDevices: "Brak urzadzen USB obslugujacych wybudzanie",
        refresh: "Odswiez liste",
        notifyTitle: "Wybudzanie USB",
        notifyHelperFail: "Nie udalo sie uzyskac uprawnien administratora",
        notifySetFail: label => "Nie udalo sie zmienic ustawienia dla: " + label,
    },
    en: {
        tooltip: "USB wake-up",
        title: "Devices allowed to wake the computer",
        noDevices: "No USB devices supporting wake-up were found",
        refresh: "Refresh list",
        notifyTitle: "USB wake-up",
        notifyHelperFail: "Could not get administrator permission",
        notifySetFail: label => "Could not change the setting for: " + label,
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

            let label = [manufacturer, product].filter(s => s.length > 0).join(' ');
            if (label.length === 0) {
                label = "USB " + vendorId + ":" + productId;
            }

            devices.push({
                id: name,
                label: label + " (" + name + ")",
                enabled: wakeupState === 'enabled'
            });
        }
        enumerator.close(null);

        devices.sort((a, b) => a.label.localeCompare(b.label));
        return devices;
    }

    _updateDeviceSection() {
        this.deviceSection.removeAll();

        let devices = this._listUsbDevices();

        if (devices.length === 0) {
            this.deviceSection.addMenuItem(new PopupMenu.PopupMenuItem(
                S.noDevices, { reactive: false }));
        } else {
            for (let dev of devices) {
                let item = new PopupMenu.PopupSwitchMenuItem(dev.label, dev.enabled);
                item.connect('toggled', (menuItem, state) => {
                    this._setWakeup(dev.id, dev.label, state, menuItem);
                });
                this.deviceSection.addMenuItem(item);
            }
        }
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
