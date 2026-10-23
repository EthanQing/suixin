'use strict';

const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const projectRoot = path.resolve(__dirname, '..');
const shots = path.join(projectRoot, 'screenshots');
let desktop, page, directory, errors;

async function launch() {
  const env = { ...process.env, SUIXIN_E2E: '1', SUIXIN_TEST_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({ args: [projectRoot], env, timeout: 30000 });
  page = await desktop.firstWindow();
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('#project-heading')).not.toHaveText('正在打开清单…');
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return window.isVisible() && window.isFocused();
  })).toBe(true);
}

async function more(item) {
  await page.getByRole('button', { name: '更多选项', exact: true }).click();
  await page.locator('#app-menu').getByRole(/置顶/.test(item) ? 'menuitemcheckbox' : 'menuitem', { name: item, exact: true }).click();
}

async function add(value) {
  await page.getByRole('textbox', { name: '新待办内容', exact: true }).fill(value);
  await expect(page.getByRole('textbox', { name: '新待办内容', exact: true })).toHaveValue(value);
  await page.getByRole('textbox', { name: '新待办内容', exact: true }).press('Enter');
}

function row(value) { return page.locator('.task-row').filter({ has: page.getByText(value, { exact: true }) }); }

async function createProject(name) {
  await page.locator('#new-project-button').click();
  await page.locator('#editor-input').fill(name);
  await page.locator('#editor-save').click();
  await expect(page.locator('#project-heading')).toHaveText(`${name} · 待办事项`);
}

