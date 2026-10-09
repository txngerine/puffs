import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// Every document belongs to an anonymous device id generated in the browser.
const deviceId = { type: String, required: true, index: true };

const memorySchema = new Schema(
  {
    deviceId: { ...deviceId, unique: true },
    name: { type: String, default: '', maxlength: 40 },
    facts: { type: [{ type: String, maxlength: 200 }], default: [] },
    // people Puffs can message: { name, phone } with the country code
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

// Claude conversation history, stored exactly as sent to the API (append-only per conversation).
const conversationSchema = new Schema(
  {
    deviceId,
    active: { type: Boolean, default: true },
    messages: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);
conversationSchema.index({ deviceId: 1, active: 1 });

const compositionSchema = new Schema(
  {
    deviceId,
    seed: { type: Number, required: true, min: 0, max: 4294967295 },
    name: { type: String, default: '', maxlength: 60 },
  },
  { timestamps: true },
);

// Claude token spend per device (and '*' for the whole server) per UTC day.
const usageSchema = new Schema(
  {
    key: { type: String, required: true },
    day: { type: String, required: true },
    tokens: { type: Number, default: 0 },
    requests: { type: Number, default: 0 },
  },
  { timestamps: true },
);
usageSchema.index({ key: 1, day: 1 }, { unique: true });
usageSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 40 });

export const Memory = model('Memory', memorySchema);
export const Usage = model('Usage', usageSchema);
export const Settings = model('Settings', settingsSchema);
export const Conversation = model('Conversation', conversationSchema);
export const Composition = model('Composition', compositionSchema);

export const MAX_FACTS = 30;
export const MAX_CONTACTS = 100;
export const MAX_COMPOSITIONS = 200;
