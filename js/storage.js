const Storage = (() => {
  const DATA_PATH = 'data/board.json';
  let config = null;
  let dataSha = null;

  function init() {
    try {
      const saved = localStorage.getItem('autom_config');
      if (saved) config = JSON.parse(saved);
    } catch (e) {}
  }

  function isConfigured() {
    return !!(config && config.token);
  }

  function isLocal() {
    return !!(config && config.local);
  }

  function saveConfig(cfg) {
    config = cfg;
    localStorage.setItem('autom_config', JSON.stringify(cfg));
  }

  function getConfig() { return config; }

  function loadLocal() {
    try {
      const saved = localStorage.getItem('autom_data');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return { version: 1, projects: [], tasks: [] };
  }

  function saveLocal(data) {
    localStorage.setItem('autom_data', JSON.stringify(data));
  }

  async function githubFetch(method, path, body) {
    const branch = (config && config.branch) || 'main';
    const repo   = config.repo;
    const token  = config.token;

    // For GET, append ?ref= to read correct branch
    const url = method === 'GET'
      ? `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`
      : `https://api.github.com/repos/${repo}/contents/${path}`;

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(`GitHub ${res.status}: ${err.message || 'error'}`);
      e.status = res.status;
      throw e;
    }
    return res.json();
  }

  async function loadFromGitHub() {
    const result = await githubFetch('GET', DATA_PATH);
    dataSha = result.sha;
    // GitHub returns base64 with newlines
    const base64 = result.content.replace(/\s/g, '');
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.split('').map(c => c.charCodeAt(0)));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function saveToGitHub(data) {
    const json   = JSON.stringify(data, null, 2);
    const bytes  = new TextEncoder().encode(json);
    let binary   = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const content = btoa(binary);
    const branch  = (config && config.branch) || 'main';

    const body = {
      message: `chore: sync board data`,
      content,
      branch,
      ...(dataSha ? { sha: dataSha } : {}),
    };

    const result = await githubFetch('PUT', DATA_PATH, body);
    dataSha = result.content.sha;
  }

  async function load() {
    if (isLocal()) return loadLocal();

    if (isConfigured()) {
      try {
        const remote = await loadFromGitHub();
        saveLocal(remote);
        return remote;
      } catch (e) {
        if (e.status !== 404) console.warn('GitHub load failed, using local cache:', e.message);
        if (e.status === 404) {
          dataSha = null;
          const local = loadLocal();
          // Attempt to init the file on GitHub
          try { await saveToGitHub(local); } catch (_) {}
          return local;
        }
      }
    }
    return loadLocal();
  }

  async function save(data) {
    saveLocal(data);
    if (isLocal()) return;
    if (isConfigured()) await saveToGitHub(data);
  }

  return { init, isConfigured, isLocal, saveConfig, getConfig, load, save };
})();
