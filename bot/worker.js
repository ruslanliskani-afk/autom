/**
 * Autom Telegram Bot — Cloudflare Worker
 *
 * Управляет планером Autom через Telegram. Читает и пишет в тот же
 * приватный репозиторий с данными (autom-data), что и веб-приложение.
 *
 * Требуемые переменные окружения (задаются в Cloudflare → Settings → Variables):
 *   TELEGRAM_TOKEN   — токен бота от @BotFather
 *   GITHUB_TOKEN     — fine-grained токен с правом Contents:Read and write на репо данных
 *   GITHUB_REPO      — например: ruslanliskani-afk/autom-data
 *   ALLOWED_CHAT_ID  — твой Telegram ID (бот отвечает только тебе)
 *   DATA_BRANCH      — ветка с данными (по умолчанию: main)
 */

const DATA_PATH = 'data/board.json';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Autom bot is running', { status: 200 });
    }

    let update;
    try {
      update = await request.json();
    } catch (e) {
      return new Response('ok', { status: 200 });
    }

    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) return new Response('ok', { status: 200 });

    const chatId = String(msg.chat.id);
    const text = msg.text.trim();

    // Безопасность: отвечаем только владельцу
    if (env.ALLOWED_CHAT_ID && chatId !== String(env.ALLOWED_CHAT_ID)) {
      await sendMessage(env, chatId, '🚫 Этот бот личный.');
      return new Response('ok', { status: 200 });
    }

    try {
      const reply = await handleCommand(env, text);
      await sendMessage(env, chatId, reply);
    } catch (e) {
      await sendMessage(env, chatId, '⚠️ Ошибка: ' + e.message);
    }
    return new Response('ok', { status: 200 });
  },
};

// ─── Команды ──────────────────────────────────────────────────────────
async function handleCommand(env, text) {
  const [cmdRaw, ...rest] = text.split(' ');
  const cmd = cmdRaw.toLowerCase();
  const arg = rest.join(' ').trim();

  switch (cmd) {
    case '/start':
    case '/help':
      return helpText();
    case '/today':
      return await cmdToday(env);
    case '/list':
      return await cmdList(env);
    case '/add':
      return await cmdAdd(env, arg);
    case '/done':
      return await cmdDone(env, arg);
    default:
      return 'Не понял команду. ' + helpText();
  }
}

function helpText() {
  return [
    '🤖 *Autom — команды:*',
    '',
    '📅 /today — задачи на сегодня',
    '📋 /list — все открытые задачи',
    '➕ /add текст — добавить задачу',
    '✅ /done номер — отметить выполненной',
    '',
    'Пример: `/add Позвонить поставщику`',
  ].join('\n');
}

async function cmdToday(env) {
  const data = await loadData(env);
  const now = new Date();
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const overdue = data.tasks.filter(t => t.deadline && new Date(t.deadline) < now && t.status !== 'done');
  const dueToday = data.tasks.filter(t => t.deadline && new Date(t.deadline) >= now && new Date(t.deadline) < dayEnd && t.status !== 'done');
  const inProgress = data.tasks.filter(t => t.status === 'inprogress');

  let out = '*📅 Сегодня*\n';
  out += section('🔴 Просрочено', overdue, data);
  out += section('📌 На сегодня', dueToday, data);
  out += section('⚡ В процессе', inProgress, data);
  if (!overdue.length && !dueToday.length && !inProgress.length) out += '\nНа сегодня всё чисто ✓';
  return out;
}

async function cmdList(env) {
  const data = await loadData(env);
  const open = openTasks(data);
  if (!open.length) return 'Открытых задач нет 🎉';
  let out = '*📋 Открытые задачи:*\n';
  open.forEach((t, i) => {
    const proj = data.projects.find(p => p.id === t.projectId);
    out += `\n${i + 1}. ${esc(t.title)}${proj ? ` _(${esc(proj.name)})_` : ''}${t.deadline ? ` — ⏰ ${fmtDate(t.deadline)}` : ''}`;
  });
  out += '\n\n✅ Чтобы закрыть: /done номер';
  return out;
}

async function cmdAdd(env, arg) {
  if (!arg) return 'Напиши текст задачи: `/add Текст задачи`';
  const { data, sha } = await loadDataWithSha(env);

  // Гарантируем наличие проекта-приёмника
  let project = data.projects[0];
  if (!project) {
    project = { id: 'proj_' + genId(), name: 'Входящие', description: '', color: '#6366f1', createdAt: new Date().toISOString() };
    data.projects.push(project);
  }

  const task = {
    id: 'task_' + genId(),
    projectId: project.id,
    title: arg,
    description: '',
    status: 'todo',
    priority: 'medium',
    deadline: null,
    timeTracked: 0,
    dependencies: [],
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  data.tasks.push(task);
  await saveData(env, data, sha);
  return `✅ Добавлено в «${esc(project.name)}»:\n${esc(arg)}`;
}

async function cmdDone(env, arg) {
  const n = parseInt(arg, 10);
  if (!n || n < 1) return 'Укажи номер из /list: `/done 2`';
  const { data, sha } = await loadDataWithSha(env);
  const open = openTasks(data);
  const target = open[n - 1];
  if (!target) return `Задачи №${n} нет. Глянь /list`;
  const t = data.tasks.find(x => x.id === target.id);
  t.status = 'done';
  t.completedAt = new Date().toISOString();
  await saveData(env, data, sha);
  return `✅ Готово: ${esc(t.title)}`;
}

// ─── Хелперы данных ───────────────────────────────────────────────────
function openTasks(data) {
  return data.tasks
    .filter(t => t.status !== 'done')
    .sort((a, b) => {
      if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
}

function section(title, tasks, data) {
  if (!tasks.length) return '';
  let out = `\n*${title} (${tasks.length})*`;
  tasks.forEach(t => {
    const proj = data.projects.find(p => p.id === t.projectId);
    out += `\n• ${esc(t.title)}${proj ? ` _(${esc(proj.name)})_` : ''}`;
  });
  return out + '\n';
}

// ─── GitHub API ───────────────────────────────────────────────────────
async function ghFetch(env, method, body) {
  const branch = env.DATA_BRANCH || 'main';
  const base = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${DATA_PATH}`;
  const url = method === 'GET' ? `${base}?ref=${branch}` : base;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'autom-bot',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    throw new Error(`GitHub ${res.status}: ${err.slice(0, 120)}`);
  }
  return res;
}

async function loadDataWithSha(env) {
  const res = await ghFetch(env, 'GET');
  if (res.status === 404) {
    return { data: { version: 1, projects: [], tasks: [] }, sha: null };
  }
  const json = await res.json();
  const decoded = decodeBase64(json.content);
  return { data: JSON.parse(decoded), sha: json.sha };
}

async function loadData(env) {
  return (await loadDataWithSha(env)).data;
}

async function saveData(env, data, sha) {
  const content = encodeBase64(JSON.stringify(data, null, 2));
  const body = { message: 'chore: update via telegram bot', content, branch: env.DATA_BRANCH || 'main' };
  if (sha) body.sha = sha;
  await ghFetch(env, 'PUT', body);
}

// ─── Telegram ─────────────────────────────────────────────────────────
async function sendMessage(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

// ─── Утилиты ──────────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function esc(s) {
  return String(s || '').replace(/([_*`\[\]])/g, '\\$1');
}

function decodeBase64(b64) {
  const clean = b64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
