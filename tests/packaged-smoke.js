'use strict';
// --nsis runs the real installer twice. Retain isolated data and evidence even
// on failure; never delete or launch against the user's production profile.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

(async () => {
  const root = path.resolve(__dirname, '..');
  const nsis = process.argv.includes('--nsis');
  const upgradeIndex = process.argv.indexOf('--upgrade-from');
  const upgradeFrom = upgradeIndex < 0 ? null : process.argv[upgradeIndex + 1];
  if (upgradeIndex >= 0 && (!nsis || !upgradeFrom || upgradeFrom.startsWith('--'))) {
    throw new Error('--upgrade-from 需要与 --nsis 一起使用，并指定旧安装包路径。');
  }
  const oldVersion = upgradeFrom && path.basename(upgradeFrom).match(/^SuixinTodo-Setup-(.+)-x64\.exe$/)?.[1];
  if (upgradeFrom && !oldVersion) throw new Error('旧安装包文件名应包含版本：SuixinTodo-Setup-版本-x64.exe');
  const version = require('../package.json').version;
  const installer = path.join(root, 'dist', `SuixinTodo-Setup-${version}-x64.exe`);
  const results = path.join(root, 'test-results');
  fs.mkdirSync(results, { recursive: true });
  const directory = fs.mkdtempSync(path.join(results, upgradeFrom ? 'suixin-upgrade-' : nsis ? 'suixin-nsis-' : 'suixin-packaged-'));
  const userData = path.join(directory, 'profile');
  const installDirectory = path.join(directory, 'installed');
  const executablePath = nsis ? path.join(installDirectory, '随心待办.exe')
    : path.join(root, 'dist', 'win-unpacked', '随心待办.exe');
  const env = { ...process.env, SUIXIN_E2E: '1', SUIXIN_TEST_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const report = { mode: upgradeFrom ? 'NSIS-upgrade' : nsis ? 'NSIS' : 'win-unpacked', directory, executablePath, userData,
    fromVersion: oldVersion || version, toVersion: version, launches: [],
    logoff: '未验证', systemReboot: '未验证', physicalTrayClick: '未验证', checkpoints: [] };
  let desktop, page;

  async function install(source = installer) {
    if (!fs.existsSync(source)) throw new Error(`请先构建安装包：${source}`);
    await new Promise((resolve, reject) => {
      // NSIS requires /D last. Pass arguments without a shell.
      const child = spawn(path.resolve(source), ['/S', '/CURRENTUSER', `/D=${installDirectory}`], { env, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => reject(new Error('安装超过 120 秒；保留现场，请检查安装进程。')), 120000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`NSIS exit ${code}`)); });
    });
    expect(fs.existsSync(executablePath)).toBe(true);
  }
  async function more(label) {
    await page.locator('#menu-button').click();
    await page.locator('#app-menu').getByRole(label === '始终置顶' ? 'menuitemcheckbox' : 'menuitem', { name: label, exact: true }).click();
  }
  async function launch(expectedVersion = version) {
    desktop = await electron.launch({ executablePath, env, timeout: 30000 });
    page = await desktop.firstWindow();
    await expect(page.locator('#project-heading')).not.toHaveText('正在打开清单…');
    const runtime = await desktop.evaluate(({ app, BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { packaged: app.isPackaged, version: app.getVersion(), userData: app.getPath('userData'), exe: app.getPath('exe'),
        appData: app.getPath('appData'), testHook: typeof globalThis.__suixinTest,
        preferences: { nodeIntegration: prefs.nodeIntegration, sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation } };
    });
    expect(runtime.packaged).toBe(true);
    expect(runtime.version).toBe(expectedVersion);
    expect(runtime.exe.toLowerCase()).toBe(executablePath.toLowerCase());
    expect(runtime.userData).toBe(userData);
    expect(runtime.testHook).toBe('undefined');
    expect(runtime.preferences).toEqual({ nodeIntegration: false, sandbox: true, contextIsolation: true });
    report.runtime = runtime;
    report.launches.push(runtime);
    // Capture the real tray menu on its next rebuild. Instrumentation exists
    // only in Playwright's main-process debugger; no packaged test hook needed.
    await desktop.evaluate(({ Menu }) => {
      const build = Menu.buildFromTemplate;
      Menu.buildFromTemplate = function (...args) {
        const menu = build.apply(this, args); globalThis.capturedTrayMenu = menu; return menu;
      };
    });
    await more('始终置顶'); await more('始终置顶');
  }
  async function quitFromTray() {
    const closed = new Promise(resolve => desktop.process().once('exit', resolve));
    await desktop.evaluate(() => {
      const item = globalThis.capturedTrayMenu.items.find(item => item.label === '退出程序');
      setImmediate(() => item.click());
    });
    await closed; desktop = null;
  }
  async function project(name) {
    await page.locator('#new-project-button').click();
    await page.locator('#editor-input').fill(name); await page.locator('#editor-save').click();
    await expect(page.locator('#project-heading')).toHaveText(`${name} · 待办事项`);
  }
  async function task(text) {
    await page.locator('#task-input').fill(text); await page.locator('#add-form button').click();
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
  async function checkpoint(label) {
    const file = path.join(userData, 'data.json');
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(await page.locator('.project-tab').allTextContents()).toEqual(state.projects.map(p => p.name));
    const selected = state.projects.find(p => p.id === state.selectedProjectId);
    expect(await page.locator('.task-text').allTextContents()).toEqual(selected.tasks.map(t => t.text));
    expect(await page.locator('.task-check').evaluateAll(items => items.map(item => item.checked))).toEqual(selected.tasks.map(t => t.completed));
    expect(await page.locator('.project-tab[aria-current="true"]').getAttribute('data-project-id')).toBe(state.selectedProjectId);
    fs.copyFileSync(file, path.join(directory, `${label}.json`));
    report.checkpoints.push({ label, mtime: fs.statSync(file).mtime.toISOString(), state });
    return state;
  }
  try {
    if (nsis) await install(upgradeFrom || installer);
    await launch(oldVersion || version);
    await expect(page.locator('.project-tab')).toHaveCount(0);
    await expect(page.locator('#task-input')).toBeDisabled();
    await expect(page.locator('.project-bar > #new-project-button')).toBeVisible();
    await expect(page.locator('.section-heading button')).toHaveCount(0);
    await project('项目 A');
    const initialModified = fs.statSync(path.join(userData, 'data.json')).mtimeMs;
    await task('安装版持久化测试-123'); await task('项目 A 第二条');
    await page.locator('.task-check').first().check();
    await expect(page.locator('.task-row').first()).toHaveClass(/completed/);
    await page.locator('[data-action="add-subtask"]').first().click();
    for (const text of ['安装版子任务一', '安装版子任务二']) {
      await page.locator('.subtask-input').fill(text); await page.locator('.subtask-input').press('Enter');
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      await expect(page.locator('.subtask-input')).toHaveValue('');
    }
    await page.locator('.subtask-input').press('Escape');
    await page.locator('.subtask-row .task-check').first().check();
    await expect(page.locator('.subtask-count')).toHaveText('1/2');
    await page.locator('.expand-task').click();
    await project('项目 B'); await task('项目 B 独立任务');
    const before = await checkpoint('before-exit');
    expect(fs.statSync(path.join(userData, 'data.json')).mtimeMs).toBeGreaterThan(initialModified);
    await page.locator('#close-button').click();
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    await quitFromTray(); await launch(oldVersion || version);
    const reopened = await checkpoint('after-relaunch');
    expect(reopened.projects).toEqual(before.projects);
    expect(reopened.selectedProjectId).toBe(before.selectedProjectId);
    await page.getByRole('button', { name: '项目 A', exact: true }).click();
    await expect(page.locator('.task-check').first()).not.toBeChecked();
    await expect(page.locator('.subtask-count')).toHaveText('1/2');
    await expect(page.locator('.subtask-row')).toHaveCount(0);
    await expect(page.locator('.task-row')).toHaveCount(2);
    await page.locator('.expand-task').click();
    await expect(page.locator('.subtask-row .task-check').first()).toBeChecked();
    await expect(page.locator('.subtask-row .task-check').last()).not.toBeChecked();
    await page.locator('.expand-task').click();
    await page.getByRole('button', { name: '项目 B', exact: true }).click();
    await quitFromTray();
    if (nsis) {
      // Preserve a pre-import archive as well as the primary/rotating backup.
      fs.copyFileSync(path.join(userData, 'data.json'), path.join(userData, 'before-import.json'), fs.constants.COPYFILE_EXCL);
      const archives = ['data.json', 'data.json.bak', 'before-import.json'].map(name => [name, fs.readFileSync(path.join(userData, name))]);
      await install();
      for (const [name, bytes] of archives) expect(fs.readFileSync(path.join(userData, name))).toEqual(bytes);
      await launch();
      const upgraded = await checkpoint(upgradeFrom ? 'after-version-upgrade' : 'after-overwrite-install');
      expect(upgraded.projects).toEqual(before.projects);
      expect(upgraded.selectedProjectId).toBe(before.selectedProjectId);
      report.overwriteInstall = upgradeFrom ? `passed (${oldVersion} -> ${version})` : 'passed (same-version reinstall)';
      report.archivesUnchangedDuringInstall = archives.map(([name]) => name);
      if (upgradeFrom) {
        await quitFromTray(); await launch();
        const restarted = await checkpoint('after-upgrade-relaunch');
        expect(restarted.projects).toEqual(before.projects);
        expect(restarted.selectedProjectId).toBe(before.selectedProjectId);
      }
    } else await launch();
    await page.screenshot({ path: path.join(directory, 'packaged.png') });
    await quitFromTray(); report.result = 'passed';
  } catch (error) {
    report.result = 'failed'; report.error = error.stack; throw error;
  } finally {
    if (desktop) await desktop.close().catch(() => {});
    fs.writeFileSync(path.join(results, upgradeFrom ? 'upgrade-smoke.json' : nsis ? 'nsis-smoke.json' : 'packaged-smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
