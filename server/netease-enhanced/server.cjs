const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

// The upstream reads its runtime files from os.tmpdir() during its first require.
const stateDir = path.resolve(process.env.NCM_STATE_DIR || path.join(__dirname, '.state'));
process.env.TMPDIR = stateDir;
process.env.TMP = stateDir;
process.env.TEMP = stateDir;
process.env.ENABLE_GENERAL_UNBLOCK = 'false';
delete process.env.NETEASE_COOKIE;
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const tokenFile = path.join(stateDir, 'anonymous_token');
const keyFile = path.join(stateDir, 'xeapi_public_key');
const deviceFile = path.join(stateDir, 'device.json');
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, '', { mode: 0o600 });

const writeState = (file, value) => {
  fs.writeFileSync(file + '.next', value, { mode: 0o600 });
  fs.renameSync(file + '.next', file);
};
const readJson = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
};
const log = event => process.stdout.write(JSON.stringify(event) + '\n');
// Upstream logs include original URLs with credentials; only emit our own sanitized events.
for (const level of ['log', 'info', 'debug', 'warn', 'error']) console[level] = () => {};

async function start() {
  const pkg = '@neteasecloudmusicapienhanced/api';
  const upstreamRequire = createRequire(require.resolve(`${pkg}/package.json`));
  const { default: axios } = upstreamRequire('axios');
  axios.defaults.timeout = 12000;
  const util = require(`${pkg}/util/index`);
  global.deviceId = readJson(deviceFile).deviceId || util.generateDeviceId();
  global.cnIp = util.generateRandomChineseIP();
  let anonymousToken = fs.readFileSync(tokenFile, 'utf8').trim();
  const requestPath = require.resolve(`${pkg}/util/request`);
  const upstreamRequest = require(requestPath);
  require.cache[requestPath].exports = (uri, data, options = {}) => {
    const cookie = typeof options.cookie === 'string' ? util.cookieToJson(options.cookie) : { ...options.cookie };
    if (!cookie.MUSIC_U && !cookie.MUSIC_A && anonymousToken) cookie.MUSIC_A = anonymousToken;
    return upstreamRequest(uri, data, {
      ...options, cookie, timeout: 12000,
      // Never forward private client addresses. Explicit CNIP only affects headers.
      ip: options.randomCNIP ? global.cnIp : '',
      realIP: '', proxy: undefined, domain: '', headers: {}, ua: ''
    });
  };
  const { getXeapiPublicKey } = require(`${pkg}/util/xeapiKey`);
  let key = readJson(keyFile);
  try {
    key = await getXeapiPublicKey(key, global.deviceId);
    writeState(keyFile, JSON.stringify(key));
  } catch {
    if (!key.sk) throw new Error('xeapi public key initialization failed');
    log({ event: 'xeapi-key-cache-used' });
  }
  const main = require(`${pkg}/main`);
  if (!anonymousToken) {
    try {
      const result = await main.register_anonimous();
      anonymousToken = util.cookieToJson(result.body.cookie || '').MUSIC_A || '';
      if (anonymousToken) writeState(tokenFile, anonymousToken);
    } catch { log({ event: 'anonymous-registration-unavailable' }); }
  }
  writeState(deviceFile, JSON.stringify({ deviceId: global.deviceId }));
  const server = require(`${pkg}/server`);
  const definitions = await server.getModulesDefinitions(
    path.dirname(require.resolve(`${pkg}/module/song_url_v1.js`)),
    { 'daily_signin.js': '/daily_signin', 'fm_trash.js': '/fm_trash', 'personal_fm.js': '/personal_fm' }
  );
  const moduleDefs = definitions.filter(def => !['api', 'batch'].includes(def.identifier)).map(def => ({
    ...def,
    async module(query, request) {
      // Transport policy is controlled by this gateway rather than public query parameters.
      const clean = { ...query };
      for (const name of ['crypto', 'domain', 'proxy', 'realIP', 'headers', 'ua', 'checkToken', 'timeout']) delete clean[name];
      // Preserve upstream failures: the released QR checker masks them with a scope error.
      if (def.identifier === 'login_qr_check') {
        const result = await request('/api/login/qrcode/client/login', { key: clean.key, type: 3 }, require(`${pkg}/util/option`)(clean));
        return { status: 200, body: { ...result.body, cookie: result.cookie.join(';') }, cookie: result.cookie };
      }
      return def.module(clean, request);
    }
  }));
  moduleDefs.unshift({
    identifier: 'zephyrus_health', route: '/health',
    module: async () => ({ status: 200, body: { code: 200, backend: 'enhanced', version: require(`${pkg}/package.json`).version }, cookie: [] })
  });
  const app = await server.serveNcmApi({
    host: '127.0.0.1', port: Number(process.env.PORT || 3051), checkVersion: false, moduleDefs
  });
  app.server.once('error', () => { log({ event: 'listen-failed' }); process.exit(1); });
  app.server.once('listening', () => log({ event: 'ready', version: require(`${pkg}/package.json`).version }));
  const stop = () => { app.server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

start().catch(() => { log({ event: 'startup-failed' }); process.exit(1); });
