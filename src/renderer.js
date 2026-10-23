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
const subtaskDrafts = new Map();
let contextTarget = null;

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
    delete: '<path d="M2 4h12M6 4V2h4v2M4 4l1 10h6l1-10M7 7v4M9 7v4"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    chevron: '<path d="m6 3 5 5-5 5"/>',
    close: '<path d="m4 4 8 8M12 4l-8 8"/>'
  };
  holder.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${paths[name]}</svg>`;
  return holder.firstElementChild;
}

function currentProject() { return state.projects.find(p => p.id === state.selectedProjectId); }

function editTask(project, task, child = null) {
  const item = child || task;
  openEditor(child ? '编辑子任务' : '编辑待办', '待办内容', item.text, 2000,
    value => command({ type: child ? 'subtask:edit' : 'task:edit', projectId: project.id,
      taskId: task.id, subtaskId: child?.id, text: value }));
}

function deleteTask(project, task, child = null) {
  const item = child || task;
  const children = !child && task.subtasks?.length ? `及其中的 ${task.subtasks.length} 条子任务` : '';
  openConfirm(child ? '删除子任务？' : '删除待办？', `“${item.text}”${children}\n删除后将从本地清单中移除。`, '确认删除',
    () => command({ type: child ? 'subtask:delete' : 'task:delete', projectId: project.id,
      taskId: task.id, subtaskId: child?.id }));
}

function draftInput(taskId) {
  return $('task-list').querySelector(`[data-draft-id="${CSS.escape(taskId)}"]`);
}

function startSubtask(project, task) {
  closeMenu(); closeContextMenu();
  run(async () => {
    const current = state.projects.find(p => p.id === project.id)?.tasks.find(t => t.id === task.id);
    if (!current) return;
    if (current.subtasks?.length && current.expanded === false) {
      await command({ type: 'task:expand', projectId: project.id, taskId: task.id, expanded: true });
    }
    if (!subtaskDrafts.has(task.id)) subtaskDrafts.set(task.id, { text: '', busy: false });
    render();
    draftInput(task.id)?.focus();
    draftInput(task.id)?.scrollIntoView({ block: 'nearest' });
  });
}

function subtaskForm(project, task) {
  const draft = subtaskDrafts.get(task.id);
  const form = document.createElement('form'); form.className = 'subtask-form'; form.autocomplete = 'off';
  const input = document.createElement('input');
  input.className = 'subtask-input'; input.dataset.draftId = task.id;
  input.dataset.focusKey = `draft:${task.id}`; input.maxLength = 2000;
  input.placeholder = '输入子任务内容…'; input.setAttribute('aria-label', `为“${task.text}”添加子任务`);
  input.value = draft.text; input.disabled = draft.busy;
  input.addEventListener('input', () => { draft.text = input.value; });
  const cancel = button('取消添加子任务', 'icon-button', () => {
    if (draft.busy) return;
    subtaskDrafts.delete(task.id); render();
    $('task-list').querySelector(`[data-focus-key="add:${task.id}"]`)?.focus();
  });
  cancel.append(icon('close')); cancel.disabled = draft.busy;
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel.click(); }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = draft.text.trim();
    if (!value || draft.busy) return;
    draft.busy = true; input.disabled = true; cancel.disabled = true;
    run(async () => {
      try {
        await command({ type: 'subtask:add', projectId: project.id, taskId: task.id, text: value });
        draft.text = '';
      } finally {
        draft.busy = false; render();
        if (state.selectedProjectId === project.id && (document.activeElement === document.body
            || document.activeElement?.dataset.draftId === task.id)) draftInput(task.id)?.focus();
      }
    });
  });
  // Remove only an empty draft after focus has moved. Do not rebuild the row
  // during pointerdown: doing so would swallow the user's next click.
  form.addEventListener('focusout', () => setTimeout(() => {
    const liveForm = draftInput(task.id)?.form;
    if (!draft.busy && !draft.text && !liveForm?.contains(document.activeElement)
        && subtaskDrafts.get(task.id) === draft) {
      subtaskDrafts.delete(task.id); liveForm?.remove();
    }
  }, 0));
  form.append(input, cancel);
  return form;
}

function taskRow(project, task, child = null) {
  const item = child || task, parent = !child && !!task.subtasks?.length;
  const row = document.createElement(child ? 'li' : 'div');
  row.className = `task-row${child ? ' subtask-row' : ''}${parent ? ' parent-row' : ''}${item.completed ? ' completed' : ''}`;
  row.dataset.id = item.id;
  const expanded = task.expanded !== false;
  const toggle = () => run(() => {
    const current = state.projects.find(p => p.id === project.id)?.tasks.find(t => t.id === task.id);
    return command({ type: 'task:expand', projectId: project.id, taskId: task.id, expanded: current?.expanded === false });
  });
  if (parent) {
    const arrow = button(`${expanded ? '收起' : '展开'}：${task.text}`, 'icon-button expand-task', toggle);
    arrow.dataset.focusKey = `expand:${task.id}`;
    arrow.setAttribute('aria-expanded', String(expanded)); arrow.setAttribute('aria-controls', `subtasks-${task.id}`);
    arrow.append(icon('chevron')); row.append(arrow);
  }
  const check = document.createElement('input');
  check.type = 'checkbox'; check.className = 'task-check'; check.checked = item.completed;
  check.dataset.taskId = item.id; check.dataset.focusKey = `check:${item.id}`;
  check.disabled = parent;
  check.setAttribute('aria-label', parent ? `由子任务自动完成：${task.text}` : `${item.completed ? '取消完成' : '完成'}：${item.text}`);
  if (parent) check.title = '父任务由子任务自动完成';
  check.addEventListener('change', () => {
    run(() => command({ type: child ? 'subtask:toggle' : 'task:toggle', projectId: project.id, taskId: task.id, subtaskId: child?.id }))
      .catch(() => { check.checked = item.completed; });
  });
  const label = parent ? button(`切换子任务：${task.text}`, 'task-text task-title', toggle) : document.createElement('span');
  label.className = parent ? 'task-text task-title' : 'task-text'; label.textContent = item.text;
  if (parent) {
    label.dataset.focusKey = `title:${task.id}`;
    label.setAttribute('aria-expanded', String(expanded)); label.setAttribute('aria-controls', `subtasks-${task.id}`);
  }
  row.append(check, label);
  if (parent) {
    const progress = document.createElement('span'); progress.className = 'subtask-count';
    progress.textContent = `${task.subtasks.filter(t => t.completed).length}/${task.subtasks.length}`;
    progress.setAttribute('aria-label', `子任务已完成 ${progress.textContent}`); row.append(progress);
  }
  const actions = document.createElement('span'); actions.className = 'task-actions';
  if (!child) {
    const add = button(`添加子任务：${task.text}`, 'icon-button', () => startSubtask(project, task));
    add.append(icon('plus')); add.dataset.action = 'add-subtask'; add.dataset.focusKey = `add:${task.id}`; actions.append(add);
  }
  const edit = button(`编辑：${item.text}`, 'icon-button', () => editTask(project, task, child));
  edit.append(icon('edit')); edit.dataset.action = 'edit'; edit.dataset.focusKey = `edit:${item.id}`;
  const remove = button(`删除：${item.text}`, 'icon-button delete-task', () => deleteTask(project, task, child));
  remove.append(icon('delete')); remove.dataset.action = 'delete'; remove.dataset.focusKey = `delete:${item.id}`;
  actions.append(edit, remove); row.append(actions);
  row.addEventListener('contextmenu', event => {
    event.preventDefault(); showContextMenu(project, task, child, event.clientX, event.clientY);
  });
  row.addEventListener('keydown', event => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const bounds = row.getBoundingClientRect(); showContextMenu(project, task, child, bounds.x + 25, bounds.y + 20);
    }
  });
  return row;
}

function taskItem(project, task) {
  const item = document.createElement('li'); item.className = 'task-item';
  item.append(taskRow(project, task));
  const parent = !!task.subtasks?.length;
  if (parent || subtaskDrafts.has(task.id)) {
    const list = document.createElement('ul'); list.className = 'subtask-list'; list.id = `subtasks-${task.id}`;
    list.setAttribute('aria-label', `“${task.text}”的子任务`);
    list.hidden = parent && task.expanded === false;
    if (!list.hidden) {
      for (const child of task.subtasks || []) list.append(taskRow(project, task, child));
      const entry = document.createElement('li');
      if (subtaskDrafts.has(task.id)) entry.append(subtaskForm(project, task));
      else {
        const add = button('添加子任务', 'subtask-add', () => startSubtask(project, task));
        add.append(icon('plus'), document.createTextNode('添加子任务')); entry.append(add);
      }
      list.append(entry);
    }
    item.append(list);
  }
  return item;
}

function render() {
  const active = document.activeElement;
  const focusKey = active?.dataset.focusKey;
  const selection = active?.matches('.subtask-input') ? [active.selectionStart, active.selectionEnd] : null;
  closeContextMenu();
  const taskIds = new Set(state.projects.flatMap(p => p.tasks.map(t => t.id)));
  for (const taskId of subtaskDrafts.keys()) if (!taskIds.has(taskId)) subtaskDrafts.delete(taskId);
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
  $('task-list').replaceChildren(...(project?.tasks || []).map(task => taskItem(project, task)));
  $('task-scroll').scrollTop = scroll;
  if (focusKey) {
    const target = $('task-list').querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    target?.focus({ preventScroll: true });
    if (selection && target?.matches('.subtask-input')) target.setSelectionRange(...selection);
  }
  $('empty-state').hidden = !!project?.tasks.length;
  $('empty-title').textContent = project ? '这个项目，留给你的下一个想法。' : '还没有项目，点击顶部 + 创建第一个项目';
  $('empty-hint').textContent = project ? '在下方记一笔，什么时候想做就做。' : '';
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

function closeContextMenu(restoreFocus = false) {
  $('task-context-menu').hidden = true;
  if (restoreFocus && contextTarget) {
    $('task-list').querySelector(`[data-focus-key="${CSS.escape(contextTarget.focusKey)}"]`)?.focus();
  }
  contextTarget = null;
}

function showContextMenu(project, task, child, x, y) {
  closeMenu();
  contextTarget = { project, task, child, focusKey: child ? `check:${child.id}` : task.subtasks?.length ? `title:${task.id}` : `check:${task.id}` };
  const menu = $('task-context-menu');
  $('context-add-subtask').hidden = !!child;
  menu.hidden = false;
  menu.style.left = `${Math.max(10, Math.min(x, innerWidth - menu.offsetWidth - 10))}px`;
  menu.style.top = `${Math.max(10, Math.min(y, innerHeight - menu.offsetHeight - 10))}px`;
  menu.querySelector('button:not([hidden])').focus();
}

function openEditor(title, label, value, maxLength, action) {
  closeMenu(); closeContextMenu();
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
  closeMenu(); closeContextMenu();
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
  closeContextMenu();
  const opened = !$('app-menu').hidden;
  $('app-menu').hidden = opened;
  $('menu-button').setAttribute('aria-expanded', String(!opened));
  if (!opened) $('pin-button').focus();
});
document.addEventListener('click', event => {
  if (!$('app-menu').contains(event.target) && !$('menu-button').contains(event.target)) closeMenu();
  if (!$('task-context-menu').contains(event.target)) closeContextMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!$('task-context-menu').hidden) { event.preventDefault(); closeContextMenu(true); }
    else if (!$('app-menu').hidden) closeMenu(true);
  }
  const menu = !$('task-context-menu').hidden ? $('task-context-menu') : !$('app-menu').hidden ? $('app-menu') : null;
  if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const items = [...menu.querySelectorAll('button:not([hidden])')];
    const index = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }
});
$('context-add-subtask').addEventListener('click', () => {
  if (contextTarget) startSubtask(contextTarget.project, contextTarget.task);
});
$('context-edit-task').addEventListener('click', () => {
  if (contextTarget) editTask(contextTarget.project, contextTarget.task, contextTarget.child);
});
$('context-delete-task').addEventListener('click', () => {
  if (contextTarget) deleteTask(contextTarget.project, contextTarget.task, contextTarget.child);
});
$('task-scroll').addEventListener('scroll', () => closeContextMenu());
window.addEventListener('resize', () => closeContextMenu());
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
$('data-directory-button').addEventListener('click', () => { closeMenu(); run(() => window.todo.openDataDirectory()); });
$('dismiss-status').addEventListener('click', () => { $('status').hidden = true; });
$('export-button').addEventListener('click', () => {
  closeMenu(); run(async () => { const file = await window.todo.exportBackup(); if (file) notify(`备份已保存至：${file}`); });
});
$('import-button').addEventListener('click', () => {
  closeMenu(); run(async () => {
    const preview = await window.todo.chooseBackup();
    if (!preview) return;
    openConfirm('覆盖现有清单？', `备份包含 ${preview.projects} 个项目、${preview.tasks} 条待办。\n导入将替换全部现有项目、任务和窗口设置。现有清单会自动另存为 before-import.json。`, '确认导入',
      async () => { state = await window.todo.applyBackup(preview.token); subtaskDrafts.clear(); render(); notify('备份已导入，完成状态和排序已保留。'); },
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
  (state.projects.length ? $('task-input') : $('new-project-button')).focus();
});
