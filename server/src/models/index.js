import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// Every document belongs to an anonymous device id generated in the browser.
const deviceId = { type: String, required: true, index: true };

const memorySchema = new Schema(
  {
    deviceId: { ...deviceId, unique: true },
    name: { type: String, default: '', maxlength: 40 },
    facts: { type: [{ type: String, maxlength: 200 }], default: [] },
    // people Eve can message: { name, phone } with the country code
    contacts: { type: [{ _id: false, name: { type: String, maxlength: 60 }, phone: { type: String, maxlength: 20 } }], default: [] },
  },
  { timestamps: true },
);

const settingsSchema = new Schema(
  {
    deviceId: { ...deviceId, unique: true },
    voice: { type: String, default: '', maxlength: 200 },
    rate: { type: Number, default: 1, min: 0.8, max: 1.35 },
  },
  { timestamps: true },
);

const compositionSchema = new Schema(
  {
    deviceId,
    seed: { type: Number, required: true, min: 0, max: 4294967295 },
    name: { type: String, default: '', maxlength: 60 },
  },
  { timestamps: true },
);

export const Memory = model('Memory', memorySchema);
export const Settings = model('Settings', settingsSchema);
export const Composition = model('Composition', compositionSchema);

export const MAX_FACTS = 30;
export const MAX_CONTACTS = 100;
export const MAX_COMPOSITIONS = 200;
