const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { GAME_URL, resolveAsset, createAssetHandler, isGamePage, isProjectLink } = require('./protocol.cjs');

const root = path.resolve('fixture/game');

test('serves the entry point and encoded local assets independent of the working directory', () => {
  assert.equal(resolveAsset(root, 'sangota://game/'), path.join(root, 'index.html'));
  assert.equal(resolveAsset(root, GAME_URL), path.join(root, 'index.html'));
  assert.equal(resolveAsset(root, 'sangota://game/assets/%E5%85%B3%E7%BE%BD.png?v=1'), path.join(root, 'assets', '关羽.png'));
});

test('rejects encoded traversal, Windows separators, invalid encoding, and foreign hosts', () => {
  for (const address of [
    'sangota://game/..%2fsecret.txt',
    'sangota://game/assets/..%2f..%2fsecret.txt',
    'sangota://game/..%5csecret.txt',
    'sangota://game/%00.txt',
    'sangota://game/%E0%A4%A',
    'sangota://other/index.html',
    'sangota://user:pass@game/index.html',
    'sangota://game:9000/index.html',
    'file:///etc/passwd',
    'https://example.com/index.html',
  ]) assert.equal(resolveAsset(root, address), null, address);
});

test('navigation and IPC trust only the game document, including the selected Vite port', () => {
  assert.equal(isGamePage(GAME_URL), true);
  assert.equal(isGamePage('sangota://game/index.html?test=1#map'), true);
  assert.equal(isGamePage('sangota://game/assets/other.html'), false);
  assert.equal(isGamePage('https://game/index.html'), false);
  assert.equal(isGamePage('http://127.0.0.1:5174/', 'http://127.0.0.1:5174'), true);
  assert.equal(isGamePage('http://127.0.0.1:5173/', 'http://127.0.0.1:5174'), false);
  assert.equal(isGamePage(GAME_URL, 'http://127.0.0.1:5174'), false);
  assert.equal(isGamePage('not a URL'), false);
});

test('only the existing project link may open outside the game', () => {
  assert.equal(isProjectLink('https://github.com/zhy0216/sangota'), true);
  for (const address of ['file:///tmp/game', 'javascript:alert(1)', 'https://github.com.evil.test/zhy0216/sangota']) {
    assert.equal(isProjectLink(address), false);
  }
});

test('preserves binary responses and range headers, with a production CSP', async () => {
  const data = new Uint8Array([0, 1, 128, 255]);
  const handler = createAssetHandler(root, async (url, options) => {
    assert.ok(url.startsWith('file:'));
    assert.equal(options.headers.get('Range'), 'bytes=0-3');
    return new Response(data, { status: 206, headers: { 'Content-Type': 'audio/ogg' } });
  });
  const response = await handler(new Request('sangota://game/assets/sfx.ogg', { headers: { Range: 'bytes=0-3' } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Type'), 'audio/ogg');
  assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self'/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), data);
});

test('missing files and invalid requests fail without exposing local file contents', async () => {
  const handler = createAssetHandler(root, async () => { throw new Error('missing file'); });
  assert.equal((await handler(new Request(GAME_URL))).status, 404);
  assert.equal((await handler(new Request(GAME_URL, { method: 'POST' }))).status, 405);
  assert.equal((await handler(new Request('sangota://other/index.html'))).status, 403);
});
