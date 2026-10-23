'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, validate, readBackup, atomicWrite, MAX_BACKUP_BYTES } = require('../src/store');

function fixture(t, seed = true) {
  const root = process.env.SUIXIN_TEST_ROOT || os.tmpdir();
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'suixin-unit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  if (seed) {
    for (const [name, tasks] of [
      ['光疗舱', ['整理所需数据', '优化模型', '检查测试结果']],
      ['盐雾', ['编写 APP 用户手册', '整理功能需求']],
      ['训练平台', ['完善界面', '测试功能']], ['个人事务', []]
    ]) {
      store.dispatch({ type: 'project:add', name });
      for (const text of tasks) store.dispatch({ type: 'task:add', projectId: store.state.selectedProjectId, text });
    }
    store.dispatch({ type: 'project:select', projectId: store.state.projects[0].id });
  }
  return { directory, store };
}

test('首次启动为空白；用户删除所有项目后重启仍为空白', t => {
  const { directory, store } = fixture(t, false);
  assert.deepEqual(store.state.projects, []);
  assert.equal(store.state.selectedProjectId, null);
  store.dispatch({ type: 'project:add', name: '主动删除' });
  store.dispatch({ type: 'project:delete', projectId: store.state.selectedProjectId });
  assert.deepEqual(new Store(directory).snapshot(), store.snapshot());
});

test('升级读取既有存档不写文件，空存档优先于含任务的备份或旧目录', t => {
  const { directory, store } = fixture(t);
  const bytes = fs.readFileSync(store.file);
  const modified = fs.statSync(store.file).mtimeMs;
  assert.deepEqual(new Store(directory).snapshot(), store.snapshot());
  assert.deepEqual(fs.readFileSync(store.file), bytes);
  assert.equal(fs.statSync(store.file).mtimeMs, modified);
  for (const p of store.snapshot().projects) store.dispatch({ type: 'project:delete', projectId: p.id });
  assert.deepEqual(new Store(directory).state.projects, []);
});

test('主文件缺失时恢复 .bak，损坏主文件恢复也不覆盖有效备份', t => {
  const { directory, store } = fixture(t);
  const backupFile = `${store.file}.bak`;
  const bytes = fs.readFileSync(backupFile);
  const expected = readBackup(backupFile);
  fs.unlinkSync(store.file);
  assert.deepEqual(new Store(directory).snapshot(), expected);
  assert.deepEqual(fs.readFileSync(backupFile), bytes);
  fs.writeFileSync(store.file, 'broken');
  assert.deepEqual(new Store(directory).snapshot(), expected);
  assert.deepEqual(fs.readFileSync(backupFile), bytes);
  assert.ok(fs.readdirSync(directory).filter(file => file.startsWith('recovery-')).length >= 2);
});

test('仅有 before-import、临时文件或旧路径存档时先确认并备份；不修改来源', t => {
  for (const name of ['before-import.json', 'data.json.tmp', 'data.json.damaged-old', 'recovery-old.json', 'legacy/data.json']) {
    const { directory, store } = fixture(t);
    const source = path.join(directory, name);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.copyFileSync(store.file, source);
    const bytes = fs.readFileSync(source);
    fs.unlinkSync(store.file); fs.unlinkSync(`${store.file}.bak`);
    const legacyDirectories = [path.join(directory, 'legacy')];
    assert.throws(() => new Store(directory, { legacyDirectories }), /尚未覆盖/);
    assert.equal(fs.existsSync(store.file), false);
    const restored = new Store(directory, { legacyDirectories, confirmRecovery: () => true });
    assert.deepEqual(restored.snapshot(), store.snapshot());
    assert.deepEqual(fs.readFileSync(source), bytes);
    assert.ok(fs.readdirSync(directory).some(file => /^recovery-.+\.json$/.test(file)));
    assert.match(restored.notice, /恢复/);
  }
});

test('无有效存档时保留读取错误，不能用空默认值掩盖损坏备份', t => {
  const { directory, store } = fixture(t, false);
  fs.unlinkSync(store.file);
  const source = path.join(directory, 'before-import.json');
  fs.writeFileSync(source, 'damaged import backup');
  assert.throws(() => new Store(directory), /尚未覆盖|原文件已保留/);
  assert.equal(fs.existsSync(store.file), false);
  assert.equal(fs.readFileSync(source, 'utf8'), 'damaged import backup');
});

test('完成只修改布尔值，保持全部任务、顺序、ID；重启后保留，且可取消完成', t => {
  const { directory, store } = fixture(t);
  const initial = store.snapshot();
  const projectId = initial.selectedProjectId;
  const taskId = initial.projects[0].tasks[1].id;
  const completed = store.dispatch({ type: 'task:toggle', projectId, taskId });
  const expected = structuredClone(initial);
  expected.projects[0].tasks[1].completed = true;
  assert.deepEqual(completed, expected);
  const reopened = new Store(directory);
  assert.deepEqual(reopened.snapshot(), expected);
  assert.deepEqual(reopened.dispatch({ type: 'task:toggle', projectId, taskId }), initial);
});

