import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const executableAt = args.indexOf('--executable');
const executable = executableAt >= 0 ? path.resolve(args[executableAt + 1]) : undefined;
const noSandbox = args.includes('--no-sandbox');
const profile = await mkdtemp(path.join(os.tmpdir(), 'sangota-desktop-test-'));
const artifacts = path.join(root, 'artifacts', 'desktop', executable ? 'packaged' : 'source');
await mkdir(artifacts, { recursive: true });
let application;
const errors = [];
const diagnostics = [];

async function launch() {
  const env = { ...process.env };
  delete env.SANGOTA_DEV_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    ...(executable ? { executablePath: executable } : {}),
    args: [
      ...(!executable ? [root] : []),
      `--user-data-dir=${profile}`,
      ...(noSandbox ? ['--no-sandbox'] : []),
    ],
    cwd: root,
    env,
    timeout: 60_000,
  });
  application.process().stderr.on('data', (data) => diagnostics.push(data.toString()));
  const page = await application.firstWindow();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.text().startsWith('[boot] asset failed')) errors.push(message.text());
  });
  // Let main's initial loadURL finish before reloading with instrumentation.
  await page.waitForURL('sangota://game/index.html');

  // Observe Phaser instances only inside the test browser. The actual release
  // stays free of test globals or a publicly exposed game/debug API.
  await page.addInitScript(() => {
    let phaser;
    Object.defineProperty(window, 'Phaser', {
      configurable: true,
      get: () => phaser,
      set(value) {
        phaser = value;
        value.Game = new Proxy(value.Game, {
          construct(target, args, newTarget) {
            const game = Reflect.construct(target, args, newTarget);
            window.__desktopTestGame = game;
            return game;
          },
        });
      },
    });
  });
  await page.reload();
  await waitScene(page, 'Title');
  assert.equal(page.url(), 'sangota://game/index.html');
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile);
  const security = await application.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox };
  });
  assert.deepEqual(security, { nodeIntegration: false, contextIsolation: true, sandbox: true });
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.__game), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.sangotaDesktop.setFullscreen), 'function');
  assert.equal(await page.evaluate(() => window.__desktopTestGame.cache.audio.has('ui-click')), true);
  return page;
}

async function waitScene(page, scene) {
  await page.waitForFunction((name) => {
    const game = window.__desktopTestGame;
    return game?.scene.isActive(name) && !game.scene.getScene(name).cameras.main.fadeEffect.isRunning;
  }, scene);
}

async function toggleFullscreen() {
  // CDP keyboard injection goes directly to the renderer and bypasses
  // Electron's native before-input-event shortcut handling.
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
  });
}

async function waitNativeFullscreen(value) {
  await application.evaluate(({ BrowserWindow }, expected) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isFullScreen() === expected) return;
    return new Promise((resolve, reject) => {
      const event = expected ? 'enter-full-screen' : 'leave-full-screen';
      const listener = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        win.removeListener(event, listener);
        reject(new Error('Native fullscreen did not change'));
      }, 5000);
      win.once(event, listener);
    });
  }, value);
}

async function clickDesign(page, x, y) {
  const box = await page.locator('canvas').first().boundingBox();
  assert.ok(box);
  await page.mouse.click(box.x + box.width * x / 1280, box.y + box.height * y / 720);
}

async function quit() {
  if (!application) return;
  const current = application;
  application = undefined;
  // Playwright close() calls app.quit(), exercising the normal save flush.
  let forced = false;
  const timer = setTimeout(() => {
    forced = true;
    current.process().kill('SIGKILL');
  }, 10_000);
  try {
    await current.close();
    assert.equal(forced, false, 'Desktop should exit normally without being killed');
  } finally {
    clearTimeout(timer);
  }
}

try {
  let page = await launch();
  await page.screenshot({ path: path.join(artifacts, 'title.png') });
  await page.keyboard.press('Enter');
  await waitScene(page, 'Blessing');
  await page.waitForFunction(() => window.__desktopTestGame.scene.getScene('Blessing').rowLayer.list.every((row) => row.alpha === 1));
  // The fourth offer is always 无所求 and never needs a secondary card picker.
  await clickDesign(page, 850, 566);
  await page.waitForFunction(() => window.__desktopTestGame.scene.getScene('Blessing').picked !== null);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const scene = window.__desktopTestGame.scene.getScene('Blessing');
    return scene.run.blessing?.takenId && scene.confirmRow.list.length > 0;
  });
  await page.keyboard.press('Enter');
  await waitScene(page, 'Map');
  await page.waitForFunction(() => localStorage.getItem('sangota.save.v1') !== null);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sangota.save.v1')));
  assert.equal(saved.heroId, 'guanyu');
  assert.ok(saved.blessing.takenId);
  assert.ok(saved.deck.length > 0);
  assert.equal(await page.evaluate(() => window.__desktopTestGame.sound.context.state), 'running');

  await toggleFullscreen();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sangota.settings.v1'))?.fullscreen === true);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()), true);
  await page.screenshot({ path: path.join(artifacts, 'map.png') });
  assert.deepEqual(errors, [], 'Renderer and bundled assets should load without errors');
  await quit();

  page = await launch();
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('sangota.save.v1')));
  assert.deepEqual(restored, saved, 'A normal exit and relaunch must preserve the entire run');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sangota.settings.v1'))?.fullscreen === true);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()), true);
  await page.keyboard.press('Enter');
  await waitScene(page, 'Map');
  assert.equal(await page.evaluate(() => window.__desktopTestGame.scene.getScene('Map').run.hero.id), saved.heroId);
  await toggleFullscreen();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sangota.settings.v1'))?.fullscreen === false);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__desktopTestGame.scene.getScene('Map').children.list.some(
    (item) => item.list?.some((child) => child.text === '设 置') && item.alpha === 1,
  ));
  await clickDesign(page, 738, 215);
  await waitNativeFullscreen(true);
  await toggleFullscreen();
  await waitNativeFullscreen(false);
  await page.waitForFunction(() => {
    const find = (items) => items.some((item) =>
      (item.type === 'Text' && item.x === 736 && item.y === 215 && item.text === '关') ||
      (item.list && find(item.list)),
    );
    return find(window.__desktopTestGame.scene.getScene('Map').children.list);
  });
  await page.keyboard.press('Escape');

  assert.equal(await page.evaluate(() => window.sangotaDesktop.setFullscreen('invalid').then(() => false, () => true)), true);
  const forbidden = await page.evaluate(async () => (await fetch('sangota://game/..%2fpackage.json')).status);
  assert.equal(forbidden, 403);
  await page.evaluate(() => window.open('file:///etc/passwd'));
  assert.equal(application.windows().length, 1);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(artifacts, 'resumed.png') });
  console.log('Desktop smoke passed: bundled assets, audio, real game save, relaunch/resume, fullscreen, renderer isolation.');
  console.log(`Screenshots: ${artifacts}`);
} catch (error) {
  console.error(error);
  if (application) {
    console.error('Window state:', await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win && { fullscreen: win.isFullScreen(), focused: win.isFocused(), bounds: win.getBounds() };
    }).catch(() => null));
    const page = application.windows()[0];
    await page?.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
  }
  console.error('Renderer errors:', errors);
  console.error(diagnostics.join('').slice(-6000));
  throw error;
} finally {
  await quit();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