// Fixtures belong to tests, never to the application's defaults.
async function seedProjects() {
  for (const [name, tasks] of [
    ['光疗舱', ['整理所需数据', '优化模型', '检查测试结果']],
    ['盐雾', ['编写 APP 用户手册', '整理功能需求']],
    ['训练平台', ['完善界面', '测试功能']], ['个人事务', []]
  ]) {
    await createProject(name);
    for (const text of tasks) await add(text);
  }
  await page.getByRole('button', { name: '光疗舱', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(3);
}

test.beforeEach(async () => {
  const root = process.env.SUIXIN_TEST_ROOT || os.tmpdir();
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(shots, { recursive: true });
  directory = fs.mkdtempSync(path.join(root, 'suixin-desktop-'));
  await launch();
});

test.afterEach(async () => {
  const captured = errors || [];
  if (desktop) await desktop.close().catch(() => {});
  desktop = null;
  // Test data is always a unique disposable child of the test root.
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  expect(captured).toEqual([]);
});

test('空白首次启动、顶部加号键盘操作及溢出固定可见；删光后重启不补数据', async () => {
  await expect(page.locator('.project-tab')).toHaveCount(0);
  await expect(page.locator('#empty-title')).toHaveText('还没有项目，点击顶部 + 创建第一个项目');
  await expect(page.locator('#task-input')).toBeDisabled();
  await expect(page.locator('#add-form button')).toBeDisabled();
  await expect(page.locator('.section-heading button')).toHaveCount(0);
  let plus = page.locator('.project-bar > #new-project-button');
  await expect(plus).toHaveAttribute('title', '新建项目');
  await expect(plus).toHaveAttribute('aria-label', '新建项目');
  await plus.focus(); await plus.press('Enter');
  await page.locator('#editor-input').fill('第一个项目');
  await page.locator('#editor-save').click();
  await expect(page.locator('#task-input')).toBeEnabled();
  await page.locator('#task-input').fill('底部加号只添加待办');
  await page.locator('#add-form button').click();
  await expect(row('底部加号只添加待办')).toBeVisible();
  await expect(page.locator('.project-tab')).toHaveCount(1);
  await plus.focus(); await plus.press('Space');
  await expect(page.locator('#editor-dialog')).toBeVisible();
  await page.locator('#editor-cancel').click();
  await page.screenshot({ path: path.join(shots, '05-project-plus.png') });
  await more('管理项目');
  await page.getByRole('button', { name: '删除项目 第一个项目', exact: true }).click();
  await page.locator('#confirm-accept').click();
  await page.locator('#projects-close').click();
  await desktop.close(); await launch();
  plus = page.locator('.project-bar > #new-project-button');
  await expect(page.locator('.project-tab')).toHaveCount(0);
  await expect(page.locator('#task-input')).toBeDisabled();
  for (let i = 0; i < 8; i++) await createProject(`很长的测试项目名称 ${i}`);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(320, 300));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(320);
  const position = await plus.boundingBox();
  expect(position.x + position.width).toBeLessThan(320);
  expect(await page.locator('#project-tabs').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.locator('#project-tabs').evaluate(el => { el.scrollLeft = 0; });
  expect(await plus.boundingBox()).toEqual(position);
  await plus.click();
  await expect(page.locator('#editor-dialog')).toBeVisible();
});

test('写盘失败显示错误且保留输入与原文件；打开数据目录使用实际路径', async () => {
  await createProject('写入失败测试');
  const file = path.join(directory, 'data.json');
  const before = fs.readFileSync(file, 'utf8');
  fs.mkdirSync(`${file}.tmp`);
  await add('保存失败应保留');
  await expect(page.locator('#status')).toHaveClass(/error/);
  await expect(page.locator('#task-input')).toHaveValue('保存失败应保留');
  await expect(page.locator('.task-row')).toHaveCount(0);
  expect(fs.readFileSync(file, 'utf8')).toBe(before);
  fs.rmdirSync(`${file}.tmp`);
  await page.locator('#add-form button').click();
  await expect(row('保存失败应保留')).toBeVisible();
  await desktop.evaluate(({ shell }) => { shell.openPath = async file => { globalThis.openedDirectory = file; return ''; }; });
  await more('打开数据目录');
  expect(await desktop.evaluate(() => globalThis.openedDirectory)).toBe(directory);
  await desktop.evaluate(({ shell }) => { shell.openPath = async () => '测试打开失败'; });
  await more('打开数据目录');
  await expect(page.locator('#status-text')).toHaveText('测试打开失败');
});

test('参考图布局；完成显示对勾和删除线，保留原位，可取消并在重启后保留', async () => {
  await seedProjects();
  await expect(page.locator('.project-tab')).toHaveText(['光疗舱', '盐雾', '训练平台', '个人事务']);
  await expect(page.locator('.task-text')).toHaveText(['整理所需数据', '优化模型', '检查测试结果']);
  await page.screenshot({ path: path.join(shots, '01-default.png') });
  const originalIds = await page.locator('.task-row').evaluateAll(items => items.map(item => item.dataset.id));
  await row('优化模型').getByRole('checkbox').check();
  await expect(row('优化模型')).toHaveClass(/completed/);
  await expect(row('优化模型').locator('.task-text')).toHaveCSS('text-decoration-line', 'line-through');
  await expect(row('优化模型').getByRole('checkbox')).toBeChecked();
  expect(await page.locator('.task-row').evaluateAll(items => items.map(item => item.dataset.id))).toEqual(originalIds);
  await expect(row('优化模型')).toBeVisible();
  await page.screenshot({ path: path.join(shots, '02-completed-kept.png') });
  await row('优化模型').getByRole('checkbox').uncheck();
  await expect(row('优化模型')).not.toHaveClass(/completed/);
  await expect(row('优化模型').locator('.task-text')).toHaveCSS('text-decoration-line', 'none');
  await row('优化模型').getByRole('checkbox').check();
  await expect(row('优化模型')).toHaveClass(/completed/);
  await desktop.close();
  await launch();
  await expect(row('优化模型').getByRole('checkbox')).toBeChecked();
  expect(await page.locator('.task-row').evaluateAll(items => items.map(item => item.dataset.id))).toEqual(originalIds);
  const preference = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  expect(preference.nodeIntegration).toBe(false);
  expect(preference.contextIsolation).toBe(true);
  expect(preference.sandbox).toBe(true);
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
});

test('创建与切换独立项目；空内容无效；连续添加不丢失；编辑不改变完成；删除必须确认', async () => {
  await seedProjects();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.locator('#editor-input').fill('研发随记');
  await page.locator('#editor-save').click();
  await expect(page.locator('#project-heading')).toHaveText('研发随记 · 待办事项');
  await add('    ');
  await expect(page.locator('.task-row')).toHaveCount(0);
  await page.evaluate(() => {
    for (let i = 0; i < 12; i++) {
      document.getElementById('task-input').value = `连续记录 ${i}`;
      document.getElementById('add-form').requestSubmit();
    }
  });
  await expect(page.locator('.task-row')).toHaveCount(12);
  await expect(page.locator('.task-text')).toHaveText(Array.from({ length: 12 }, (_, i) => `连续记录 ${i}`));
  await expect(page.locator('#task-input')).toHaveValue('');
  await row('连续记录 0').getByRole('checkbox').check();
  await row('连续记录 0').hover();
  await row('连续记录 0').locator('[data-action="edit"]').click();
  await page.locator('#editor-input').fill('改过，仍然完成');
  await page.locator('#editor-save').click();
  await expect(row('改过，仍然完成').getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: '盐雾', exact: true }).click();
  await expect(page.locator('.task-text')).toHaveText(['编写 APP 用户手册', '整理功能需求']);
  await add('盐雾独有的记录');
  await expect(row('盐雾独有的记录')).toBeVisible();
  await page.getByRole('button', { name: '研发随记', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(12);
  await expect(row('盐雾独有的记录')).toHaveCount(0);
  await row('改过，仍然完成').hover();
  await row('改过，仍然完成').locator('[data-action="delete"]').click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await expect(page.locator('.task-row')).toHaveCount(12);
  await page.locator('#confirm-cancel').click();
  await expect(row('改过，仍然完成')).toBeVisible();
  await row('改过，仍然完成').hover();
  await row('改过，仍然完成').locator('[data-action="delete"]').click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('.task-row')).toHaveCount(11);
  await expect(row('改过，仍然完成')).toHaveCount(0);
  await page.locator('#task-input').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: '添加待办', exact: true }).click();
  await expect(row('<img src=x onerror=alert(1)>')).toBeVisible();
  await expect(page.locator('#task-list img')).toHaveCount(0);
});

