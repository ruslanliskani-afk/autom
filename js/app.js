const App = (() => {
  // ─── State ────────────────────────────────────────────────────────
  let data            = { version: 1, projects: [], tasks: [] };
  let currentProjectId = null;
  let currentTaskId    = null;
  let currentView      = 'today';
  let selectedColor    = '#6366f1';
  let timerInterval    = null;
  let timerTaskId      = null;
  let timerSeconds     = 0;
  let saving           = false;
  let charts           = {};

  // ─── Utils ────────────────────────────────────────────────────────
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
  }

  function fmtDuration(s) {
    const h = String(Math.floor(s / 3600)).padStart(2,'0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2,'0');
    const sec = String(s % 60).padStart(2,'0');
    return `${h}:${m}:${sec}`;
  }

  function fmtHM(s) {
    return `${Math.floor(s / 3600)}ч ${Math.floor((s % 3600) / 60)}м`;
  }

  function isOverdue(deadline) {
    return !!deadline && new Date(deadline) < new Date();
  }

  function isDueSoon(deadline) {
    if (!deadline) return false;
    const diff = new Date(deadline) - new Date();
    return diff > 0 && diff < 24 * 3600 * 1000;
  }

  function toast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
  }

  function showSync(on) {
    document.getElementById('sync-indicator').classList.toggle('hidden', !on);
  }

  // ─── Init ─────────────────────────────────────────────────────────
  async function init() {
    Storage.init();
    if (!Storage.isConfigured() && !Storage.isLocal()) {
      document.getElementById('setup-modal').classList.remove('hidden');
      return;
    }
    await boot();
  }

  async function boot() {
    showSync(true);
    try {
      data = await Storage.load();
    } catch (e) {
      toast('Ошибка загрузки: ' + e.message, 'error');
      data = { version: 1, projects: [], tasks: [] };
    } finally {
      showSync(false);
    }

    document.getElementById('setup-modal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    if (data.projects.length) currentProjectId = data.projects[0].id;

    renderSidebar();
    showView('today');

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    checkDeadlines();
    setInterval(checkDeadlines, 5 * 60 * 1000);
  }

  async function saveSetup() {
    const token  = document.getElementById('github-token').value.trim();
    const repo   = document.getElementById('github-repo').value.trim();
    const branch = document.getElementById('github-branch').value.trim() || 'main';
    if (!token) { toast('Введи GitHub Token', 'error'); return; }
    Storage.saveConfig({ token, repo, branch });
    await boot();
  }

  async function useLocal() {
    Storage.saveConfig({ local: true });
    await boot();
  }

  // ─── Persist ──────────────────────────────────────────────────────
  async function persist() {
    if (saving) return;
    saving = true;
    showSync(true);
    try {
      await Storage.save(data);
    } catch (e) {
      toast('Ошибка сохранения: ' + e.message, 'error');
    } finally {
      saving = false;
      showSync(false);
    }
  }

  // ─── Sidebar ──────────────────────────────────────────────────────
  function renderSidebar() {
    const list = document.getElementById('projects-list');
    list.innerHTML = '';
    if (!data.projects.length) {
      list.innerHTML = '<div class="nav-empty">Нет проектов</div>';
      return;
    }
    data.projects.forEach(p => {
      const open = data.tasks.filter(t => t.projectId === p.id && t.status !== 'done').length;
      const el = document.createElement('div');
      el.className = 'nav-item' + (p.id === currentProjectId ? ' active' : '');
      el.innerHTML = `
        <span class="project-dot" style="background:${p.color}"></span>
        <span class="project-name">${esc(p.name)}</span>
        ${open ? `<span class="badge">${open}</span>` : ''}
      `;
      el.onclick = () => selectProject(p.id);
      list.appendChild(el);
    });
  }

  function selectProject(id) {
    currentProjectId = id;
    renderSidebar();
    showView('kanban');
  }

  // ─── Views ────────────────────────────────────────────────────────
  function showView(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.nav-item[data-view]').forEach(n => n.classList.remove('active'));
    const el = document.getElementById(`view-${view}`);
    if (el) el.classList.remove('hidden');
    const nav = document.querySelector(`[data-view="${view}"]`);
    if (nav) nav.classList.add('active');

    if (view === 'kanban')    renderKanban();
    if (view === 'analytics') renderAnalytics();
    if (view === 'all-tasks') renderAllTasks();
    if (view === 'today')     renderToday();
  }

  // ─── Projects ─────────────────────────────────────────────────────
  function showNewProject() {
    document.getElementById('project-name').value        = '';
    document.getElementById('project-description').value = '';
    selectedColor = '#6366f1';
    document.querySelectorAll('.color-option').forEach(el => {
      el.classList.toggle('selected', el.dataset.color === selectedColor);
    });
    document.getElementById('project-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('project-name').focus(), 50);
  }

  function closeProjectModal() {
    document.getElementById('project-modal').classList.add('hidden');
  }

  function selectColor(el) {
    document.querySelectorAll('.color-option').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
    selectedColor = el.dataset.color;
  }

  async function createProject() {
    const name = document.getElementById('project-name').value.trim();
    if (!name) { toast('Введи название', 'error'); return; }
    const p = {
      id: 'proj_' + genId(),
      name,
      description: document.getElementById('project-description').value.trim(),
      color: selectedColor,
      createdAt: new Date().toISOString(),
    };
    data.projects.push(p);
    currentProjectId = p.id;
    closeProjectModal();
    renderSidebar();
    showView('kanban');
    await persist();
    toast('Проект создан', 'success');
  }

  // ─── Kanban ───────────────────────────────────────────────────────
  const COLS = [
    { id: 'todo',       label: 'К выполнению', color: '#6868a0' },
    { id: 'inprogress', label: 'В процессе',   color: '#6366f1' },
    { id: 'done',       label: 'Готово',        color: '#22c55e' },
  ];

  function renderKanban() {
    const view = document.getElementById('view-kanban');
    if (!currentProjectId) {
      view.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🗂️</div>
          <h2>Нет проектов</h2>
          <p>Создай первый проект чтобы начать отслеживать задачи</p>
          <button class="btn btn-primary" onclick="App.showNewProject()">+ Создать проект</button>
        </div>`;
      return;
    }

    const proj  = data.projects.find(p => p.id === currentProjectId);
    const tasks = data.tasks.filter(t => t.projectId === currentProjectId);

    view.innerHTML = `
      <div class="board-header">
        <div class="board-title">
          <span class="board-dot" style="background:${proj.color}"></span>
          <h1>${esc(proj.name)}</h1>
        </div>
        <div class="board-actions">
          <button class="btn btn-primary" onclick="App.showNewTask()">+ Задача</button>
        </div>
      </div>
      <div class="kanban-board">
        ${COLS.map(col => {
          const colTasks = tasks
            .filter(t => t.status === col.id)
            .sort((a, b) => { const o = {high:0,medium:1,low:2}; return (o[a.priority]??1)-(o[b.priority]??1); });
          return `
            <div class="kanban-column" data-status="${col.id}">
              <div class="column-header">
                <span class="column-dot" style="background:${col.color}"></span>
                <span class="column-title">${col.label}</span>
                <span class="column-count">${colTasks.length}</span>
              </div>
              <div class="column-tasks" id="col-${col.id}">
                ${colTasks.map(t => taskCard(t)).join('')}
              </div>
              <button class="add-task-btn" onclick="App.showNewTask('${col.id}')">+ Добавить</button>
            </div>`;
        }).join('')}
      </div>`;

    // Drag & drop
    COLS.forEach(col => {
      const el = document.getElementById(`col-${col.id}`);
      if (!el || typeof Sortable === 'undefined') return;
      Sortable.create(el, {
        group: 'tasks',
        animation: 150,
        ghostClass: 'task-ghost',
        onEnd: async evt => {
          const taskId   = evt.item.dataset.taskId;
          const newStatus = evt.to.closest('.kanban-column').dataset.status;
          const t = data.tasks.find(x => x.id === taskId);
          if (t && t.status !== newStatus) {
            t.status = newStatus;
            if (newStatus === 'done' && !t.completedAt) t.completedAt = new Date().toISOString();
            if (newStatus !== 'done') t.completedAt = null;
            renderSidebar();
            await persist();
          }
        },
      });
    });
  }

  function taskCard(t) {
    const blocked = (t.dependencies || []).some(id => {
      const dep = data.tasks.find(x => x.id === id);
      return dep && dep.status !== 'done';
    });
    const ovd = isOverdue(t.deadline) && t.status !== 'done';
    const soon = isDueSoon(t.deadline);
    return `
      <div class="task-card p-${t.priority || 'medium'} ${blocked ? 'task-blocked' : ''}"
           data-task-id="${t.id}" onclick="App.openTask('${t.id}')">
        <div class="task-card-header">
          <div class="task-pdot"></div>
          <div class="task-title-text">${esc(t.title)}</div>
        </div>
        ${t.description ? `<div class="task-desc-text">${esc(t.description).substring(0,90)}${t.description.length>90?'…':''}</div>` : ''}
        <div class="task-card-footer">
          ${t.deadline ? `<span class="card-tag ${ovd?'overdue':soon?'due-soon':''}">📅 ${fmtDate(t.deadline)}</span>` : ''}
          ${t.timeTracked > 0 ? `<span class="card-tag">⏱ ${fmtHM(t.timeTracked)}</span>` : ''}
          ${blocked ? `<span class="card-tag blocked">🔒 Заблокировано</span>` : ''}
        </div>
      </div>`;
  }

  // ─── Task Modal ───────────────────────────────────────────────────
  function showNewTask(status = 'todo') {
    currentTaskId = null;
    document.getElementById('task-title-input').value    = '';
    document.getElementById('task-description').value    = '';
    document.getElementById('task-status').value         = status;
    document.getElementById('task-priority').value       = 'medium';
    document.getElementById('task-deadline').value       = '';
    document.getElementById('task-timer-display').textContent   = '00:00:00';
    document.getElementById('timer-btn').textContent     = '▶ Старт';
    document.getElementById('time-tracked-display').textContent = 'Записано: 0ч 0м';
    document.getElementById('task-project-name').textContent    = projName();
    document.getElementById('task-created').textContent         = fmtDate(new Date().toISOString());
    document.getElementById('task-completed-row').style.display = 'none';
    renderDepsUI(null);
    document.getElementById('task-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('task-title-input').focus(), 50);
  }

  function openTask(id) {
    const t = data.tasks.find(x => x.id === id);
    if (!t) return;
    currentTaskId = id;

    document.getElementById('task-title-input').value = t.title;
    document.getElementById('task-description').value = t.description || '';
    document.getElementById('task-status').value      = t.status;
    document.getElementById('task-priority').value    = t.priority || 'medium';
    document.getElementById('task-deadline').value    = t.deadline
      ? new Date(t.deadline).toISOString().slice(0,16) : '';

    document.getElementById('time-tracked-display').textContent =
      `Записано: ${fmtHM(t.timeTracked || 0)}`;

    const running = timerTaskId === id && timerInterval;
    document.getElementById('timer-btn').textContent        = running ? '⏹ Стоп' : '▶ Старт';
    document.getElementById('task-timer-display').textContent = running ? fmtDuration(timerSeconds) : '00:00:00';

    const proj = data.projects.find(p => p.id === t.projectId);
    document.getElementById('task-project-name').textContent = proj ? proj.name : '';
    document.getElementById('task-created').textContent      = fmtDateTime(t.createdAt);

    const row = document.getElementById('task-completed-row');
    if (t.completedAt) {
      row.style.display = '';
      document.getElementById('task-completed').textContent = fmtDateTime(t.completedAt);
    } else {
      row.style.display = 'none';
    }

    renderDepsUI(t);
    document.getElementById('task-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('task-title-input').focus(), 50);
  }

  function renderDepsUI(task) {
    const depsList  = document.getElementById('task-dependencies-list');
    const depSelect = document.getElementById('task-dep-select');
    const deps      = task ? (task.dependencies || []) : [];

    depsList.innerHTML = deps.map(depId => {
      const dep = data.tasks.find(x => x.id === depId);
      if (!dep) return '';
      return `<div class="dep-tag">
        <span class="${dep.status==='done'?'dep-done':'dep-pending'}">${dep.status==='done'?'✓':'○'} ${esc(dep.title)}</span>
        <button class="dep-remove" onclick="App.removeDependency('${depId}')">✕</button>
      </div>`;
    }).join('');

    const available = data.tasks.filter(t =>
      t.projectId === (task ? task.projectId : currentProjectId) &&
      t.id !== currentTaskId &&
      !deps.includes(t.id)
    );
    depSelect.innerHTML = '<option value="">+ Добавить зависимость</option>' +
      available.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('');
  }

  function addDependency(depId) {
    if (!depId || !currentTaskId) return;
    const t = data.tasks.find(x => x.id === currentTaskId);
    if (t) {
      if (!t.dependencies) t.dependencies = [];
      if (!t.dependencies.includes(depId)) t.dependencies.push(depId);
      renderDepsUI(t);
    }
    document.getElementById('task-dep-select').value = '';
  }

  function removeDependency(depId) {
    const t = data.tasks.find(x => x.id === currentTaskId);
    if (t && t.dependencies) {
      t.dependencies = t.dependencies.filter(id => id !== depId);
      renderDepsUI(t);
    }
  }

  function closeTaskModal() {
    document.getElementById('task-modal').classList.add('hidden');
    currentTaskId = null;
  }

  async function saveTask() {
    const title = document.getElementById('task-title-input').value.trim();
    if (!title) { toast('Введи название задачи', 'error'); return; }

    const status   = document.getElementById('task-status').value;
    const dlVal    = document.getElementById('task-deadline').value;
    const deadline = dlVal ? new Date(dlVal).toISOString() : null;

    if (currentTaskId) {
      const t = data.tasks.find(x => x.id === currentTaskId);
      if (t) {
        const wasDone = t.status === 'done';
        t.title       = title;
        t.description = document.getElementById('task-description').value.trim();
        t.status      = status;
        t.priority    = document.getElementById('task-priority').value;
        t.deadline    = deadline;
        if (status === 'done' && !wasDone) t.completedAt = new Date().toISOString();
        if (status !== 'done')             t.completedAt = null;
      }
    } else {
      const t = {
        id:           'task_' + genId(),
        projectId:    currentProjectId,
        title,
        description:  document.getElementById('task-description').value.trim(),
        status,
        priority:     document.getElementById('task-priority').value,
        deadline,
        timeTracked:  0,
        dependencies: [],
        createdAt:    new Date().toISOString(),
        completedAt:  status === 'done' ? new Date().toISOString() : null,
      };
      data.tasks.push(t);
    }

    closeTaskModal();
    renderSidebar();
    if (currentView === 'kanban')    renderKanban();
    if (currentView === 'all-tasks') renderAllTasks();
    if (currentView === 'today')     renderToday();

    await persist();
    toast('Сохранено', 'success');
  }

  async function deleteTask() {
    if (!currentTaskId) return;
    if (!confirm('Удалить задачу?')) return;
    if (timerTaskId === currentTaskId) stopTimer();
    const id = currentTaskId;
    data.tasks = data.tasks.filter(t => t.id !== id);
    data.tasks.forEach(t => {
      if (t.dependencies) t.dependencies = t.dependencies.filter(x => x !== id);
    });
    closeTaskModal();
    renderSidebar();
    if (currentView === 'kanban')    renderKanban();
    if (currentView === 'all-tasks') renderAllTasks();
    if (currentView === 'today')     renderToday();
    await persist();
    toast('Задача удалена', 'info');
  }

  function projName() {
    if (!currentProjectId) return '';
    const p = data.projects.find(x => x.id === currentProjectId);
    return p ? p.name : '';
  }

  // ─── Timer ────────────────────────────────────────────────────────
  function toggleTimer() {
    if (timerInterval && timerTaskId === currentTaskId) stopTimer();
    else startTimer(currentTaskId);
  }

  function startTimer(taskId) {
    if (!taskId) return;
    if (timerInterval) stopTimer();
    timerTaskId  = taskId;
    timerSeconds = 0;
    const start  = Date.now();
    document.getElementById('timer-btn').textContent = '⏹ Стоп';
    timerInterval = setInterval(() => {
      timerSeconds = Math.floor((Date.now() - start) / 1000);
      const el = document.getElementById('task-timer-display');
      if (el) el.textContent = fmtDuration(timerSeconds);
    }, 1000);
  }

  function stopTimer() {
    if (!timerInterval) return;
    clearInterval(timerInterval);
    timerInterval = null;
    if (timerTaskId) {
      const t = data.tasks.find(x => x.id === timerTaskId);
      if (t) {
        t.timeTracked = (t.timeTracked || 0) + timerSeconds;
        const el = document.getElementById('time-tracked-display');
        if (el) el.textContent = `Записано: ${fmtHM(t.timeTracked)}`;
      }
    }
    const btn = document.getElementById('timer-btn');
    const disp = document.getElementById('task-timer-display');
    if (btn)  btn.textContent  = '▶ Старт';
    if (disp) disp.textContent = '00:00:00';
    timerSeconds = 0;
    timerTaskId  = null;
    persist();
  }

  // ─── Notifications ────────────────────────────────────────────────
  function checkDeadlines() {
    const now   = new Date();
    const soon  = new Date(now.getTime() + 24 * 3600 * 1000);
    data.tasks.forEach(t => {
      if (!t.deadline || t.status === 'done') return;
      const dl = new Date(t.deadline);
      if (dl < now) {
        const key = `notified_overdue_${t.id}`;
        if (!sessionStorage.getItem(key)) {
          notify(`⚠️ Просрочено: ${t.title}`, `Дедлайн был ${fmtDateTime(t.deadline)}`);
          sessionStorage.setItem(key, '1');
        }
      } else if (dl < soon) {
        const key = `notified_soon_${t.id}`;
        if (!sessionStorage.getItem(key)) {
          notify(`⏰ Скоро дедлайн: ${t.title}`, `До ${fmtDateTime(t.deadline)}`);
          sessionStorage.setItem(key, '1');
        }
      }
    });
  }

  function notify(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  }

  // ─── All Tasks ────────────────────────────────────────────────────
  function renderAllTasks(query = '') {
    const view = document.getElementById('view-all-tasks');
    const q    = query.toLowerCase();
    const tasks = data.tasks
      .filter(t => !q || t.title.toLowerCase().includes(q) || (t.description||'').toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.deadline && b.deadline) return new Date(a.deadline)-new Date(b.deadline);
        if (a.deadline) return -1;
        if (b.deadline) return 1;
        return new Date(b.createdAt)-new Date(a.createdAt);
      });

    view.innerHTML = `
      <div class="board-header">
        <h1>Все задачи <span style="color:var(--text3);font-size:14px;font-weight:400">(${tasks.length})</span></h1>
        <div class="board-actions">
          <input type="text" class="search-input" placeholder="Поиск..." value="${esc(query)}"
            oninput="App.filterTasks(this.value)">
          <button class="btn btn-primary" onclick="App.showNewTask()">+ Задача</button>
        </div>
      </div>
      <div class="view-scroll">
        ${tasks.length ? `
          <table class="tasks-table">
            <thead>
              <tr>
                <th>Задача</th><th>Проект</th><th>Статус</th>
                <th>Приоритет</th><th>Дедлайн</th><th>Время</th>
              </tr>
            </thead>
            <tbody>${tasks.map(t => taskRow(t)).join('')}</tbody>
          </table>` :
          '<div style="padding:32px;text-align:center;color:var(--text3)">Нет задач</div>'
        }
      </div>`;
  }

  function taskRow(t) {
    const proj = data.projects.find(p => p.id === t.projectId);
    const ovd  = isOverdue(t.deadline) && t.status !== 'done';
    const sLabels = { todo:'К выполнению', inprogress:'В процессе', done:'Готово' };
    const pLabels = { low:'Низкий', medium:'Средний', high:'Высокий' };
    return `
      <tr class="task-row" onclick="App.openTask('${t.id}')">
        <td class="task-row-title">${esc(t.title)}</td>
        <td>${proj ? `<span class="chip chip-project" style="border-color:${proj.color};color:${proj.color}">${esc(proj.name)}</span>` : '—'}</td>
        <td><span class="chip chip-${t.status}">${sLabels[t.status]||t.status}</span></td>
        <td><span class="chip chip-${t.priority}">${pLabels[t.priority]||t.priority}</span></td>
        <td class="${ovd?'text-danger':''}">${t.deadline ? fmtDate(t.deadline) : '—'}</td>
        <td>${t.timeTracked > 0 ? fmtHM(t.timeTracked) : '—'}</td>
      </tr>`;
  }

  function filterTasks(q) { renderAllTasks(q); }

  // ─── Today View ───────────────────────────────────────────────────
  function renderToday() {
    const view = document.getElementById('view-today');
    const now     = new Date();
    const dayEnd  = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const todayStr = now.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' });

    const overdue    = data.tasks.filter(t => t.deadline && new Date(t.deadline) < now && t.status !== 'done');
    const dueToday   = data.tasks.filter(t => t.deadline && new Date(t.deadline) >= now && new Date(t.deadline) < dayEnd && t.status !== 'done');
    const inProgress = data.tasks.filter(t => t.status === 'inprogress');

    view.innerHTML = `
      <div class="board-header">
        <h1>Сегодня</h1>
        <span class="date-chip">${todayStr}</span>
      </div>
      <div class="today-content">
        ${overdue.length ? `
          <div class="today-section">
            <div class="today-section-title overdue-color">🔴 Просрочено (${overdue.length})</div>
            <div class="today-tasks">${overdue.map(t => todayItem(t)).join('')}</div>
          </div>` : ''}
        <div class="today-section">
          <div class="today-section-title">📅 Сегодня (${dueToday.length})</div>
          <div class="today-tasks">
            ${dueToday.length
              ? dueToday.map(t => todayItem(t)).join('')
              : '<div class="today-empty">Нет задач на сегодня ✓</div>'}
          </div>
        </div>
        <div class="today-section">
          <div class="today-section-title">⚡ В процессе (${inProgress.length})</div>
          <div class="today-tasks">
            ${inProgress.length
              ? inProgress.map(t => todayItem(t)).join('')
              : '<div class="today-empty">Нет активных задач</div>'}
          </div>
        </div>
      </div>`;
  }

  function todayItem(t) {
    const proj = data.projects.find(p => p.id === t.projectId);
    return `
      <div class="today-task p-${t.priority||'medium'}" onclick="App.openTask('${t.id}')">
        <div class="today-task-left">
          <div class="today-task-title">${esc(t.title)}</div>
          <div class="today-task-meta">
            ${proj ? `<span class="today-task-project" style="color:${proj.color}">${esc(proj.name)}</span>` : ''}
            ${t.deadline ? `<span class="today-task-deadline">${fmtDateTime(t.deadline)}</span>` : ''}
          </div>
        </div>
        <div class="today-task-right">
          ${t.timeTracked > 0 ? `<span style="font-size:11px;color:var(--text3)">⏱ ${fmtHM(t.timeTracked)}</span>` : ''}
        </div>
      </div>`;
  }

  // ─── Analytics ────────────────────────────────────────────────────
  function renderAnalytics() {
    const view = document.getElementById('view-analytics');
    const total     = data.tasks.length;
    const done      = data.tasks.filter(t => t.status === 'done').length;
    const inProg    = data.tasks.filter(t => t.status === 'inprogress').length;
    const ovd       = data.tasks.filter(t => isOverdue(t.deadline) && t.status !== 'done').length;
    const totalTime = data.tasks.reduce((s, t) => s + (t.timeTracked||0), 0);
    const pct       = total ? Math.round(done/total*100) : 0;

    view.innerHTML = `
      <div class="board-header"><h1>Аналитика</h1></div>
      <div class="analytics-content">
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">Всего задач</div></div>
          <div class="stat-card"><div class="stat-value c-success">${done}</div><div class="stat-label">Выполнено</div></div>
          <div class="stat-card"><div class="stat-value c-accent">${inProg}</div><div class="stat-label">В процессе</div></div>
          <div class="stat-card"><div class="stat-value c-danger">${ovd}</div><div class="stat-label">Просрочено</div></div>
          <div class="stat-card"><div class="stat-value">${fmtHM(totalTime)}</div><div class="stat-label">Записано времени</div></div>
          <div class="stat-card"><div class="stat-value c-${pct>=80?'success':pct>=50?'warning':'danger'}">${pct}%</div><div class="stat-label">Выполнено</div></div>
        </div>
        <div class="charts-grid">
          <div class="chart-card"><h3>По статусу</h3><canvas id="ch-status"></canvas></div>
          <div class="chart-card"><h3>По приоритету</h3><canvas id="ch-priority"></canvas></div>
          <div class="chart-card"><h3>Задачи по проектам</h3><canvas id="ch-projects"></canvas></div>
          <div class="chart-card"><h3>Время по проектам (ч)</h3><canvas id="ch-time"></canvas></div>
        </div>
      </div>`;

    Object.values(charts).forEach(c => c.destroy && c.destroy());
    charts = {};

    const cDefs = {
      responsive: true,
      plugins: { legend: { labels: { color: '#9898b8', boxWidth: 12, padding: 14 } } }
    };

    if (typeof Chart === 'undefined') return;

    charts.status = new Chart(document.getElementById('ch-status'), {
      type: 'doughnut',
      data: {
        labels: ['К выполнению', 'В процессе', 'Готово'],
        datasets: [{
          data: [
            data.tasks.filter(t => t.status==='todo').length,
            data.tasks.filter(t => t.status==='inprogress').length,
            data.tasks.filter(t => t.status==='done').length,
          ],
          backgroundColor: ['#6868a0','#6366f1','#22c55e'],
          borderWidth: 0,
        }]
      },
      options: { ...cDefs, cutout: '65%' },
    });

    charts.priority = new Chart(document.getElementById('ch-priority'), {
      type: 'doughnut',
      data: {
        labels: ['Высокий', 'Средний', 'Низкий'],
        datasets: [{
          data: [
            data.tasks.filter(t => t.priority==='high').length,
            data.tasks.filter(t => t.priority==='medium').length,
            data.tasks.filter(t => t.priority==='low').length,
          ],
          backgroundColor: ['#ef4444','#f59e0b','#22c55e'],
          borderWidth: 0,
        }]
      },
      options: { ...cDefs, cutout: '65%' },
    });

    const projData = data.projects.map(p => ({
      name:  p.name,
      color: p.color,
      count: data.tasks.filter(t => t.projectId===p.id).length,
      hours: Math.round(data.tasks.filter(t => t.projectId===p.id).reduce((s,t)=>s+(t.timeTracked||0),0)/360)/10,
    }));

    const barOpts = (label) => ({
      ...cDefs,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { color:'#9898b8' }, grid: { color:'#2a2a3e' }, beginAtZero: true },
        x: { ticks: { color:'#9898b8' }, grid: { display: false } },
      },
    });

    charts.projects = new Chart(document.getElementById('ch-projects'), {
      type: 'bar',
      data: {
        labels: projData.map(p => p.name),
        datasets: [{
          data: projData.map(p => p.count),
          backgroundColor: projData.map(p => p.color + 'bb'),
          borderColor:     projData.map(p => p.color),
          borderWidth: 1,
          borderRadius: 5,
        }]
      },
      options: barOpts('Задач'),
    });

    charts.time = new Chart(document.getElementById('ch-time'), {
      type: 'bar',
      data: {
        labels: projData.map(p => p.name),
        datasets: [{
          data: projData.map(p => p.hours),
          backgroundColor: projData.map(p => p.color + 'bb'),
          borderColor:     projData.map(p => p.color),
          borderWidth: 1,
          borderRadius: 5,
        }]
      },
      options: barOpts('Часов'),
    });
  }

  // ─── Settings ─────────────────────────────────────────────────────
  function showSettings() {
    const cfg = Storage.getConfig() || {};
    document.getElementById('github-token').value  = cfg.token  || '';
    document.getElementById('github-repo').value   = cfg.repo   || 'ruslanliskani-afk/autom';
    document.getElementById('github-branch').value = cfg.branch || 'main';
    document.getElementById('setup-modal').classList.remove('hidden');
  }

  // ─── Event helpers ────────────────────────────────────────────────
  document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) {
      e.target.classList.add('hidden');
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
  });

  window.addEventListener('beforeunload', () => {
    if (timerInterval) stopTimer();
  });

  // ─── Public API ───────────────────────────────────────────────────
  return {
    init, saveSetup, useLocal, showView, showSettings,
    showNewProject, closeProjectModal, selectColor, createProject,
    showNewTask, openTask, closeTaskModal, saveTask, deleteTask,
    addDependency, removeDependency,
    toggleTimer,
    filterTasks,
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
