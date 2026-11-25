const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const http = require('node:http');
const { test } = require('node:test');

async function start(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('platform login gateway', async (t) => {
  const upstream = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      path: req.url,
      session: req.headers['x-qq-session'],
      platformCookieForwarded: Boolean(req.headers['x-platform-cookie'])
    }));
  });
  await start(t, upstream);
  process.env.QQ_API_PORT = String(upstream.address().port);
  process.env.QQ_SESSION_SECRET = 'test-only-secret';
  const spawn = t.mock.method(require('node:child_process'), 'spawn', () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.stdout.emit('data', 'server running @ test fixture\n'));
    return child;
  });
  const { createPlatformGatewayApp } = require('../server-platform-login');
  spawn.mock.restore();

  const url = await start(t, http.createServer(createPlatformGatewayApp()));
  const sdk = require('kugoumusicapi/main.js');
  const send = async (path, cookie) => {
    const res = await fetch(`${url}/platform${path}`, {
      headers: cookie ? { 'X-Platform-Cookie': cookie } : undefined
    });
    return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() };
  };
  const success = (data, cookie = []) => ({ status: 200, body: { status: 1, data }, cookie });
  let loginCookie;

  await t.test('maps the QQ session header expected by the upstream server', async () => {
    const res = await send('/qq/api/login/status', 'other=abc; qqmusic_session=mock-session');
    assert.equal(res.status, 200);
    assert.equal(res.cache, 'private, no-store');
    assert.deepEqual(res.body, {
      path: '/login/status', session: 'mock-session', platformCookieForwarded: false
    });
  });

  await t.test('registers each Kugou QR device before key creation and binds poll to that key', async (t) => {
    const devices = new Map();
    const register = t.mock.method(sdk, 'register_dev', ({ cookie }) => {
      assert.ok(cookie.KUGOU_API_MID);
      assert.equal(cookie.token, undefined);
      return success({ dfid: `dfid-${cookie.KUGOU_API_GUID}` });
    });
    t.mock.method(sdk, 'login_qr_key', ({ cookie }) => {
      const key = devices.size ? 'second-key' : 'test-key';
      assert.equal(cookie.dfid, `dfid-${cookie.KUGOU_API_GUID}`);
      devices.set(key, cookie);
      return success({ qrcode: key });
    });
    t.mock.method(sdk, 'login_qr_check', ({ key, cookie }) => {
      assert.deepEqual(cookie, devices.get(key));
      if (key === 'second-key') return success({ status: 3 });
      return success({ status: 4, userid: 88, token: 'token-a', dfid: '-' });
    });
    const key = await send('/kugou/api/login/qr/key');
    assert.equal(key.body.data.qrcode, 'test-key');
    assert.equal((await send('/kugou/api/login/qr/key')).body.data.qrcode, 'second-key');
    assert.equal(register.mock.callCount(), 2);
    assert.notEqual(devices.get('test-key').dfid, devices.get('second-key').dfid);
    assert.equal((await send('/kugou/api/login/qr/check?key=second-key')).body.data.status, 'scanned');
    assert.equal((await send('/kugou/api/login/qr/check?key=unknown')).body.data.status, 'expired');
    const res = await send('/kugou/api/login/qr/check?key=test-key');
    assert.equal(res.body.data.status, 'success');
    loginCookie = res.body.data.cookie;
    assert.ok(loginCookie.includes(`dfid=${devices.get('test-key').dfid}`));
    assert.ok(loginCookie.includes(`KUGOU_API_MID=${devices.get('test-key').KUGOU_API_MID}`));
  });

  await t.test('uses the playlist owner session and its QR device for private tracks', async (t) => {
    const build = require('kugoumusicapi/module/playlist_track_all_new.js');
    assert.equal(build({ listid: '3' }, opts => opts.data.listid), '3');
    t.mock.method(sdk, 'playlist_track_all_new', ({ cookie, userid, token, listid, page, pagesize }) => {
      assert.equal(userid, '88');
      assert.equal(token, 'token-a');
      assert.equal(cookie.dfid, `dfid-${cookie.KUGOU_API_GUID}`);
      assert.deepEqual([listid, page, pagesize], ['3', 2, 1]);
      return success({ info: [{ hash: 'fixture', filename: 'Artist - Track' }] });
    });
    const res = await send('/kugou/playlist/tracks?id=3&page=2&pageSize=1', loginCookie);
    assert.equal(res.status, 200);
    assert.equal(res.cache, 'private, no-store');
    assert.equal(res.body.data.songs[0].id, 'kugou:fixture');
    assert.equal(res.body.data.more, true);
  });

  await t.test('resolves local playlist IDs only within the signed-in account', async (t) => {
    const build = require('kugoumusicapi/module/playlist_track_all.js');
    assert.equal(build({ id: 'collection' }, opts => opts.params.global_collection_id), 'collection');
    t.mock.method(sdk, 'playlist_track_all_new', () => ({ status: 200, body: { status: 0, error_code: 20006 } }));
    t.mock.method(sdk, 'user_playlist', ({ userid }) => {
      assert.equal(userid, '88');
      return success({ lists: [{ listid: 3, listname: 'Liked', global_collection_id: 'collection_3_liked' }] });
    });
    const globalRead = t.mock.method(sdk, 'playlist_track_all', ({ id, cookie, page }) => {
      assert.equal(id, 'collection_3_liked');
      assert.equal(cookie.userid, '88');
      assert.equal(cookie.token, 'token-a');
      assert.equal(page, 2);
      return success({ info: [{ hash: 'fixture', filename: 'Artist - Track' }] });
    });
    assert.equal((await send('/kugou/playlist/tracks?id=3&page=2', loginCookie)).body.data.songs.length, 1);
    assert.equal((await send('/kugou/playlist/tracks?id=4', loginCookie)).status, 502);
    assert.equal(globalRead.mock.callCount(), 1);
  });

  await t.test('rejects a confirmed QR without credentials', async (t) => {
    t.mock.method(sdk, 'login_qr_check', () => success({ status: 4, userid: 88, token: 'undefined' }));
    const res = await send('/kugou/api/login/qr/check?key=test-key');
    assert.equal(res.status, 502);
    assert.equal(res.body.data, undefined);
  });

  await t.test('keeps the Kugou profile when the playlist fails with 20017', async (t) => {
    t.mock.method(sdk, 'user_detail', ({ cookie, userid, token }) => {
      assert.equal(cookie.dfid, `dfid-${cookie.KUGOU_API_GUID}`);
      assert.equal(userid, '88');
      assert.equal(token, 'token-a');
      return success({ user_info: { nickname: 'Listener', sizable_avatar: '//example.com/{size}/avatar.jpg' } });
    });
    t.mock.method(sdk, 'user_playlist', ({ cookie, userid, token, page, pagesize }) => {
      assert.equal(cookie.token, 'token-a');
      assert.equal(userid, '88');
      assert.equal(token, 'token-a');
      assert.equal(page, 1);
      assert.equal(pagesize, 100);
      return Promise.reject({ status: 502, body: { status: 0, error_code: 20017 } });
    });
    const res = await send('/kugou/account/data', loginCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.userInfo.userId, '88');
    assert.equal(res.body.data.userInfo.avatarUrl, 'https://example.com/400/avatar.jpg');
    assert.match(res.body.data.playlistError, /20017/);
  });

  await t.test('does not clear the lists when the Kugou profile alone fails', async (t) => {
    t.mock.method(sdk, 'user_detail', () => Promise.reject({ status: 502, body: { errcode: 20017 } }));
    t.mock.method(sdk, 'user_playlist', () => success({ lists: [{ listid: '1', listname: 'My list' }] }));
    const res = await send('/kugou/account/data', loginCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.userInfo, undefined);
    assert.match(res.body.data.profileError, /20017/);
    assert.equal(res.body.data.playlists[0].name, 'My list');
  });

  await t.test('returns normalized Kugou playlists when both reads succeed', async (t) => {
    t.mock.method(sdk, 'user_detail', () => success({ userid: 88, nickname: 'Listener' }));
    t.mock.method(sdk, 'user_playlist', () => success({ lists: [
      { listid: '1', listname: 'My list', userid: 88 },
      { listid: '2', listname: 'Collected list', userid: 99 }
    ] }));
    const res = await send('/kugou/account/data', loginCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.playlists[0].name, 'My list');
    assert.equal(res.body.data.favorites[0].name, 'Collected list');
    assert.equal(res.body.data.playlistError, undefined);
  });

  await t.test('returns 401 for missing credentials, not for ambiguous upstream errors', async (t) => {
    t.mock.method(sdk, 'user_detail', () => Promise.reject({ status: 502 }));
    t.mock.method(sdk, 'user_playlist', () => Promise.reject({ status: 502, body: { error_code: 20017 } }));
    assert.equal((await send('/kugou/account/data', 'userid=88; token=undefined')).status, 401);
    const res = await send('/kugou/account/data', loginCookie);
    assert.equal(res.status, 502);
    assert.match(res.body.msg, /20017/);
  });

  await t.test('refreshes the Kugou token without losing the device fields', async (t) => {
    const refresh = t.mock.method(sdk, 'login_token', ({ cookie }) => {
      assert.equal(cookie.dfid, `dfid-${cookie.KUGOU_API_GUID}`);
      return success({ userid: 88, token: 'token-b' });
    });
    const res = await send('/kugou/api/login/token/refresh', loginCookie);
    assert.equal(res.status, 200);
    assert.match(res.body.data.cookie, /token=token-b/);
    assert.match(res.body.data.cookie, /dfid=dfid-/);
    refresh.mock.mockImplementation(() => success({ userid: 88, token: 'undefined' }));
    const invalid = await send('/kugou/api/login/token/refresh', loginCookie);
    assert.equal(invalid.status, 502);
    assert.equal(invalid.body.data, null);
  });
});
