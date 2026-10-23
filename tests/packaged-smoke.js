'use strict';
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const executablePath = path.join(root, 'dist', 'win-unpacked', '随心待办.exe');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ executablePath, env, timeout: 30000 });
  try {
    const page = await desktop.firstWindow();
    await expect(page.locator('#project-heading')).not.toHaveText('正在打开清单…');
    const runtime = await desktop.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { packaged: app.isPackaged, version: app.getVersion(), userData: app.getPath('userData'),
        bounds: window.getBounds(), preferences: {
          nodeIntegration: window.webContents.getLastWebPreferences().nodeIntegration,
          sandbox: window.webContents.getLastWebPreferences().sandbox,
          contextIsolation: window.webContents.getLastWebPreferences().contextIsolation
        }, testHook: typeof globalThis.__suixinTest };
    });
    expect(runtime.packaged).toBe(true);
    expect(runtime.testHook).toBe('undefined');
    expect(runtime.preferences).toEqual({ nodeIntegration: false, sandbox: true, contextIsolation: true });
    const before = JSON.parse(fs.readFileSync(path.join(runtime.userData, 'data.json'), 'utf8'));
    await page.screenshot({ path: path.join(root, 'screenshots', '04-packaged.png') });
    await page.locator('#close-button').click();
    await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    const after = JSON.parse(fs.readFileSync(path.join(runtime.userData, 'data.json'), 'utf8'));
    expect(after.projects).toEqual(before.projects);
    expect(after.selectedProjectId).toEqual(before.selectedProjectId);
    const result = { ...runtime, closeHidesWindow: true, existingTasksUnchanged: true, result: 'passed' };
    fs.writeFileSync(path.join(root, 'test-results', 'packaged-smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await desktop.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
