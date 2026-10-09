import { Router } from 'express';
import * as mac from '../device/mac.js';
import { log } from '../logger.js';

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Controls the computer the server runs on, so it only answers requests from that same computer
// (the TCP peer, not a header that could be forged) and only when LOCAL_ACTIONS is on.
export function deviceRoutes(config) {
  const r = Router();
  const enabled = () => config.localActions && mac.supported();
  r.use((req, res, next) => {
    if (!enabled()) return res.status(503).json({ error: 'device actions are off on this server', kind: 'off' });
    if (!LOOPBACK.test(req.socket.remoteAddress || '')) return res.status(403).json({ error: 'device actions only work on the computer running Eve', kind: 'remote' });
    next();
  });

  r.get('/', async (req, res) => res.json({ ok: true, whatsapp: await mac.installed('WhatsApp') }));

  r.post('/open', async (req, res) => {
    const app = str(req.body?.app, 60);
    if (!app || !/^[\p{L}\p{N} .&'+-]+$/u.test(app)) return res.status(400).json({ error: 'app name is required' });
    if (!(await mac.installed(app))) return res.status(404).json({ error: 'not installed', kind: 'missing', app: mac.appName(app) });
    try { res.json({ app: await mac.openApp(app) }); } catch (e) { log.warn('open app failed', { app, error: e.message }); res.status(500).json({ error: 'could not open it' }); }
  });

  r.post('/contact', async (req, res) => {
    const name = str(req.body?.name, 60);
    if (!name) return res.status(400).json({ error: 'name is required' });
    try {
      const c = await mac.lookupContact(name);
      return c ? res.json(c) : res.status(404).json({ error: 'no such contact', kind: 'missing' });
    } catch (e) {
      log.warn('contact lookup failed', { error: e.message });
      res.status(404).json({ error: 'contacts unavailable', kind: 'denied' });
    }
  });

  r.post('/whatsapp', async (req, res) => {
    const phone = mac.digits(req.body?.phone);
    const text = str(req.body?.text, 2000);
    if (phone.length < 7 || phone.length > 15) return res.status(400).json({ error: 'a phone number with country code is required' });
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (!(await mac.installed('WhatsApp'))) return res.status(404).json({ error: 'WhatsApp is not installed', kind: 'missing' });
    try {
      res.json({ status: await mac.sendWhatsApp({ phone, text, send: req.body?.send !== false }) });
    } catch (e) {
      log.warn('whatsapp failed', { error: e.message });
      res.status(500).json({ error: 'could not send' });
    }
  });
  return r;
}
