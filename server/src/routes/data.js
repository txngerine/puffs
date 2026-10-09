import { Router } from 'express';
import mongoose from 'mongoose';
import { Memory, Settings, Composition, MAX_FACTS, MAX_CONTACTS, MAX_COMPOSITIONS } from '../models/index.js';

export const data = Router();

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const memoryView = (m) => ({ name: m?.name || '', facts: m?.facts || [], contacts: (m?.contacts || []).map(({ name, phone }) => ({ name, phone })) });

/* ----- memory: what the assistant remembers about this device's user ----- */
data.get('/memory', async (req, res) => {
  res.json(memoryView(await Memory.findOne({ deviceId: req.deviceId }).lean()));
});

data.put('/memory', async (req, res) => {
  const { name, facts, contacts } = req.body || {};
  const update = {};
  if (name !== undefined) update.name = str(name, 40);
  if (facts !== undefined) {
    if (!Array.isArray(facts)) return res.status(400).json({ error: 'facts must be an array' });
    update.facts = facts.map((f) => str(f, 200)).filter(Boolean).slice(-MAX_FACTS);
  }
  if (contacts !== undefined) {
    if (!Array.isArray(contacts)) return res.status(400).json({ error: 'contacts must be an array' });
    update.contacts = contacts
      .map((c) => ({ name: str(c?.name, 60), phone: str(c?.phone, 20).replace(/[^\d+]/g, '') }))
      .filter((c) => c.name && /^\+?\d{7,15}$/.test(c.phone)).slice(-MAX_CONTACTS);
  }
  const m = await Memory.findOneAndUpdate({ deviceId: req.deviceId }, { $set: update }, { upsert: true, returnDocument: 'after' }).lean();
  res.json(memoryView(m));
});

data.delete('/memory', async (req, res) => {
  await Memory.deleteOne({ deviceId: req.deviceId });
  res.json(memoryView(null));
});

/* ----- settings: voice preferences ----- */
data.get('/settings', async (req, res) => {
  const s = await Settings.findOne({ deviceId: req.deviceId }).lean();
  res.json({ voice: s?.voice || '', rate: s?.rate ?? 1 });
});

data.put('/settings', async (req, res) => {
  const { voice, rate } = req.body || {};
  const update = {};
  if (voice !== undefined) update.voice = str(voice, 200);
  if (rate !== undefined) {
    if (typeof rate !== 'number' || !isFinite(rate)) return res.status(400).json({ error: 'rate must be a number' });
    update.rate = Math.max(0.8, Math.min(1.35, rate));
  }
  const s = await Settings.findOneAndUpdate({ deviceId: req.deviceId }, { $set: update }, { upsert: true, returnDocument: 'after' }).lean();
  res.json({ voice: s.voice, rate: s.rate });
});

/* ----- compositions: saved seeds ----- */
const compView = (c) => ({ id: String(c._id), seed: c.seed, name: c.name, createdAt: c.createdAt });

data.get('/compositions', async (req, res) => {
  const list = await Composition.find({ deviceId: req.deviceId }).sort({ createdAt: -1 }).limit(100).lean();
  res.json(list.map(compView));
});

data.post('/compositions', async (req, res) => {
  const seed = req.body?.seed;
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) return res.status(400).json({ error: 'seed must be a 32-bit unsigned integer' });
  if (await Composition.countDocuments({ deviceId: req.deviceId }) >= MAX_COMPOSITIONS)
    return res.status(409).json({ error: `limit of ${MAX_COMPOSITIONS} saved compositions reached` });
  const c = await Composition.create({ deviceId: req.deviceId, seed, name: str(req.body?.name, 60) });
  res.status(201).json(compView(c));
});

data.delete('/compositions/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'not found' });
  const r = await Composition.deleteOne({ _id: req.params.id, deviceId: req.deviceId });
  if (!r.deletedCount) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});
