import { Router } from 'express';
import { chatTurn, appendExchange, resetConversation, claudeEnabled, withDeviceLock, budgetLeft } from '../assistant/claude.js';
import { rateLimit, requireAccess } from '../middleware/limits.js';
import { understand } from '../assistant/understand.js';
import Anthropic from '@anthropic-ai/sdk';

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function assistantRoutes(config) {
  const r = Router();
  const access = requireAccess(config);
  const perMinute = (key) => rateLimit({ windowMs: 60_000, max: config.chatPerMinute, key, message: 'slow down — too many questions' });
  const chatLimits = [perMinute((req) => 'ip:' + req.ip), perMinute((req) => 'dev:' + req.deviceId)];

  const understandLimits = [
    rateLimit({ windowMs: 60_000, max: config.chatPerMinute * 3, key: (req) => 'u-ip:' + req.ip }),
    rateLimit({ windowMs: 60_000, max: config.chatPerMinute * 3, key: (req) => 'u-dev:' + req.deviceId }),
  ];

  // Siri-style understanding: utterance -> { intent, slots, follow_up } from the smallest model.
  r.post('/understand', access, ...understandLimits, async (req, res) => {
    if (!claudeEnabled()) return res.status(503).json({ error: 'Claude is not configured on the server', kind: 'off' });
    const message = text(req.body?.text, 500);
    if (!message) return res.status(400).json({ error: 'text is required' });
    const over = await budgetLeft(req.deviceId, config);
    if (over) return res.status(429).json({ error: 'daily token budget reached', kind: 'budget' });
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
    try {
      const frame = await understand({
        deviceId: req.deviceId, text: message, signal: ctrl.signal,
        recent: req.body?.recent, pending: req.body?.pending, context: req.body?.context,
      });
      if (!frame) return res.status(502).json({ error: 'could not understand', kind: 'other' });
      res.json(frame);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return res.status(502).json({ error: 'upstream auth', kind: 'auth' });
      if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'upstream rate limit', kind: 'rate' });
      res.status(502).json({ error: 'understanding failed', kind: 'other' });
    }
  });

  // lets the browser check a password before storing it
  r.post('/unlock', access, (req, res) => res.status(204).end());

  // Streams one Claude turn as server-sent events: text, action, memory, saved, refusal, error, done.
  r.post('/chat', access, ...chatLimits, async (req, res) => {
    if (!claudeEnabled()) return res.status(503).json({ error: 'Claude is not configured on the server', kind: 'off' });
    const message = text(req.body?.message, 4000);
    if (!message) return res.status(400).json({ error: 'message is required' });
    const over = await budgetLeft(req.deviceId, config);
    if (over) return res.status(429).json({ error: `daily ${over === 'global' ? 'server' : 'device'} token budget reached`, kind: 'budget' });
    const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
    const emit = (event, data) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    await withDeviceLock(req.deviceId, () => chatTurn({ deviceId: req.deviceId, message, context, emit, signal: ctrl.signal }));
    if (!res.writableEnded) res.end();
  });

  r.post('/append', access, async (req, res) => {
    const user = text(req.body?.user, 2000), reply = text(req.body?.assistant, 4000);
    if (!user || !reply) return res.status(400).json({ error: 'user and assistant are required' });
    if (claudeEnabled()) await withDeviceLock(req.deviceId, () => appendExchange(req.deviceId, user, reply));
    res.status(204).end();
  });

  r.post('/reset', async (req, res) => {
    await withDeviceLock(req.deviceId, () => resetConversation(req.deviceId));
    res.status(204).end();
  });
  return r;
}
