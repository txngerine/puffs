// Structured logs: JSON lines in production (for log collectors), compact text in development.
const production = process.env.NODE_ENV === 'production';
const silent = process.env.NODE_ENV === 'test';

function write(level, msg, fields) {
  if (silent) return;
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (production) out.write(JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }) + '\n');
  else out.write(`[${level}] ${msg}${fields && Object.keys(fields).length ? ' ' + JSON.stringify(fields) : ''}\n`);
}
export const log = {
  info: (msg, f) => write('info', msg, f),
  warn: (msg, f) => write('warn', msg, f),
  error: (msg, f) => write('error', msg, f),
};

export function requestLog(req, res, next) {
  if (!req.path.startsWith('/api')) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    write(res.statusCode >= 500 ? 'error' : 'info', 'request', { method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) });
  });
  next();
}
