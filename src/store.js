'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`${label}不能为空，且不能超过 ${max} 个字符。`);
  }
  return value.trim();
}

function defaults() {
  return { version: 1, projects: [], selectedProjectId: null,
    window: { width: 420, height: 380, alwaysOnTop: false } };
}

function validate(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.projects)) {
    throw new Error('不是有效的随心待办备份，或备份版本不受支持。');
  }
  const ids = new Set();
  function id(raw) {
    if (typeof raw !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(raw) || ids.has(raw)) {
      throw new Error('备份中存在无效或重复的 ID。');
    }
    ids.add(raw);
    return raw;
  }
  function task(raw, child = false) {
    if (!raw || typeof raw.completed !== 'boolean') throw new Error('任务完成状态格式不正确。');
    if (child && Object.hasOwn(raw, 'subtasks')) throw new Error('子任务只支持一层，不能嵌套。');
    const item = { id: id(raw.id), text: text(raw.text, 2000, '任务内容'), completed: raw.completed };
    if (!child && Object.hasOwn(raw, 'subtasks')) {
      if (!Array.isArray(raw.subtasks)) throw new Error('子任务列表格式不正确。');
      if (raw.expanded !== undefined && typeof raw.expanded !== 'boolean') throw new Error('展开状态格式不正确。');
      if (raw.subtasks.length) {
        item.subtasks = raw.subtasks.map(value => task(value, true));
        item.completed = item.subtasks.every(value => value.completed);
        item.expanded = raw.expanded !== false;
      }
    }
    return item;
  }
  const projects = value.projects.map(p => {
    if (!p || !Array.isArray(p.tasks)) throw new Error('项目中的任务列表格式不正确。');
    return {
      id: id(p.id), name: text(p.name, 80, '项目名称'),
      tasks: p.tasks.map(value => task(value))
    };
  });
  const rawWindow = value.window || {};
  const window = {
    width: Number.isInteger(rawWindow.width) ? Math.max(320, Math.min(2000, rawWindow.width)) : 420,
    height: Number.isInteger(rawWindow.height) ? Math.max(300, Math.min(2000, rawWindow.height)) : 380,
    alwaysOnTop: rawWindow.alwaysOnTop === true
  };
  if (Number.isInteger(rawWindow.x) && Number.isInteger(rawWindow.y)) {
    window.x = rawWindow.x; window.y = rawWindow.y;
  }
  return {
    version: 1, projects, window,
    selectedProjectId: projects.some(p => p.id === value.selectedProjectId)
      ? value.selectedProjectId : (projects[0]?.id || null)
  };
}