test('项目重命名、排序与删除确认，重启后保存最后选择', async () => {
  await seedProjects();
  await more('管理项目');
  await page.getByRole('button', { name: '重命名 光疗舱', exact: true }).click();
  await page.locator('#editor-input').fill('光疗研发');
  await page.locator('#editor-save').click();
  await expect(page.locator('#projects-dialog')).toBeVisible();
  await page.getByRole('button', { name: '后移 光疗研发', exact: true }).click();
  await expect(page.locator('.project-tab')).toHaveText(['盐雾', '光疗研发', '训练平台', '个人事务']);
  await page.getByRole('button', { name: '删除项目 光疗研发', exact: true }).click();
  await expect(page.locator('#confirm-message')).toContainText('3 条待办');
  await page.locator('#confirm-cancel').click();
  await expect(page.getByRole('button', { name: '删除项目 光疗研发', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除项目 光疗研发', exact: true }).click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('#projects-dialog')).toBeVisible();
  await page.locator('#projects-close').click();
  await expect(page.locator('.project-tab')).toHaveText(['盐雾', '训练平台', '个人事务']);
  await page.getByRole('button', { name: '个人事务', exact: true }).click();
  await add('重启后仍然在这里');
  await expect(row('重启后仍然在这里')).toBeVisible();
  await desktop.close(); await launch();
  await expect(page.locator('#project-heading')).toHaveText('个人事务 · 待办事项');
  await expect(row('重启后仍然在这里')).toBeVisible();
  await expect(page.locator('.project-tab')).toHaveCount(3);
});

test('真实窗口置顶、缩放与滚动；关闭隐藏保持进程；托盘点击与菜单处理器恢复；窗口状态重启恢复', async () => {
  await seedProjects();
  await more('始终置顶');
  expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())).toBe(true);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 80, y: 90, width: 320, height: 300 }));
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 320, height: 300 });
  await add('缩小后直接添加');
  await expect(row('缩小后直接添加')).toBeVisible();
  await row('缩小后直接添加').getByRole('checkbox').check();
  await expect(row('缩小后直接添加')).toHaveClass(/completed/);
  await page.evaluate(() => {
    for (let i = 0; i < 15; i++) {
      document.getElementById('task-input').value = `完整列表 ${i}`;
      document.getElementById('add-form').requestSubmit();
    }
  });
  await expect(page.locator('.task-row')).toHaveCount(19);
  expect(await page.locator('#task-scroll').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  const inputBox = await page.locator('#task-input').boundingBox();
  expect(inputBox.y + inputBox.height).toBeLessThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: path.join(shots, '03-small-window.png') });
  await page.getByRole('button', { name: '隐藏到托盘', exact: true }).click();
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
  expect(await desktop.evaluate(() => !globalThis.__suixinTest.tray.isDestroyed())).toBe(true);
  await desktop.evaluate(() => globalThis.__suixinTest.tray.emit('click'));
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  await page.getByRole('button', { name: '最小化', exact: true }).click();
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
  await desktop.evaluate(() => {
    const menu = globalThis.__suixinTest.menu;
    menu.items.find(item => item.label === '显示窗口').click();
  });
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
  await desktop.evaluate(() => globalThis.__suixinTest.menu.items.find(item => item.label === '隐藏窗口').click());
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
  await desktop.evaluate(() => globalThis.__suixinTest.tray.emit('click'));
  await desktop.close(); await launch();
  const restored = await desktop.evaluate(({ BrowserWindow }) => ({ bounds: BrowserWindow.getAllWindows()[0].getBounds(), pin: BrowserWindow.getAllWindows()[0].isAlwaysOnTop() }));
  expect(restored.bounds).toEqual({ x: 80, y: 90, width: 320, height: 300 });
  expect(restored.pin).toBe(true);
  await expect(page.locator('.task-row')).toHaveCount(19);
  await expect(row('缩小后直接添加').getByRole('checkbox')).toBeChecked();
  // Exercise the exact native tray Exit callback and confirm process termination.
  const exited = new Promise(resolve => desktop.process().once('exit', resolve));
  await desktop.evaluate(() => { setImmediate(() => globalThis.__suixinTest.menu.items.find(item => item.label === '退出程序').click()); });
  await exited; desktop = null;
});