test('多个项目独立，连续添加按顺序，切换或编辑不改变完成状态', t => {
  const { store } = fixture(t);
  store.dispatch({ type: 'project:add', name: '独立项目' });
  const projectId = store.state.selectedProjectId;
  for (let n = 0; n < 50; n++) store.dispatch({ type: 'task:add', projectId, text: `事项 ${n}` });
  const taskId = store.state.projects.at(-1).tasks[0].id;
  store.dispatch({ type: 'task:toggle', projectId, taskId });
  store.dispatch({ type: 'task:edit', projectId, taskId, text: '编辑后仍完成' });
  store.dispatch({ type: 'project:select', projectId: store.state.projects[0].id });
  store.dispatch({ type: 'project:select', projectId });
  const p = store.state.projects.at(-1);
  assert.equal(p.tasks.length, 50);
  assert.equal(p.tasks[0].completed, true);
  assert.equal(p.tasks[0].text, '编辑后仍完成');
  assert.equal(p.tasks[49].text, '事项 49');
  assert.equal(store.state.projects[0].tasks.length, 3);
});

test('仅显式删除任务；重命名和项目排序均持久化', t => {
  const { store, directory } = fixture(t);
  const projectId = store.state.projects[0].id;
  const taskId = store.state.projects[0].tasks[0].id;
  store.dispatch({ type: 'task:delete', projectId, taskId });
  store.dispatch({ type: 'project:rename', projectId, name: '光疗研发' });
  store.dispatch({ type: 'project:move', projectId, direction: 1 });
  const next = new Store(directory);
  assert.equal(next.state.projects[1].name, '光疗研发');
  assert.equal(next.state.projects[1].tasks.length, 2);
  assert.equal(next.state.selectedProjectId, projectId);
});

test('允许删除全部项目，并可从空状态重新创建', t => {
  const { store } = fixture(t);
  for (const p of store.snapshot().projects) store.dispatch({ type: 'project:delete', projectId: p.id });
  assert.equal(store.state.selectedProjectId, null);
  assert.deepEqual(store.state.projects, []);
  store.dispatch({ type: 'project:add', name: '重新开始' });
  assert.equal(store.state.projects[0].id, store.state.selectedProjectId);
});

test('拒绝空白内容、非法状态、未知操作及重复 ID，不改动原数据', t => {
  const { store } = fixture(t);
  const before = store.snapshot(), projectId = before.selectedProjectId;
  assert.throws(() => store.dispatch({ type: 'task:add', projectId, text: '   ' }));
  assert.throws(() => store.dispatch({ type: 'project:add', name: '' }));
  assert.throws(() => store.dispatch({ type: 'task:archive', projectId }));
  assert.throws(() => store.dispatch({ type: 'project:move', projectId, direction: 4 }));
  const duplicate = structuredClone(before);
  duplicate.projects[0].tasks[0].id = projectId;
  assert.throws(() => store.replace(duplicate));
  const invalid = structuredClone(before); invalid.projects[0].tasks[0].completed = 'true';
  assert.throws(() => store.replace(invalid));
  assert.deepEqual(store.snapshot(), before);
});

test('JSON 导入导出往返保持完成状态、项目与任务排序、窗口设置', t => {
  const { store, directory } = fixture(t);
  const projectId = store.state.projects[2].id;
  store.dispatch({ type: 'project:select', projectId });
  store.dispatch({ type: 'task:toggle', projectId, taskId: store.state.projects[2].tasks[0].id });
  store.setWindow({ width: 350, height: 310, x: 50, y: 75, alwaysOnTop: true });
  const file = path.join(directory, 'export.json');
  atomicWrite(file, store.snapshot());
  const original = readBackup(file);
  store.dispatch({ type: 'project:delete', projectId });
  store.replace(original);
  assert.deepEqual(store.snapshot(), original);
  assert.deepEqual(new Store(directory).snapshot(), original);
});

test('写入失败时不提交内存状态，已有文件仍然有效', t => {
  const { store } = fixture(t);
  const originalFile = store.file, before = store.snapshot();
  fs.mkdirSync(`${originalFile}.tmp`);
  assert.throws(() => store.dispatch({ type: 'project:add', name: '不得提交' }));
  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(readBackup(originalFile), before);
});

test('损坏主文件从 .bak 恢复并保留损坏原件；双重损坏不会被默认数据覆盖', t => {
  const { store, directory } = fixture(t);
  const before = store.snapshot();
  store.dispatch({ type: 'project:add', name: '新项目' });
  fs.writeFileSync(store.file, '{broken');
  const recovered = new Store(directory);
  assert.deepEqual(recovered.snapshot(), before);
  assert.match(recovered.notice, /恢复/);
  assert.ok(fs.readdirSync(directory).some(file => file.includes('.damaged-')));
  fs.writeFileSync(store.file, 'broken-one'); fs.writeFileSync(`${store.file}.bak`, 'broken-two');
  assert.throws(() => new Store(directory), /尚未覆盖|原文件已保留/);
  assert.equal(fs.readFileSync(store.file, 'utf8'), 'broken-one');
});

test('无效选中项目回退，导入窗口尺寸限制在可用范围', t => {
  const { store } = fixture(t);
  const input = store.snapshot();
  input.selectedProjectId = 'missing'; input.window = { width: -1, height: 999999 };
  const value = validate(input);
  assert.equal(value.selectedProjectId, value.projects[0].id);
  assert.equal(value.window.width, 320); assert.equal(value.window.height, 2000);
});

test('大小上限按实际写入的格式化 JSON 计算，不会保存下次启动无法读取的文件', t => {
  const { store } = fixture(t);
  const before = store.snapshot();
  const oversized = store.snapshot();
  oversized.projects[0].tasks = Array.from({ length: 10000 }, (_, i) => ({
    id: `large_${i}`, text: 'x'.repeat(2000), completed: false
  }));
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) < MAX_BACKUP_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(oversized, null, 2)) > MAX_BACKUP_BYTES);
  assert.throws(() => store.replace(oversized), /20 MB/);
  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(readBackup(store.file), before);
});
