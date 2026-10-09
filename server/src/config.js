// Environment, validated once at startup. Fails fast in production instead of misbehaving later.
const env = process.env;
const int = (name, def, min, max) => {
  if (env[name] === undefined || env[name] === '') return def;
  const n = Number(env[name]);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return n;
};

export function loadConfig() {
  const production = env.NODE_ENV === 'production';
  const errors = [];
  const tryInt = (...a) => { try { return int(...a); } catch (e) { errors.push(e.message); return a[1]; } };
  const config = {
    production,
    port: tryInt('PORT', 5050, 1, 65535),
    mongoUri: env.MONGODB_URI || '',
    trustProxy: tryInt('TRUST_PROXY', 0, 0, 10),
    // open apps and send WhatsApp messages on the Mac running the server (requests from that Mac only)
    localActions: env.LOCAL_ACTIONS ? /^(1|true|yes|on)$/i.test(env.LOCAL_ACTIONS) : !production,
  };
  if (production && !config.mongoUri) errors.push('MONGODB_URI is required when NODE_ENV=production');
  if (errors.length) throw new Error('Invalid configuration:\n  - ' + errors.join('\n  - '));
  return config;
}
