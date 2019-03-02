'use strict';

const Homey = require('homey');
const {ManagerArp} = Homey;
const Samsung = require('../../lib/samsung');

module.exports = class SamsungDevice extends Homey.Device {

    async onInit() {
        super.onInit();

        let settings = await this.getSettings();
        this._samsung = new Samsung({
            name: "homey",
            ip_address: settings.ipaddress,
            mac_address: settings.mac_address,
            api_timeout: 2000
        });
        this._is_powering_off = false;

        this.registerFlowCards();
        this._pollDeviceInterval = setInterval(this.pollDevice.bind(this), 10000);
        this.log('virtual device initialized', this.getData());
    }

    async onAdded() {
        this.log('virtual device added:', this.getData().id);
        let settings = await this.getSettings();
        if (settings.ipaddress) {
            await this.updateMacAddress(settings.ipaddress);
        } else {
            this.setUnavailable('IP address needs to be set.');
        }
    }

    onDeleted() {
        clearInterval(this._pollDeviceInterval);
        this.log('virtual device deleted');
    }

    onSettings(oldSettingsObj, newSettingsObj, changedKeysArr, callback) {
        if (changedKeysArr.includes('ipaddress')) {
            this.updateIPAddress(newSettingsObj.ipaddress);
        }
        callback(null, true);
    }

    async updateIPAddress(ipaddress) {
        this._samsung.config()["ip_address"] = ipaddress;
        this.log('Updated IP address', ipaddress);
        this.checkIPAddress(ipaddress);
        this.updateMacAddress(ipaddress);
    }

    async checkIPAddress(ipaddress) {
        let info = await this._samsung.getInfo(ipaddress)
            .catch(err => {
                this.log('TV set unavailable');
                this.setUnavailable('TV not found. Check IP address.');
            });
        if (info) {
            this.log('TV set available');
            this.setAvailable();
        }
    }

    async updateMacAddress(ipaddress) {
        ManagerArp.getMAC(ipaddress)
            .then(mac => {
                if (mac.indexOf(':') >= 0) {
                    this.log('Found MAC address for IP address', ipaddress, mac);
                    if (this._samsung) {
                        this._samsung.config()["mac_address"] = mac;
                    }
                    this.setSettings({"mac_address": mac});
                    return true;
                } else {
                    console.log('Invalid MAC address for IP address', ipaddress, mac);
                    return false;
                }
            })
            .catch(err => {
                this.log('Unable to find MAC address for IP address', ipaddress);
                return false;
            });
    }

    async pollDevice() {
        let onOff = await this._samsung.apiActive();
        if (onOff) {
            if (this.getAvailable() === false) {
                this.setAvailable();
            }
        }
        this.log('pollDevice', onOff);

        let settings = await this.getSettings();
        if (onOff !== settings["power"]) {
            this.setCapabilityValue('onoff', onOff).catch(console.error);
            this.handleOnOff(onOff);
        }
    }

    handleOnOff(onoff) {
        if (onoff) {
            this.setSettings({"power": true});
            this._turnedOnTrigger.trigger(this, null, null);
        } else {
            this.setSettings({"power": false});
            this._turnedOffTrigger.trigger(this, null, null);
        }
    }

    registerFlowCards() {
        this._turnedOnTrigger = new Homey.FlowCardTriggerDevice('turned_on');
        this._turnedOnTrigger.register();

        this._turnedOffTrigger = new Homey.FlowCardTriggerDevice('turned_off');
        this._turnedOffTrigger.register();

        new Homey.FlowCardCondition('is_on')
            .register()
            .registerRunListener((args, state) => {
                const device = args.device;
                if (device._is_powering_off) {
                    return false;
                }
                return device._samsung.apiActive();
            });

        new Homey.FlowCardCondition('is_app_running')
            .register()
            .registerRunListener((args, state) => {
                return args.device._samsung.isAppRunning(args.app_id);
            });

        new Homey.FlowCardAction('send_key')
            .register()
            .registerRunListener((args, state) => {
                const device = args.device;
                return device._samsung.sendKey(args.key);
            });

        new Homey.FlowCardAction('launch_app')
            .register()
            .registerRunListener((args, state) => {
                const device = args.device;
                return device._samsung.launchApp(args.app_id);
            });

        new Homey.FlowCardAction('browse')
            .register()
            .registerRunListener((args, state) => {
                return args.device._samsung.launchBrowser(args.url);
            });

        this.registerCapabilityListener('onoff', async (value, opts) => {
            this.handleOnOff(value);
            if (value) {
                this._is_powering_off = false;
                return this._samsung.turnOn();
            }
            let self = this;
            setTimeout(function () {
                self._is_powering_off = false;
            }, 15000);
            this._is_powering_off = true;
            return this._samsung.turnOff();
        });

        this.registerCapabilityListener('volume_mute', async (value, opts) => {
            return this._samsung.sendKey('KEY_MUTE');
        });

        this.registerCapabilityListener('volume_up', async (value, opts) => {
            return this._samsung.sendKey('KEY_VOLUP');
        });

        this.registerCapabilityListener('volume_down', async (value, opts) => {
            return this._samsung.sendKey('KEY_VOLDOWN');
        });

        this.registerCapabilityListener('channel_up', async (value, opts) => {
            return this._samsung.sendKey('KEY_CHUP');
        });

        this.registerCapabilityListener('channel_down', async (value, opts) => {
            return this._samsung.sendKey('KEY_CHDOWN');
        });
    }

};