// Flush the temporary file before replacing the destination. A failed write never
// commits in-memory changes; the last valid version remains in .bak as well.
function atomicWrite(file, data, backup = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = backup ? `${file}.tmp` : `${file}.restore-${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'w', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(data, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (backup && fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    // Windows can briefly deny replacement while another process holds a file
    // handle. Retry only transient errors; never unlink the valid destination.
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temporary, file); break; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 3) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
      }
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    // Do not mask the write error (e.g. a directory occupying the temp path).
    if (fs.existsSync(temporary) && fs.statSync(temporary).isFile()) fs.unlinkSync(temporary);
  }
}

function readBackup(file) {
  if (fs.statSync(file).size > MAX_BACKUP_BYTES) throw new Error('备份超过 20 MB，无法导入。');
  return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
}

class Store {
  constructor(directory, { legacyDirectories = [], confirmRecovery = () => false } = {}) {
    this.file = path.join(directory, 'data.json');
    this.notice = '';
    fs.mkdirSync(directory, { recursive: true });
    if (fs.existsSync(this.file)) {
      try { this.state = readBackup(this.file); return; }
      catch (error) {
        fs.copyFileSync(this.file, `${this.file}.damaged-${randomUUID()}`, fs.constants.COPYFILE_EXCL);
      }
    }
    // A valid empty primary is authoritative: never resurrect deleted projects.
    // Check all known archives before considering a brand-new empty file.
    const candidates = [];
    for (const dir of [directory, ...legacyDirectories]) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!/^(data\.json(?:\.bak|\.tmp|\.damaged-.+)?|before-import\.json(?:\.bak|\.tmp)?|recovery-.+\.json)$/.test(name)) continue;
        const file = path.join(dir, name);
        if (file === this.file) continue;
        candidates.push(file);
      }
    }
    const valid = [];
    const failures = [];
    for (const file of candidates) {
      try { valid.push({ file, state: readBackup(file), modified: fs.statSync(file).mtimeMs }); }
      catch (error) { failures.push(`${file}: ${error.message}`); }
    }
    // The rotating backup is the expected fallback. Other archives/old paths
    // can be stale, so require an explicit recovery choice before writing.
    valid.sort((a, b) => b.modified - a.modified);
    const recovery = valid.find(item => item.file === `${this.file}.bak`) || valid[0];
    if (recovery) {
      if (recovery.file !== `${this.file}.bak` && !confirmRecovery(recovery.file, valid.map(item => item.file))) {
        throw new Error(`发现可恢复的存档，尚未覆盖任何数据。请备份目录后重新启动并确认恢复。\n${valid.map(item => item.file).join('\n')}`);
      }
      const preserved = path.join(directory, `recovery-${randomUUID()}.json`);
      fs.copyFileSync(recovery.file, preserved, fs.constants.COPYFILE_EXCL);
      // Never rotate the damaged primary over the valid .bak.
      atomicWrite(this.file, recovery.state, false);
      this.state = recovery.state;
      this.notice = `数据文件缺失或异常，已恢复：${recovery.file}\n恢复前副本：${preserved}。原有备份和损坏文件已保留。`;
      return;
    }
    if (fs.existsSync(this.file) || candidates.length) {
      throw new Error(`数据文件无法读取，原文件已保留。请备份该目录后修复或导入有效 data.json。\n${this.file}\n${failures.join('\n')}`);
    }
    this.state = defaults();
    atomicWrite(this.file, this.state);
  }

  snapshot() { return structuredClone(this.state); }

  commit(next) {
    // Keep derived parent state identical for commands, imports and disk writes.
    next = validate(next);
    const serialized = JSON.stringify(next, null, 2);
    if (Buffer.byteLength(serialized) > MAX_BACKUP_BYTES) throw new Error('本地数据已达到 20 MB 上限，请先导出备份。');
    atomicWrite(this.file, next);
    this.state = next;
    return this.snapshot();
  }

  replace(value) { return this.commit(validate(value)); }

  setWindow(bounds) {
    const next = this.snapshot();
    next.window = validate({ ...next, window: { ...next.window, ...bounds } }).window;
    return this.commit(next);
  }

  dispatch(command) {
    if (!command || typeof command.type !== 'string') throw new Error('操作无效。');
    const next = this.snapshot();
    const project = next.projects.find(p => p.id === command.projectId);
    const needProject = () => { if (!project) throw new Error('项目不存在，请重新选择项目。'); return project; };
    const needTask = () => {
      const task = needProject().tasks.find(t => t.id === command.taskId);
      if (!task) throw new Error('任务不存在。');
      return task;
    };
    const needSubtask = () => {
      const subtask = needTask().subtasks?.find(item => item.id === command.subtaskId);
      if (!subtask) throw new Error('子任务不存在。');
      return subtask;
    };
    switch (command.type) {
      case 'project:add': {
        const item = { id: randomUUID(), name: text(command.name, 80, '项目名称'), tasks: [] };
        next.projects.push(item); next.selectedProjectId = item.id;
        break;
      }
      case 'project:rename': needProject().name = text(command.name, 80, '项目名称'); break;
      case 'project:select': needProject(); next.selectedProjectId = project.id; break;
      case 'project:delete': {
        needProject();
        const index = next.projects.indexOf(project);
        next.projects.splice(index, 1);
        if (next.selectedProjectId === project.id) {
          next.selectedProjectId = next.projects[Math.min(index, next.projects.length - 1)]?.id || null;
        }
        break;
      }
      case 'project:move': {
        needProject();
        if (command.direction !== -1 && command.direction !== 1) throw new Error('排序方向无效。');
        const from = next.projects.indexOf(project), to = from + command.direction;
        if (to >= 0 && to < next.projects.length) {
          [next.projects[from], next.projects[to]] = [next.projects[to], next.projects[from]];
        }
        break;
      }
      case 'task:add': needProject().tasks.push({ id: randomUUID(), text: text(command.text, 2000, '任务内容'), completed: false }); break;
      case 'task:edit': needTask().text = text(command.text, 2000, '任务内容'); break;
      // Completion never removes, filters, or sorts a task.
      case 'task:toggle': {
        const task = needTask();
        if (task.subtasks?.length) throw new Error('父任务由子任务自动完成，不能手动勾选。');
        task.completed = !task.completed; break;
      }
      case 'task:expand': {
        const task = needTask();
        if (!task.subtasks?.length || typeof command.expanded !== 'boolean') throw new Error('展开操作无效。');
        task.expanded = command.expanded; break;
      }
      case 'subtask:add': {
        const task = needTask();
        const item = { id: randomUUID(), text: text(command.text, 2000, '子任务内容'), completed: false };
        (task.subtasks ||= []).push(item); task.expanded = true; break;
      }
      case 'subtask:edit': needSubtask().text = text(command.text, 2000, '子任务内容'); break;
      case 'subtask:toggle': { const item = needSubtask(); item.completed = !item.completed; break; }
      case 'subtask:delete': {
        needSubtask();
        const task = needTask();
        task.subtasks = task.subtasks.filter(item => item.id !== command.subtaskId);
        // With no children, retain the parent's completion immediately before
        // deletion and restore ordinary manual completion.
        if (!task.subtasks.length) { delete task.subtasks; delete task.expanded; }
        break;
      }
      case 'task:delete': { needTask(); project.tasks = project.tasks.filter(t => t.id !== command.taskId); break; }
      default: throw new Error('不支持的操作。');
    }
    return this.commit(next);
  }
}

module.exports = { Store, defaults, validate, atomicWrite, readBackup, MAX_BACKUP_BYTES };
