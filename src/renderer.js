'use strict';

const $ = id => document.getElementById(id);
let state;
let queue = Promise.resolve();
let editorAction = null;
let confirmAction = null;
let confirmCancel = null;
let editorBusy = false;
let confirmBusy = false;
let returnToManagement = false;

function notify(message, error = false) {
  $('status-text').textContent = message;
  $('status').classList.toggle('error', error);
  $('status').hidden = false;
}

// Queue UI mutations so fast additions and project changes cannot race a save.
function run(action) {
  const result = queue.then(action);
  queue = result.catch(error => notify(error.message, true));
  return result;
}

async function command(value) {
  state = await window.todo.command(value);
  render();
}

function button(label, className, handler) {
  const element = document.createElement('button');
  element.type = 'button'; element.className = className;
  element.title = label; element.setAttribute('aria-label', label);
  element.addEventListener('click', handler);
  return element;
}

function icon(name) {
  const holder = document.createElement('span');
  // These are constant, trusted paths. Project and task content uses textContent.
  const paths = {
    edit: '<path d="M8 3l2 2M3 10l-1 4 4-1 8-8-3-3z"/>',
    delete: '<path d="M2 4h12M6 4V2h4v2M4 4l1 10h6l1-10M7 7v4M9 7v4"/>'
  };
  holder.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${paths[name]}</svg>`;
  return holder.firstElementChild;
}

function currentProject() { return state.projects.find(p => p.id === state.selectedProjectId); }

function render() {
  const active = document.activeElement;
  const focusTaskId = active?.dataset.taskId;
  const scroll = $('task-scroll').scrollTop;
  const tabScroll = $('project-tabs').scrollLeft;
  $('project-tabs').replaceChildren(...state.projects.map(project => {
    const tab = button(project.name, 'project-tab', () => {
      run(() => command({ type: 'project:select', projectId: project.id }));
    });
    tab.textContent = project.name;
    tab.setAttribute('aria-current', String(project.id === state.selectedProjectId));
    tab.dataset.projectId = project.id;
    return tab;
  }));
  $('project-tabs').scrollLeft = tabScroll;
  const project = currentProject();
  $('project-heading').textContent = project ? `${project.name} · 待办事项` : '我的项目';
  $('task-list').replaceChildren(...(project?.tasks || []).map(task => {
    const row = document.createElement('li');
    row.className = `task-row${task.completed ? ' completed' : ''}`;
    row.dataset.id = task.id;
    const check = document.createElement('input');
    check.type = 'checkbox'; check.className = 'task-check'; check.checked = task.completed;
    check.dataset.taskId = task.id;
    check.setAttribute('aria-label', `${task.completed ? '取消完成' : '完成'}：${task.text}`);
    check.addEventListener('change', () => {
      run(() => command({ type: 'task:toggle', projectId: project.id, taskId: task.id })).catch(() => { check.checked = task.completed; });
    });
    const label = document.createElement('span'); label.className = 'task-text'; label.textContent = task.text;
    const actions = document.createElement('span'); actions.className = 'task-actions';
    const edit = button(`编辑：${task.text}`, 'icon-button', () => openEditor('编辑待办', '待办内容', task.text, 2000,
      value => command({ type: 'task:edit', projectId: project.id, taskId: task.id, text: value })));
    edit.append(icon('edit')); edit.dataset.action = 'edit';
    const remove = button(`删除：${task.text}`, 'icon-button delete-task', () => {
      openConfirm('删除待办？', `“${task.text}”\n删除后将从本地清单中移除。`, '确认删除',
        () => command({ type: 'task:delete', projectId: project.id, taskId: task.id }));
    });
    remove.append(icon('delete')); remove.dataset.action = 'delete';
    actions.append(edit, remove); row.append(check, label, actions);
    return row;
  }));
  $('task-scroll').scrollTop = scroll;
  if (focusTaskId) $('task-list').querySelector(`[data-task-id="${CSS.escape(focusTaskId)}"]`)?.focus({ preventScroll: true });
  $('empty-state').hidden = !!project?.tasks.length;
  $('empty-title').textContent = project ? '这个项目，留给你的下一个想法。' : '先给你的想法建一个项目。';
  $('empty-hint').textContent = project ? '在下方记一笔，什么时候想做就做。' : '点击右侧 +，创建第一个项目。';
  $('task-input').disabled = !project;
  $('add-form').querySelector('button').disabled = !project;
  $('pin-button').setAttribute('aria-checked', String(state.window.alwaysOnTop));
  $('pin-check').textContent = state.window.alwaysOnTop ? '✓' : '';
  $('pin-indicator').hidden = !state.window.alwaysOnTop;
  if ($('projects-dialog').open) renderProjects();
}

function closeMenu(restoreFocus = false) {
  $('app-menu').hidden = true;
  $('menu-button').setAttribute('aria-expanded', 'false');
  if (restoreFocus) $('menu-button').focus();
}

function openEditor(title, label, value, maxLength, action) {
  closeMenu();
  editorAction = action;
  $('editor-title').textContent = title; $('editor-label').textContent = label;
  $('editor-input').maxLength = maxLength; $('editor-input').value = value;
  $('editor-input').setCustomValidity('');
  $('editor-dialog').showModal(); $('editor-input').focus(); $('editor-input').select();
}

function addProject() {
  pauseManagement();
  openEditor('新建项目', '项目名称', '', 80, async name => {
    await command({ type: 'project:add', name });
    requestAnimationFrame(() => $('project-tabs').querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }));
  });
}

function openConfirm(title, message, accept, action, cancel = null) {
  closeMenu();
  confirmAction = action; confirmCancel = cancel;
  $('confirm-title').textContent = title; $('confirm-message').textContent = message;
  $('confirm-accept').textContent = accept;
  $('confirm-dialog').showModal(); $('confirm-cancel').focus();
}

function pauseManagement() {
  returnToManagement = $('projects-dialog').open;
  if (returnToManagement) $('projects-dialog').close();
}

function restoreManagement() {
  if (returnToManagement) {
    returnToManagement = false;
    renderProjects(); $('projects-dialog').showModal();
  }
}

function renderProjects() {
  $('projects-list').replaceChildren(...state.projects.map((project, index) => {
    const row = document.createElement('li'); row.className = 'project-management-row';
    const name = document.createElement('span'); name.textContent = project.name; name.title = project.name;
    const left = button(`前移 ${project.name}`, 'icon-button', () => run(() => command({ type: 'project:move', projectId: project.id, direction: -1 })));
    left.textContent = '←'; left.disabled = index === 0;
    const right = button(`后移 ${project.name}`, 'icon-button', () => run(() => command({ type: 'project:move', projectId: project.id, direction: 1 })));
    right.textContent = '→'; right.disabled = index === state.projects.length - 1;
    const rename = button(`重命名 ${project.name}`, 'icon-button', () => {
      pauseManagement();
      openEditor('重命名项目', '项目名称', project.name, 80,
        value => command({ type: 'project:rename', projectId: project.id, name: value }));
    }); rename.append(icon('edit'));
    const remove = button(`删除项目 ${project.name}`, 'icon-button delete-task', () => {
      pauseManagement();
      openConfirm('删除项目？', `将删除“${project.name}”及其中的 ${project.tasks.length} 条待办（包括已完成事项）。\n此操作不可撤销。`, '删除项目',
        () => command({ type: 'project:delete', projectId: project.id }));
    }); remove.append(icon('delete'));
    row.append(name, left, right, rename, remove); return row;
  }));
}

$('editor-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = $('editor-input').value.trim();
  if (!value) { $('editor-input').setCustomValidity('请输入内容。'); $('editor-input').reportValidity(); return; }
  if (editorBusy) return;
  editorBusy = true; $('editor-save').disabled = true;
  run(async () => {
    try { await editorAction(value); $('editor-dialog').close(); }
    finally { editorBusy = false; $('editor-save').disabled = false; }
  }).catch(error => { $('editor-input').setCustomValidity(error.message); $('editor-input').reportValidity(); });
});
$('editor-input').addEventListener('input', () => $('editor-input').setCustomValidity(''));
$('editor-cancel').addEventListener('click', () => { if (!editorBusy) $('editor-dialog').close(); });
$('editor-dialog').addEventListener('cancel', event => { if (editorBusy) event.preventDefault(); });
$('editor-dialog').addEventListener('close', restoreManagement);

function cancelConfirmation() {
  if (confirmBusy) return;
  if (confirmCancel) { confirmCancel(); confirmCancel = null; }
  $('confirm-dialog').close();
}
$('confirm-cancel').addEventListener('click', cancelConfirmation);
$('confirm-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelConfirmation(); });
$('confirm-dialog').addEventListener('close', restoreManagement);
$('confirm-accept').addEventListener('click', () => {
  if (confirmBusy) return;
  confirmBusy = true; $('confirm-accept').disabled = true;
  run(async () => {
    try { await confirmAction(); confirmCancel = null; $('confirm-dialog').close(); }
    finally { confirmBusy = false; $('confirm-accept').disabled = false; }
  }).catch(error => { $('confirm-message').textContent = error.message; });
});

$('add-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('task-input'), value = input.value.trim(), projectId = state.selectedProjectId;
  if (!value || !projectId) return;
  input.value = ''; input.focus();
  run(async () => {
    await command({ type: 'task:add', projectId, text: value });
    if (state.selectedProjectId === projectId) $('task-scroll').scrollTop = $('task-scroll').scrollHeight;
  }).catch(() => { if (!input.value) input.value = value; });
});
$('menu-button').addEventListener('click', () => {
  const opened = !$('app-menu').hidden;
  $('app-menu').hidden = opened;
  $('menu-button').setAttribute('aria-expanded', String(!opened));
  if (!opened) $('pin-button').focus();
});
document.addEventListener('click', event => {
  if (!$('app-menu').contains(event.target) && !$('menu-button').contains(event.target)) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('app-menu').hidden) closeMenu(true);
  if (!$('app-menu').hidden && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const items = [...$('app-menu').querySelectorAll('button')];
    const index = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }
});
$('project-tabs').addEventListener('wheel', event => {
  if ($('project-tabs').scrollWidth > $('project-tabs').clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    event.preventDefault(); $('project-tabs').scrollLeft += event.deltaY;
  }
}, { passive: false });
$('new-project-button').addEventListener('click', addProject);
$('menu-new-project').addEventListener('click', addProject);
$('projects-add').addEventListener('click', addProject);
$('manage-projects').addEventListener('click', () => { closeMenu(); renderProjects(); $('projects-dialog').showModal(); });
$('projects-close').addEventListener('click', () => $('projects-dialog').close());
$('pin-button').addEventListener('click', () => { closeMenu(); run(async () => { state = await window.todo.pin(!state.window.alwaysOnTop); render(); }); });
$('minimize-button').addEventListener('click', () => run(() => window.todo.minimize()));
$('close-button').addEventListener('click', () => run(() => window.todo.hide()));
$('quit-button').addEventListener('click', () => { closeMenu(); run(() => window.todo.quit()); });
$('dismiss-status').addEventListener('click', () => { $('status').hidden = true; });
$('export-button').addEventListener('click', () => {
  closeMenu(); run(async () => { const file = await window.todo.exportBackup(); if (file) notify(`备份已保存至：${file}`); });
});
$('import-button').addEventListener('click', () => {
  closeMenu(); run(async () => {
    const preview = await window.todo.chooseBackup();
    if (!preview) return;
    openConfirm('覆盖现有清单？', `备份包含 ${preview.projects} 个项目、${preview.tasks} 条待办。\n导入将替换全部现有项目、任务和窗口设置。现有清单会自动另存为 before-import.json。`, '确认导入',
      async () => { state = await window.todo.applyBackup(preview.token); render(); notify('备份已导入，完成状态和排序已保留。'); },
      () => run(() => window.todo.cancelBackup()));
  });
});

window.todo.onState(next => { state = next; render(); });
window.todo.onError(message => notify(message, true));
run(async () => {
  const result = await window.todo.load(); state = result.state;
  render();
  document.querySelector('.footnote').title = `本地保存：${result.dataFile}`;
  if (result.notice) notify(result.notice, true);
  $('task-input').focus();
});
