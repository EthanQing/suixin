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

function parentFixture(t) {
  const fixtureData = fixture(t, false);
  const { store } = fixtureData;
  store.dispatch({ type: 'project:add', name: '子任务测试' });
  const projectId = store.state.selectedProjectId;
  store.dispatch({ type: 'task:add', projectId, text: '分阶段计划' });
  const taskId = store.state.projects[0].tasks[0].id;
  const act = (type, extra = {}) => {
    const state = store.dispatch({ type, projectId, taskId, ...extra });
    assert.deepEqual(readBackup(store.file), state); // Every acknowledged change is on disk.
    return state.projects[0].tasks[0];
  };
  return { ...fixtureData, projectId, taskId, act };
}

test('子任务独立 ID、完成顺序和父状态由 Store 计算，完成后新增恢复未完成', t => {
  const { act, store, taskId, projectId, directory } = parentFixture(t);
  act('task:toggle');
  let parent = act('subtask:add', { text: '第一阶段' });
  assert.equal(parent.completed, false); assert.equal(parent.expanded, true);
  for (let i = 2; i <= 4; i++) parent = act('subtask:add', { text: `第${i}阶段` });
  const ids = parent.subtasks.map(item => item.id);
  assert.equal(new Set([taskId, ...ids]).size, 5);
  for (const subtaskId of ids.slice(0, 2)) parent = act('subtask:toggle', { subtaskId });
  assert.equal(parent.subtasks.filter(item => item.completed).length, 2);
  assert.equal(parent.completed, false);
  const before = store.snapshot();
  assert.throws(() => store.dispatch({ type: 'task:toggle', projectId, taskId }), /不能手动/);
  assert.deepEqual(store.snapshot(), before);
  for (const subtaskId of ids.slice(2)) parent = act('subtask:toggle', { subtaskId });
  assert.equal(parent.completed, true);
  parent = act('subtask:edit', { subtaskId: ids[0], text: '改名仍然完成' });
  assert.equal(parent.subtasks[0].completed, true);
  parent = act('subtask:toggle', { subtaskId: ids[1] });
  assert.equal(parent.completed, false);
  assert.deepEqual(parent.subtasks.map(item => item.id), ids);
  act('subtask:toggle', { subtaskId: ids[1] });
  parent = act('subtask:add', { text: '新增阶段' });
  assert.equal(parent.completed, false);
  act('task:expand', { expanded: false });
  assert.deepEqual(new Store(directory).snapshot(), store.snapshot());
});

test('删除子任务立即重算；删除最后一个保留之前完成状态，普通任务恢复手动勾选', t => {
  for (const completed of [false, true]) {
    const { act } = parentFixture(t);
    let parent = act('subtask:add', { text: '保留状态' });
    const firstId = parent.subtasks[0].id;
    act('subtask:toggle', { subtaskId: firstId });
    parent = act('subtask:add', { text: '删除未完成阶段' });
    parent = act('subtask:delete', { subtaskId: parent.subtasks[1].id });
    assert.equal(parent.completed, true);
    if (!completed) act('subtask:toggle', { subtaskId: firstId });
    parent = act('subtask:delete', { subtaskId: firstId });
    assert.equal(parent.completed, completed);
    assert.equal(Object.hasOwn(parent, 'subtasks'), false);
    assert.equal(Object.hasOwn(parent, 'expanded'), false);
    assert.equal(act('task:toggle').completed, !completed);
  }
});

test('旧任务无损读取；导入纠正父任务状态，空子任务列表仍保留普通任务原状态', t => {
  const { store } = fixture(t);
  const old = store.snapshot();
  assert.deepEqual(validate(old), old);
  const input = structuredClone(old);
  input.projects[0].tasks[0].subtasks = [{ id: 'child-one', text: '已完成', completed: true }];
  input.projects[0].tasks[0].completed = false;
  input.projects[0].tasks[1].subtasks = [];
  input.projects[0].tasks[1].completed = true;
  const imported = store.replace(input);
  assert.equal(imported.projects[0].tasks[0].completed, true);
  assert.equal(imported.projects[0].tasks[1].completed, true);
  assert.deepEqual(imported.projects[0].tasks[2], old.projects[0].tasks[2]);
});

