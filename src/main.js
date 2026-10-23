'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, protocol, net, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Store, readBackup, atomicWrite } = require('./store');

const HOME = 'suixin://app/index.html';
protocol.registerSchemesAsPrivileged([{ scheme: 'suixin', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('随心待办');
const testing = !app.isPackaged && process.env.SUIXIN_E2E === '1';
// Explicit opt-in also isolates tests of the actual packaged/installed binary.
const isolated = process.env.SUIXIN_E2E === '1' && !!process.env.SUIXIN_TEST_DATA;
const dataDirectory = isolated
  ? path.resolve(process.env.SUIXIN_TEST_DATA)
  : path.join(app.getPath('appData'), 'SuixinTodo');
fs.mkdirSync(dataDirectory, { recursive: true });
app.setPath('userData', dataDirectory);

let win, tray, trayMenu, store;
let quitting = false;
let boundsTimer;
let pendingImport = null;
let fileDialogBusy = false;

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function saveBounds() {
  clearTimeout(boundsTimer);
  if (!store || !win || win.isDestroyed() || win.isMinimized()) return;
  try { store.setWindow(win.getNormalBounds()); }
  catch (error) { win.webContents.send('app:error', `窗口位置保存失败：${error.message}`); }
}

function setPinned(enabled) {
  // Save first: if the disk is full, both the UI and window keep their old setting.
  const state = store.setWindow({ alwaysOnTop: enabled });
  win.setAlwaysOnTop(enabled);
  updateTrayMenu();
  win.webContents.send('app:state', state);
  return state;
}

function updateTrayMenu() {
  trayMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: showWindow },
    { label: '隐藏窗口', click: () => win.hide() },
    { label: '打开数据目录', click: () => openDataDirectory().catch(error => dialog.showErrorBox('打开数据目录失败', error.message)) },
    { type: 'separator' },
    { label: '始终置顶', type: 'checkbox', checked: store.state.window.alwaysOnTop,
      click: item => { try { setPinned(item.checked); } catch (error) { dialog.showErrorBox('保存失败', error.message); updateTrayMenu(); } } },
    { type: 'separator' },
    { label: '退出程序', click: () => app.quit() }
  ]);
  tray.setContextMenu(trayMenu);
}

async function openDataDirectory() {
  const error = await shell.openPath(app.getPath('userData'));
  if (error) throw new Error(error);
}

function safeBounds(saved) {
  const candidate = { width: saved.width, height: saved.height };
  const display = Number.isInteger(saved.x)
    ? screen.getDisplayMatching({ x: saved.x, y: saved.y, width: saved.width, height: saved.height })
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  candidate.width = Math.max(320, Math.min(saved.width, area.width));
  candidate.height = Math.max(300, Math.min(saved.height, area.height));
  if (Number.isInteger(saved.x)) {
    candidate.x = Math.max(area.x, Math.min(saved.x, area.x + area.width - candidate.width));
    candidate.y = Math.max(area.y, Math.min(saved.y, area.y + area.height - candidate.height));
  }
  return candidate;
}

