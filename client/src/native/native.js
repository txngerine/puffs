// The Android app (Capacitor): native plugins live in client/android/app/src/main/java/com/codecarrots/eve.
import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const Speech = registerPlugin('EveSpeech');
export const Tts = registerPlugin('EveTts');
const DeviceRaw = registerPlugin('EveDevice');

// plugin rejections carry .code; the rest of the app reads .kind, like API errors
const kinded = (p) => p.catch((e) => { throw Object.assign(e, { kind: e.code }); });
export const Device = {
  status: () => kinded(DeviceRaw.status()),
  openApp: (o) => kinded(DeviceRaw.openApp(o)),
  findContact: (o) => kinded(DeviceRaw.findContact(o)),
  sendWhatsApp: (o) => kinded(DeviceRaw.sendWhatsApp(o)),
  openAutoSendSettings: () => kinded(DeviceRaw.openAutoSendSettings()),
};
