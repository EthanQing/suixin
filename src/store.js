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
  const examples = [
    ['光疗舱', ['整理所需数据', '优化模型', '检查测试结果']],
    ['盐雾', ['编写 APP 用户手册', '整理功能需求']],
    ['训练平台', ['完善界面', '测试功能']],
    ['个人事务', []]
  ];
  const projects = examples.map(([name, tasks]) => ({
    id: randomUUID(), name,
    tasks: tasks.map(value => ({ id: randomUUID(), text: value, completed: false }))
  }));
  return { version: 1, projects, selectedProjectId: projects[0].id,
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
  const projects = value.projects.map(p => {
    if (!p || !Array.isArray(p.tasks)) throw new Error('项目中的任务列表格式不正确。');
    return {
      id: id(p.id), name: text(p.name, 80, '项目名称'),
      tasks: p.tasks.map(t => {
        if (!t || typeof t.completed !== 'boolean') throw new Error('任务完成状态格式不正确。');
        return { id: id(t.id), text: text(t.text, 2000, '任务内容'), completed: t.completed };
      })
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
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'w', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(data, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function readBackup(file) {
  if (fs.statSync(file).size > MAX_BACKUP_BYTES) throw new Error('备份超过 20 MB，无法导入。');
  return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
}

class Store {
  constructor(directory) {
    this.file = path.join(directory, 'data.json');
    this.notice = '';
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.existsSync(this.file) && !fs.existsSync(`${this.file}.bak`)) {
      this.state = defaults();
      atomicWrite(this.file, this.state);
      return;
    }
    try {
      this.state = readBackup(this.file);
    } catch (error) {
      // Keep damaged originals for manual recovery; never replace them with defaults.
      if (fs.existsSync(this.file)) {
        fs.copyFileSync(this.file, `${this.file}.damaged-${Date.now()}`);
      }
      try { this.state = readBackup(`${this.file}.bak`); }
      catch { throw new Error(`数据文件无法读取，原文件已保留。请备份该目录后修复或导入有效 data.json。\n${this.file}\n${error.message}`); }
      fs.copyFileSync(`${this.file}.bak`, this.file);
      this.notice = '数据文件异常，已从上一次有效的本地副本恢复。损坏原文件已保留。';
    }
  }

  snapshot() { return structuredClone(this.state); }

  commit(next) {
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
      case 'task:toggle': { const task = needTask(); task.completed = !task.completed; break; }
      case 'task:delete': { needTask(); project.tasks = project.tasks.filter(t => t.id !== command.taskId); break; }
      default: throw new Error('不支持的操作。');
    }
    return this.commit(next);
  }
}

module.exports = { Store, defaults, validate, atomicWrite, readBackup, MAX_BACKUP_BYTES };