function registerIPC() {
  function handle(channel, callback) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame
          || event.senderFrame.url !== HOME) throw new Error('不受信任的请求。');
      try { return { ok: true, value: await callback(...args) }; }
      catch (error) { return { ok: false, error: error.message || '操作失败，请重试。' }; }
    });
  }
  handle('app:load', () => ({ state: store.snapshot(), notice: store.notice, dataFile: store.file }));
  handle('data:command', command => store.dispatch(command));
  handle('app:open-data-directory', openDataDirectory);
  handle('window:pin', enabled => {
    if (typeof enabled !== 'boolean') throw new Error('置顶设置无效。');
    return setPinned(enabled);
  });
  handle('window:minimize', () => { saveBounds(); win.minimize(); });
  handle('window:hide', () => { saveBounds(); win.close(); });
  handle('app:quit', () => { setImmediate(() => app.quit()); });
  handle('backup:export', async () => {
    if (fileDialogBusy) throw new Error('请先完成当前文件选择。');
    fileDialogBusy = true;
    try {
      const result = await dialog.showSaveDialog(win, {
        title: '导出待办备份', defaultPath: '随心待办备份.json',
        filters: [{ name: 'JSON 备份', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) return null;
      saveBounds();
      // Snapshot after the dialog, so additions made before export are included.
      atomicWrite(result.filePath, store.snapshot());
      return result.filePath;
    } finally { fileDialogBusy = false; }
  });
  handle('backup:choose', async () => {
    if (fileDialogBusy) throw new Error('请先完成当前文件选择。');
    fileDialogBusy = true; pendingImport = null;
    try {
      const result = await dialog.showOpenDialog(win, {
        title: '选择待办 JSON 备份', properties: ['openFile'],
        filters: [{ name: 'JSON 备份', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePaths.length) return null;
      const state = readBackup(result.filePaths[0]);
      const token = randomUUID();
      pendingImport = { token, state };
      return { token, projects: state.projects.length, tasks: state.projects.reduce((n, p) => n + p.tasks.length, 0) };
    } finally { fileDialogBusy = false; }
  });
  handle('backup:cancel', () => { pendingImport = null; });
  handle('backup:apply', token => {
    if (!pendingImport || pendingImport.token !== token) throw new Error('导入确认已失效，请重新选择备份。');
    // Retain a dedicated pre-import copy as well as the rotating .bak file.
    atomicWrite(path.join(path.dirname(store.file), 'before-import.json'), store.snapshot());
    const state = store.replace(pendingImport.state);
    pendingImport = null;
    win.setAlwaysOnTop(state.window.alwaysOnTop);
    win.setBounds(safeBounds(state.window));
    updateTrayMenu();
    return state;
  });
}

async function start() {
  store = new Store(app.getPath('userData'), {
    legacyDirectories: isolated ? [] : ['随心待办', 'suixin-todo', 'Electron'].map(name => path.join(app.getPath('appData'), name)),
    confirmRecovery: (file, files) => dialog.showMessageBoxSync({
      type: 'warning', title: '发现可恢复的待办数据',
      message: `当前数据缺失或异常。是否从以下文件恢复？\n${file}`,
      detail: `恢复前会另存副本，保留原文件，不合并或清理旧数据。\n已发现的有效存档：\n${files.join('\n')}`,
      buttons: ['取消并退出', '备份并恢复'], defaultId: 0, cancelId: 0
    }) === 1
  });
  // Only these bundled files can be served. No arbitrary paths or remote pages.
  const resources = new Map([
    ['/index.html', 'index.html'], ['/renderer.js', 'renderer.js'], ['/styles.css', 'styles.css']
  ]);
  protocol.handle('suixin', request => {
    const url = new URL(request.url), name = resources.get(url.pathname);
    if (url.host !== 'app' || !name || request.method !== 'GET') return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, name)).href);
  });
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    ...safeBounds(store.state.window), minWidth: 320, minHeight: 300,
    title: '我的待办清单', frame: false, transparent: true,
    backgroundColor: '#00000000', hasShadow: true, roundedCorners: true,
    resizable: true, maximizable: false, fullscreenable: false, show: false,
    alwaysOnTop: store.state.window.alwaysOnTop,
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, webviewTag: false, spellcheck: false
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true })
  );
  tray = new Tray(path.join(__dirname, '../assets/tray.ico'));
  tray.setToolTip('随心待办 · 点击打开清单');
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  updateTrayMenu();
  registerIPC();
  win.on('close', event => {
    saveBounds();
    if (!quitting) { event.preventDefault(); win.hide(); }
  });
  for (const event of ['move', 'resize']) {
    win.on(event, () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(saveBounds, 250); });
  }
  screen.on('display-removed', () => win.setBounds(safeBounds(win.getNormalBounds())));
  win.once('ready-to-show', showWindow);
  win.webContents.on('render-process-gone', (_event, details) => {
    if (!quitting) dialog.showErrorBox('界面意外关闭', `数据仍保存在本地。请从托盘退出程序后重新打开。\n${details.reason}`);
  });
  if (testing) {
    // Main-process access for automated desktop tests only; never exposed over IPC.
    globalThis.__suixinTest = { get tray() { return tray; }, get menu() { return trayMenu; }, get store() { return store; } };
  }
  await win.loadURL(HOME);
}

const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', () => { quitting = true; saveBounds(); });
  app.on('will-quit', () => { clearTimeout(boundsTimer); if (tray && !tray.isDestroyed()) tray.destroy(); });
  // Closing the small window deliberately keeps the process and tray alive.
  app.on('window-all-closed', () => {});
  app.whenReady().then(start).catch(error => {
    dialog.showErrorBox('随心待办无法启动', error.message);
    app.quit();
  });
}
