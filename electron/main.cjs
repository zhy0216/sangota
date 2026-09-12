const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { GAME_URL, createAssetHandler, isGamePage, isProjectLink } = require('./protocol.cjs');

const TITLE = '三國 · 烽火尖塔';
const devUrl = !app.isPackaged ? process.env.SANGOTA_DEV_URL : undefined;
if (devUrl) {
  const url = new URL(devUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) {
    throw new Error('SANGOTA_DEV_URL must point to the local Vite server at http://127.0.0.1.');
  }
}

// Keep the profile independent of the executable location and translated title.
// Vite development has its own profile so experiments do not affect real runs.
app.setName(devUrl ? 'Sangota Development' : 'Sangota');
const userData = app.commandLine.getSwitchValue('user-data-dir') ||
  path.join(app.getPath('appData'), app.getName());
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.setAppUserModelId('io.github.zhy0216.sangota');

protocol.registerSchemesAsPrivileged([{
  scheme: 'sangota',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

let mainWindow = null;

function trustedSender(event) {
  return mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame && isGamePage(event.senderFrame.url, devUrl);
}

function openProjectLink(address) {
  if (isProjectLink(address)) {
    shell.openExternal(address).catch((error) => console.error('Could not open the project page:', error));
  }
}

async function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    title: TITLE,
    width: Math.min(1280, area.width),
    height: Math.min(720, area.height),
    minWidth: Math.min(960, area.width),
    minHeight: Math.min(540, area.height),
    useContentSize: true,
    backgroundColor: '#0d0b09',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (event) => event.preventDefault());
  win.on('closed', () => { mainWindow = null; });
  win.on('close', () => session.defaultSession.flushStorageData());
  const sendFullscreen = () => win.webContents.send('desktop:fullscreen-changed', win.isFullScreen());
  win.on('enter-full-screen', sendFullscreen);
  win.on('leave-full-screen', sendFullscreen);

  win.webContents.setWindowOpenHandler(({ url }) => {
    openProjectLink(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isGamePage(url, devUrl)) {
      event.preventDefault();
      openProjectLink(url);
    }
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isGamePage(url, devUrl)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      event.preventDefault();
      if (!input.isAutoRepeat) win.setFullScreen(!win.isFullScreen());
    }
    if (devUrl && input.key === 'F12') {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('Game renderer exited:', details.reason);
    dialog.showErrorBox('游戏窗口已停止', '请关闭并重新启动游戏，继续最近保存的进度。');
    app.exit(1);
  });

  await win.loadURL(devUrl || GAME_URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
      { label: TITLE, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] },
      { role: 'editMenu' },
    ]) : null);

    const assets = app.isPackaged ? path.join(process.resourcesPath, 'game') : path.join(__dirname, '..', 'dist');
    protocol.handle('sangota', createAssetHandler(assets, (url, options) => net.fetch(url, options)));
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    ipcMain.handle('desktop:set-fullscreen', (event, value) => {
      if (!trustedSender(event) || typeof value !== 'boolean') throw new Error('Invalid fullscreen request');
      mainWindow.setFullScreen(value);
    });

    await createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(failStartup);
    });
  }).catch(failStartup);
}

function failStartup(error) {
  console.error(error);
  dialog.showErrorBox('无法启动游戏', app.isPackaged
    ? '游戏文件加载失败。请尝试通过 Steam 验证文件完整性，或重新解压完整的游戏目录。'
    : '游戏文件加载失败。请先运行 bun run build，再启动桌面版。');
  app.exit(1);
}

app.on('before-quit', () => {
  if (app.isReady()) session.defaultSession.flushStorageData();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
