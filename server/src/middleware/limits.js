// Fixed-window in-memory rate limiter. Fine for one process; use a shared store if you scale out.
export function rateLimit({ windowMs, max, key, message = 'too many requests' }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, e] of hits) if (now > e.reset) hits.delete(k);
  }, windowMs);
  sweep.unref();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let e = hits.get(k);
    if (!e || now > e.reset) { e = { count: 0, reset: now + windowMs }; hits.set(k, e); }
    e.count++;
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - e.count)));
    if (e.count > max) {
      res.set('Retry-After', String(Math.ceil((e.reset - now) / 1000)));
      return res.status(429).json({ error: message, kind: 'rate' });
    }
    next();
  };
}