test('拒绝嵌套、跨层重复 ID、非法子任务类型及展开状态；原数据不变', t => {
  const { store, act, taskId } = parentFixture(t);
  act('subtask:add', { text: '有效子任务' });
  const before = store.snapshot();
  for (const change of [
    task => { task.subtasks = null; },
    task => { task.subtasks[0].subtasks = []; },
    task => { task.subtasks[0].id = taskId; },
    task => { task.subtasks.push(structuredClone(task.subtasks[0])); },
    task => { task.subtasks[0].completed = 'true'; },
    task => { task.subtasks[0].text = '  '; },
    task => { task.expanded = 'false'; }
  ]) {
    const input = structuredClone(before); change(input.projects[0].tasks[0]);
    assert.throws(() => store.replace(input));
    assert.deepEqual(store.snapshot(), before);
    assert.deepEqual(readBackup(store.file), before);
  }
  assert.throws(() => act('subtask:add', { text: '  ' }));
  assert.throws(() => act('subtask:toggle', { subtaskId: 'missing' }));
});

test('子任务导出、导入及 .bak 恢复完整保留，删除父任务连同子任务删除', t => {
  const { store, directory, act, projectId, taskId } = parentFixture(t);
  let parent = act('subtask:add', { text: '备份子任务' });
  act('subtask:toggle', { subtaskId: parent.subtasks[0].id });
  act('task:expand', { expanded: false });
  const expected = store.snapshot();
  const exported = path.join(directory, 'export-subtasks.json');
  atomicWrite(exported, expected);
  store.dispatch({ type: 'task:delete', projectId, taskId });
  assert.equal(store.state.projects[0].tasks.length, 0);
  store.replace(readBackup(exported));
  assert.deepEqual(store.snapshot(), expected);
  store.setWindow({ width: expected.window.width }); // Rotate full tree to .bak.
  fs.writeFileSync(store.file, 'broken');
  assert.deepEqual(new Store(directory).snapshot(), expected);
});

test('子任务写入失败不提交任何内存或磁盘变化', t => {
  const { store, act } = parentFixture(t);
  const parent = act('subtask:add', { text: '保持未完成' });
  const before = store.snapshot(), bytes = fs.readFileSync(store.file);
  fs.mkdirSync(`${store.file}.tmp`);
  for (const [type, extra] of [
    ['subtask:add', { text: '不能保存' }], ['subtask:edit', { text: '不能改名' }],
    ['subtask:toggle', {}], ['subtask:delete', {}], ['task:expand', { expanded: false }]
  ]) {
    assert.throws(() => act(type, { subtaskId: parent.subtasks[0].id, ...extra }));
    assert.deepEqual(store.snapshot(), before);
    assert.deepEqual(fs.readFileSync(store.file), bytes);
  }
});

test('Windows 临时文件占用可重试，持续失败不删除或覆盖有效原文件', { skip: process.platform !== 'win32' }, t => {
  const { store, act } = parentFixture(t);
  const originalRename = fs.renameSync;
  let attempts = 0;
  fs.renameSync = (...args) => {
    if (args[1] === store.file && ++attempts < 3) throw Object.assign(new Error('temporary sharing denial'), { code: 'EPERM' });
    return originalRename(...args);
  };
  try { act('subtask:add', { text: '重试后保存' }); }
  finally { fs.renameSync = originalRename; }
  assert.equal(attempts, 3);
  const before = store.snapshot(), bytes = fs.readFileSync(store.file);
  attempts = 0;
  fs.renameSync = (...args) => {
    if (args[1] === store.file) { attempts++; throw Object.assign(new Error('persistent denial'), { code: 'EPERM' }); }
    return originalRename(...args);
  };
  try { assert.throws(() => act('subtask:add', { text: '失败不提交' }), /persistent denial/); }
  finally { fs.renameSync = originalRename; }
  assert.equal(attempts, 4);
  assert.deepEqual(store.snapshot(), before); assert.deepEqual(fs.readFileSync(store.file), bytes);
});