test('导出真实 JSON、导入预览与取消、确认覆盖、非法文件保护和导入前副本', async () => {
  await seedProjects();
  await row('整理所需数据').getByRole('checkbox').check();
  const exported = path.join(directory, 'exported.json');
  // File chooser responses are stubbed. Validation, confirmation UI, disk I/O,
  // import application and state restoration all execute the production code.
  await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, exported);
  await more('导出 JSON 备份');
  await expect(page.locator('#status-text')).toContainText('备份已保存');
  const backup = JSON.parse(fs.readFileSync(exported, 'utf8'));
  expect(backup.projects[0].tasks[0].completed).toBe(true);
  await add('导出之后新加的任务');
  await expect(row('导出之后新加的任务')).toBeVisible();
  await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, exported);
  await more('导入 JSON 备份');
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await expect(page.locator('#confirm-message')).toContainText('4 个项目、7 条待办');
  await page.locator('#confirm-cancel').click();
  await expect(row('导出之后新加的任务')).toBeVisible();
  await more('导入 JSON 备份');
  await page.locator('#confirm-accept').click();
  await expect(page.locator('#confirm-dialog')).not.toBeVisible();
  await expect(row('导出之后新加的任务')).toHaveCount(0);
  await expect(row('整理所需数据').getByRole('checkbox')).toBeChecked();
  const before = JSON.parse(fs.readFileSync(path.join(directory, 'before-import.json'), 'utf8'));
  expect(before.projects[0].tasks.some(t => t.text === '导出之后新加的任务')).toBe(true);
  const invalidFile = path.join(directory, 'invalid.json'); fs.writeFileSync(invalidFile, '{"version":1,"projects":"invalid"}');
  await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, invalidFile);
  await more('导入 JSON 备份');
  await expect(page.locator('#status')).toHaveClass(/error/);
  await expect(page.locator('.task-row')).toHaveCount(3);
  await expect(row('整理所需数据').getByRole('checkbox')).toBeChecked();
});
