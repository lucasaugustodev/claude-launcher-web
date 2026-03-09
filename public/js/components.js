// ─── UI Components ───

function isMobileView() {
  return window.innerWidth <= 768;
}

function el(tag, attrs = {}, children = []) {
  const elem = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') elem.className = v;
    else if (k === 'textContent') elem.textContent = v;
    else if (k === 'innerHTML') elem.innerHTML = v;
    else if (k.startsWith('on')) elem.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(elem.style, v);
    else elem.setAttribute(k, v);
  }
  for (const child of (Array.isArray(children) ? children : [children])) {
    if (typeof child === 'string') elem.appendChild(document.createTextNode(child));
    else if (child) elem.appendChild(child);
  }
  return elem;
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = el('div', { className: `toast ${type}`, textContent: message });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── Profile Form Modal ───

function showProfileModal(profile = null, onSave) {
  const isEdit = !!profile;

  const overlay = el('div', { className: 'modal-overlay' });
  const modal = el('div', { className: 'modal' });

  modal.innerHTML = `
    <div class="modal-title">${isEdit ? 'Editar Projeto' : 'Novo Projeto'}</div>
    <div class="form-group">
      <label>Nome</label>
      <input type="text" id="pf-name" value="${profile?.name || ''}" placeholder="Ex: Projeto Principal">
    </div>
    <div class="form-group">
      <label>Diretorio de Trabalho</label>
      <input type="text" id="pf-cwd" value="${profile?.workingDirectory || ''}" placeholder="C:\\Users\\...">
    </div>
    <div class="form-group">
      <label>Modo</label>
      <select id="pf-mode">
        <option value="normal" ${(!profile || profile.mode === 'normal') ? 'selected' : ''}>Normal</option>
        <option value="bypass" ${profile?.mode === 'bypass' ? 'selected' : ''}>Bypass (--dangerously-skip-permissions)</option>
      </select>
    </div>
    <div class="form-group">
      <label>Prompt Inicial (opcional)</label>
      <input type="text" id="pf-prompt" value="${profile?.initialPrompt || ''}" placeholder="Ex: Analise o codigo...">
    </div>
    <div class="form-group">
      <label>Node Memory MB (opcional)</label>
      <input type="number" id="pf-mem" value="${profile?.nodeMemory || ''}" placeholder="Ex: 8192">
    </div>
    <div class="form-group">
      <label>GitHub Repo (opcional - auto-versioning)</label>
      <select id="pf-github-repo">
        <option value="">Nenhum</option>
      </select>
      <div style="margin-top:6px">
        <a href="https://github.com/new" target="_blank" id="pf-create-repo-link" style="color:var(--accent);font-size:12px;text-decoration:none">+ Criar novo repositorio no GitHub</a>
        <button class="btn btn-sm" id="pf-refresh-repos" style="margin-left:8px;font-size:11px;padding:2px 8px">Atualizar lista</button>
      </div>
      <small style="color:var(--text-muted);display:block;margin-top:4px">Crie o repo no GitHub, depois clique em "Atualizar lista"</small>
    </div>
    <div class="form-group" id="pf-strategy-group" style="display:none">
      <label>Estrategia de Sync</label>
      <select id="pf-sync-strategy">
        <option value="branch" ${(!profile || profile.syncStrategy !== 'main') ? 'selected' : ''}>Branch + PR (cria branch e abre PR ao final)</option>
        <option value="main" ${profile?.syncStrategy === 'main' ? 'selected' : ''}>Commit direto no main</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn" id="pf-cancel">Cancelar</button>
      <button class="btn btn-primary" id="pf-save">${isEdit ? 'Salvar' : 'Criar'}</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.querySelector('#pf-cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.querySelector('#pf-save').onclick = async () => {
    const repoSelect = modal.querySelector('#pf-github-repo');
    const selectedRepo = repoSelect.value;

    const data = {
      name: modal.querySelector('#pf-name').value.trim(),
      workingDirectory: modal.querySelector('#pf-cwd').value.trim(),
      mode: modal.querySelector('#pf-mode').value,
      initialPrompt: modal.querySelector('#pf-prompt').value.trim(),
      nodeMemory: parseInt(modal.querySelector('#pf-mem').value) || null,
      githubRepo: selectedRepo || null,
      syncStrategy: selectedRepo ? modal.querySelector('#pf-sync-strategy').value : null,
    };

    if (!data.name) {
      showToast('Nome e obrigatorio', 'error');
      return;
    }

    overlay.remove();
    if (onSave) onSave(data);
  };

  // Show/hide strategy based on repo selection
  const repoSelect = modal.querySelector('#pf-github-repo');
  const strategyGroup = modal.querySelector('#pf-strategy-group');
  repoSelect.addEventListener('change', () => {
    strategyGroup.style.display = repoSelect.value ? 'block' : 'none';
  });

  // Load GitHub repos into dropdown
  async function loadRepos() {
    // Remove all options except "Nenhum"
    while (repoSelect.options.length > 1) repoSelect.remove(1);
    try {
      const { repos } = await API.listGitHubRepos();
      for (const r of repos) {
        const opt = document.createElement('option');
        opt.value = r.fullName;
        opt.textContent = `${r.fullName}${r.private ? ' (private)' : ''}`;
        if (profile?.githubRepo === r.fullName) opt.selected = true;
        repoSelect.appendChild(opt);
      }
      if (profile?.githubRepo) {
        strategyGroup.style.display = 'block';
      }
    } catch {
      // GitHub not connected
    }
  }

  loadRepos();

  // Refresh repos button
  modal.querySelector('#pf-refresh-repos').onclick = async (e) => {
    e.preventDefault();
    const btn = e.target;
    btn.textContent = '...';
    btn.disabled = true;
    await loadRepos();
    btn.textContent = 'Atualizar lista';
    btn.disabled = false;
    showToast('Lista atualizada');
  };

  // Focus name field
  setTimeout(() => modal.querySelector('#pf-name').focus(), 100);
}

// (ProfilesPage migrated to Preact in app.js)

// (ActivePage migrated to Preact in app.js)

// (HistoryPage migrated to Preact in app.js)

// ─── Schedule Modal ───

function showScheduleModal(schedule = null, onSave) {
  const isEdit = !!schedule;

  // Detect frequency type from existing schedule for pre-selection
  let freq = 'daily';
  let freqMinutes = 30, freqHours = 1, freqTime = '09:00', freqWeekday = '1', freqMonthday = '1', freqCron = '', freqRunAt = '';
  if (schedule) {
    if (schedule.type === 'interval') {
      freq = 'minutes';
      freqMinutes = schedule.intervalMinutes || 30;
    } else if (schedule.type === 'once') {
      freq = 'once';
      freqRunAt = schedule.runAt ? new Date(schedule.runAt).toISOString().slice(0, 16) : '';
    } else if (schedule.type === 'cron') {
      const cp = (schedule.cron || '').trim().split(/\s+/);
      if (cp.length === 5) {
        if (cp[0] === '0' && /^\*\/\d+$/.test(cp[1]) && cp[2] === '*' && cp[3] === '*' && cp[4] === '*') {
          freq = 'hours'; freqHours = parseInt(cp[1].replace('*/', '')) || 1;
        } else if (cp[2] === '*' && cp[3] === '*' && cp[4] === '*') {
          freq = 'daily'; freqTime = (cp[1] || '9').padStart(2, '0') + ':' + (cp[0] || '0').padStart(2, '0');
        } else if (cp[2] === '*' && cp[3] === '*' && cp[4] !== '*') {
          freq = 'weekly'; freqTime = (cp[1] || '9').padStart(2, '0') + ':' + (cp[0] || '0').padStart(2, '0'); freqWeekday = cp[4];
        } else if (cp[2] !== '*' && cp[3] === '*' && cp[4] === '*') {
          freq = 'monthly'; freqTime = (cp[1] || '9').padStart(2, '0') + ':' + (cp[0] || '0').padStart(2, '0'); freqMonthday = cp[2];
        } else {
          freq = 'cron'; freqCron = schedule.cron;
        }
      } else {
        freq = 'cron'; freqCron = schedule.cron || '';
      }
    }
  }

  const overlay = el('div', { className: 'modal-overlay' });
  const modal = el('div', { className: 'modal' });

  modal.innerHTML = `
    <div class="modal-title">${isEdit ? 'Editar Agendamento' : 'Novo Agendamento'}</div>
    <div class="form-group">
      <label>Nome</label>
      <input type="text" id="sch-name" value="${schedule?.name || ''}" placeholder="Ex: Deploy diario">
    </div>
    <div class="form-group">
      <label>Repetir</label>
      <select id="sch-freq">
        <option value="minutes" ${freq === 'minutes' ? 'selected' : ''}>A cada X minutos</option>
        <option value="hours" ${freq === 'hours' ? 'selected' : ''}>A cada X horas</option>
        <option value="daily" ${freq === 'daily' ? 'selected' : ''}>Diariamente</option>
        <option value="weekly" ${freq === 'weekly' ? 'selected' : ''}>Semanalmente</option>
        <option value="monthly" ${freq === 'monthly' ? 'selected' : ''}>Mensalmente</option>
        <option value="once" ${freq === 'once' ? 'selected' : ''}>Uma vez</option>
        <option value="cron" ${freq === 'cron' ? 'selected' : ''}>Cron (avancado)</option>
      </select>
    </div>
    <div class="form-group" id="sch-freq-minutes" style="display:none">
      <label>A cada quantos minutos?</label>
      <input type="number" id="sch-val-minutes" value="${freqMinutes}" min="1" max="1440">
    </div>
    <div class="form-group" id="sch-freq-hours" style="display:none">
      <label>A cada quantas horas?</label>
      <input type="number" id="sch-val-hours" value="${freqHours}" min="1" max="23">
    </div>
    <div class="form-group" id="sch-freq-daily" style="display:none">
      <label>Horario</label>
      <input type="time" id="sch-val-daily-time" value="${freqTime}">
    </div>
    <div class="form-group" id="sch-freq-weekly" style="display:none">
      <label>Dia da semana</label>
      <select id="sch-val-weekday">
        <option value="0" ${freqWeekday === '0' ? 'selected' : ''}>Domingo</option>
        <option value="1" ${freqWeekday === '1' ? 'selected' : ''}>Segunda</option>
        <option value="2" ${freqWeekday === '2' ? 'selected' : ''}>Terca</option>
        <option value="3" ${freqWeekday === '3' ? 'selected' : ''}>Quarta</option>
        <option value="4" ${freqWeekday === '4' ? 'selected' : ''}>Quinta</option>
        <option value="5" ${freqWeekday === '5' ? 'selected' : ''}>Sexta</option>
        <option value="6" ${freqWeekday === '6' ? 'selected' : ''}>Sabado</option>
      </select>
      <label style="margin-top:8px">Horario</label>
      <input type="time" id="sch-val-weekly-time" value="${freqTime}">
    </div>
    <div class="form-group" id="sch-freq-monthly" style="display:none">
      <label>Dia do mes</label>
      <input type="number" id="sch-val-monthday" value="${freqMonthday}" min="1" max="31">
      <label style="margin-top:8px">Horario</label>
      <input type="time" id="sch-val-monthly-time" value="${freqTime}">
    </div>
    <div class="form-group" id="sch-freq-once" style="display:none">
      <label>Data/Hora</label>
      <input type="datetime-local" id="sch-runat" value="${freqRunAt}">
    </div>
    <div class="form-group" id="sch-freq-cron" style="display:none">
      <label>Expressao Cron</label>
      <input type="text" id="sch-cron" value="${freqCron}" placeholder="0 9 * * *">
      <small style="color:var(--text-muted);display:block;margin-top:4px">Exemplos: "0 9 * * *" (9h diario), "*/30 * * * *" (cada 30min)</small>
    </div>
    <div class="form-group">
      <label>Tipo de Target</label>
      <select id="sch-target-type">
        <option value="profile" ${(!schedule || schedule.targetType === 'profile') ? 'selected' : ''}>Perfil</option>
        <option value="agent" ${schedule?.targetType === 'agent' ? 'selected' : ''}>Agente Claude</option>
        <option value="apm" ${schedule?.targetType === 'apm' ? 'selected' : ''}>Agente APM</option>
      </select>
    </div>
    <div class="form-group" id="sch-profile-group">
      <label>Perfil</label>
      <select id="sch-profile-id">
        <option value="">Carregando...</option>
      </select>
    </div>
    <div class="form-group" id="sch-agent-group" style="display:none">
      <label>Agente</label>
      <select id="sch-agent-id">
        <option value="">Carregando...</option>
      </select>
    </div>
    <div class="form-group" id="sch-apm-group" style="display:none">
      <label>Agente APM</label>
      <select id="sch-apm-id">
        <option value="">Carregando...</option>
      </select>
    </div>
    <div class="form-group" id="sch-workdir-group" style="display:none">
      <label>Diretorio de Trabalho</label>
      <input type="text" id="sch-workdir" value="${schedule?.targetConfig?.workingDirectory || ''}" placeholder="C:\\Users\\...">
    </div>
    <div class="form-group" id="sch-mode-group" style="display:none">
      <label>Modo</label>
      <select id="sch-mode">
        <option value="normal" ${(!schedule?.targetConfig?.mode || schedule?.targetConfig?.mode === 'normal') ? 'selected' : ''}>Normal</option>
        <option value="bypass" ${schedule?.targetConfig?.mode === 'bypass' ? 'selected' : ''}>Bypass</option>
      </select>
    </div>
    <div class="form-group">
      <label>Prompt / Instrucao</label>
      <textarea id="sch-prompt" rows="3" placeholder="Ex: Analise o repositorio e faca um commit com as melhorias" style="width:100%;resize:vertical;font-family:inherit;font-size:13px;padding:8px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:6px">${schedule?.prompt || ''}</textarea>
      <small style="color:var(--text-muted);display:block;margin-top:4px">Instrucao enviada ao Claude quando o agendamento executar</small>
    </div>
    <div class="modal-actions">
      <button class="btn" id="sch-cancel">Cancelar</button>
      <button class="btn btn-primary" id="sch-save">${isEdit ? 'Salvar' : 'Criar'}</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.querySelector('#sch-cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  // Toggle frequency-specific fields
  const freqSelect = modal.querySelector('#sch-freq');
  function updateFreqFields() {
    const f = freqSelect.value;
    modal.querySelector('#sch-freq-minutes').style.display = f === 'minutes' ? 'block' : 'none';
    modal.querySelector('#sch-freq-hours').style.display = f === 'hours' ? 'block' : 'none';
    modal.querySelector('#sch-freq-daily').style.display = f === 'daily' ? 'block' : 'none';
    modal.querySelector('#sch-freq-weekly').style.display = f === 'weekly' ? 'block' : 'none';
    modal.querySelector('#sch-freq-monthly').style.display = f === 'monthly' ? 'block' : 'none';
    modal.querySelector('#sch-freq-once').style.display = f === 'once' ? 'block' : 'none';
    modal.querySelector('#sch-freq-cron').style.display = f === 'cron' ? 'block' : 'none';
  }
  freqSelect.addEventListener('change', updateFreqFields);
  updateFreqFields();

  // Toggle target-specific fields
  const targetTypeSelect = modal.querySelector('#sch-target-type');
  function updateTargetFields() {
    const tt = targetTypeSelect.value;
    modal.querySelector('#sch-profile-group').style.display = tt === 'profile' ? 'block' : 'none';
    modal.querySelector('#sch-agent-group').style.display = tt === 'agent' ? 'block' : 'none';
    modal.querySelector('#sch-apm-group').style.display = tt === 'apm' ? 'block' : 'none';
    modal.querySelector('#sch-workdir-group').style.display = (tt === 'agent' || tt === 'apm') ? 'block' : 'none';
    modal.querySelector('#sch-mode-group').style.display = (tt === 'agent' || tt === 'apm') ? 'block' : 'none';
  }
  targetTypeSelect.addEventListener('change', updateTargetFields);
  updateTargetFields();

  // Load profiles
  API.getProfiles().then(profiles => {
    const sel = modal.querySelector('#sch-profile-id');
    sel.innerHTML = '';
    for (const p of profiles) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (schedule?.targetType === 'profile' && schedule?.targetId === p.id) opt.selected = true;
      sel.appendChild(opt);
    }
    if (profiles.length === 0) sel.innerHTML = '<option value="">Nenhum perfil</option>';
  }).catch(() => {});

  // Load Claude agents
  API.getClaudeAgents().then(data => {
    const agents = data.agents || [];
    const sel = modal.querySelector('#sch-agent-id');
    sel.innerHTML = '';
    for (const a of agents) {
      const opt = document.createElement('option');
      opt.value = a.name;
      opt.textContent = a.name + (a.model ? ' (' + a.model + ')' : '');
      if (schedule?.targetType === 'agent' && schedule?.targetId === a.name) opt.selected = true;
      sel.appendChild(opt);
    }
    if (agents.length === 0) sel.innerHTML = '<option value="">Nenhum agente</option>';
  }).catch(() => {});

  // Load APM agents
  API.getApmAgents().then(data => {
    const agents = data.agents || data || [];
    const sel = modal.querySelector('#sch-apm-id');
    sel.innerHTML = '';
    for (const a of agents) {
      const opt = document.createElement('option');
      opt.value = a.id || a.name;
      opt.textContent = a.name || a.id;
      if (schedule?.targetType === 'apm' && schedule?.targetId === (a.id || a.name)) opt.selected = true;
      sel.appendChild(opt);
    }
    if (agents.length === 0) sel.innerHTML = '<option value="">Nenhum agente APM</option>';
  }).catch(() => {});

  // Save handler
  overlay.querySelector('#sch-save').onclick = () => {
    const name = modal.querySelector('#sch-name').value.trim();
    if (!name) { showToast('Nome e obrigatorio', 'error'); return; }

    const f = freqSelect.value;
    const targetType = targetTypeSelect.value;

    let targetId;
    if (targetType === 'profile') targetId = modal.querySelector('#sch-profile-id').value;
    else if (targetType === 'agent') targetId = modal.querySelector('#sch-agent-id').value;
    else if (targetType === 'apm') targetId = modal.querySelector('#sch-apm-id').value;

    if (!targetId) { showToast('Selecione um target', 'error'); return; }

    const data = { name, targetType, targetId };

    // Translate frequency selection to backend type/cron/interval
    if (f === 'minutes') {
      data.type = 'interval';
      data.intervalMinutes = parseInt(modal.querySelector('#sch-val-minutes').value) || 30;
    } else if (f === 'hours') {
      const h = parseInt(modal.querySelector('#sch-val-hours').value) || 1;
      data.type = 'cron';
      data.cron = '0 */' + h + ' * * *';
    } else if (f === 'daily') {
      const tp = (modal.querySelector('#sch-val-daily-time').value || '09:00').split(':');
      data.type = 'cron';
      data.cron = (parseInt(tp[1]) || 0) + ' ' + (parseInt(tp[0]) || 9) + ' * * *';
    } else if (f === 'weekly') {
      const tp = (modal.querySelector('#sch-val-weekly-time').value || '09:00').split(':');
      const wd = modal.querySelector('#sch-val-weekday').value || '1';
      data.type = 'cron';
      data.cron = (parseInt(tp[1]) || 0) + ' ' + (parseInt(tp[0]) || 9) + ' * * ' + wd;
    } else if (f === 'monthly') {
      const tp = (modal.querySelector('#sch-val-monthly-time').value || '09:00').split(':');
      const md = modal.querySelector('#sch-val-monthday').value || '1';
      data.type = 'cron';
      data.cron = (parseInt(tp[1]) || 0) + ' ' + (parseInt(tp[0]) || 9) + ' ' + md + ' * *';
    } else if (f === 'once') {
      const dt = modal.querySelector('#sch-runat').value;
      if (!dt) { showToast('Data/hora e obrigatoria', 'error'); return; }
      data.type = 'once';
      data.runAt = new Date(dt).toISOString();
    } else if (f === 'cron') {
      data.type = 'cron';
      data.cron = modal.querySelector('#sch-cron').value.trim();
      if (!data.cron) { showToast('Expressao cron e obrigatoria', 'error'); return; }
    }

    data.prompt = modal.querySelector('#sch-prompt').value.trim() || null;

    data.targetConfig = {};
    if (targetType === 'agent' || targetType === 'apm') {
      data.targetConfig.workingDirectory = modal.querySelector('#sch-workdir').value.trim() || null;
      data.targetConfig.mode = modal.querySelector('#sch-mode').value;
    }

    overlay.remove();
    if (onSave) onSave(data);
  };

  // Focus name field
  setTimeout(() => modal.querySelector('#sch-name').focus(), 100);
}

// ─── Helpers ───

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function updateActiveCount() {
  try {
    const sessions = await API.getActiveSessions();
    const badge = document.getElementById('active-count');
    if (sessions.length > 0) {
      badge.textContent = sessions.length;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  } catch {}
}

// ═══════════════════════════════════════════
// File Manager Page
// ═══════════════════════════════════════════

let _fmCurrentPath = null;

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    js: '📄', ts: '📄', py: '📄', json: '📄', html: '📄', css: '📄',
    md: '📄', sh: '📄', log: '📄', txt: '📄', yml: '📄', yaml: '📄',
    zip: '📦', tar: '📦', gz: '📦', rar: '📦',
    png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', svg: '🖼',
    pdf: '📕',
  };
  return icons[ext] || '📄';
}

function renderBreadcrumbs(currentPath, container) {
  const _isWin = API.serverEnv && API.serverEnv.platform === 'win32';
  const _sep = _isWin ? '\\' : '/';
  const parts = currentPath.split(/[/\\]/).filter(Boolean);
  const bc = el('div', { className: 'fm-breadcrumbs' });

  // Root crumb: "/" on Linux, "C:\" on Windows
  const rootPath = _isWin ? (currentPath.match(/^[A-Za-z]:\\/) || ['C:\\'])[0] : '/';
  bc.appendChild(el('span', {
    className: 'fm-crumb clickable',
    textContent: rootPath,
    onClick: () => { _fmCurrentPath = rootPath; loadDirectory(rootPath, container); },
  }));

  let accumulated = _isWin ? rootPath.replace(/\\$/, '') : '';
  const startIdx = _isWin && parts[0] && parts[0].match(/^[A-Za-z]:$/) ? 1 : 0;

  for (let i = startIdx; i < parts.length; i++) {
    accumulated += _sep + parts[i];
    const p = accumulated;

    bc.appendChild(el('span', { className: 'fm-sep', textContent: ' ' + _sep + ' ' }));

    if (i === parts.length - 1) {
      bc.appendChild(el('span', { className: 'fm-crumb current', textContent: parts[i] }));
    } else {
      bc.appendChild(el('span', {
        className: 'fm-crumb clickable',
        textContent: parts[i],
        onClick: () => { _fmCurrentPath = p; loadDirectory(p, container); },
      }));
    }
  }
  return bc;
}

async function loadDirectory(dirPath, container) {
  const fileArea = document.getElementById('fm-file-area');
  if (!fileArea) return;

  fileArea.innerHTML = '';
  fileArea.appendChild(el('div', { className: 'empty-state', innerHTML: '<p>Carregando...</p>' }));

  try {
    const data = await API.listFiles(dirPath);
    _fmCurrentPath = data.path;

    const oldBc = container.querySelector('.fm-breadcrumbs');
    if (oldBc) oldBc.replaceWith(renderBreadcrumbs(data.path, container));

    fileArea.innerHTML = '';

    if (data.items.length === 0 && !data.parent) {
      fileArea.appendChild(el('div', { className: 'empty-state', innerHTML: '<p>Pasta vazia</p>' }));
      return;
    }

    const table = el('div', { className: 'fm-table' });

    table.appendChild(el('div', { className: 'fm-row fm-header' }, [
      el('div', { className: 'fm-cell fm-name', textContent: 'Nome' }),
      el('div', { className: 'fm-cell fm-size', textContent: 'Tamanho' }),
      el('div', { className: 'fm-cell fm-perms', textContent: 'Perm.' }),
      el('div', { className: 'fm-cell fm-date', textContent: 'Modificado' }),
      el('div', { className: 'fm-cell fm-actions', textContent: '' }),
    ]));

    if (data.parent) {
      table.appendChild(el('div', {
        className: 'fm-row fm-parent',
        onClick: () => { _fmCurrentPath = data.parent; loadDirectory(data.parent, container); },
      }, [
        el('div', { className: 'fm-cell fm-name' }, [
          el('span', { className: 'fm-icon', textContent: '⬆' }),
          el('span', { textContent: '..' }),
        ]),
        el('div', { className: 'fm-cell fm-size' }),
        el('div', { className: 'fm-cell fm-perms' }),
        el('div', { className: 'fm-cell fm-date' }),
        el('div', { className: 'fm-cell fm-actions' }),
      ]));
    }

    for (const item of data.items) {
      const icon = item.isDirectory ? '📁' : getFileIcon(item.name);
      const row = el('div', { className: 'fm-row' });

      const nameCell = el('div', { className: 'fm-cell fm-name' }, [
        el('span', { className: 'fm-icon', textContent: icon }),
      ]);

      if (item.isDirectory) {
        nameCell.appendChild(el('span', {
          className: 'fm-link',
          textContent: item.name,
          onClick: () => { _fmCurrentPath = item.path; loadDirectory(item.path, container); },
        }));
      } else {
        nameCell.appendChild(el('span', {
          className: 'fm-link',
          textContent: item.name,
          onClick: () => openFileViewer(item.path),
        }));
      }

      row.appendChild(nameCell);
      row.appendChild(el('div', { className: 'fm-cell fm-size', textContent: item.isDirectory ? '-' : formatFileSize(item.size) }));
      row.appendChild(el('div', { className: 'fm-cell fm-perms', textContent: item.permissions }));
      row.appendChild(el('div', { className: 'fm-cell fm-date', textContent: item.modified ? new Date(item.modified).toLocaleString() : '-' }));

      const actionsCell = el('div', { className: 'fm-cell fm-actions' });

      if (!item.isDirectory) {
        actionsCell.appendChild(el('button', {
          className: 'btn btn-sm',
          title: 'Visualizar',
          textContent: '\uD83D\uDC41',
          onClick: (e) => { e.stopPropagation(); openFileViewer(item.path, item.size); },
        }));
        actionsCell.appendChild(el('button', {
          className: 'btn btn-sm',
          textContent: 'Baixar',
          onClick: (e) => {
            e.stopPropagation();
            const a = document.createElement('a');
            a.href = API.getDownloadUrl(item.path);
            a.download = item.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
          },
        }));
      }

      actionsCell.appendChild(el('button', {
        className: 'btn btn-danger btn-sm',
        textContent: 'Excluir',
        onClick: (e) => {
          e.stopPropagation();
          showDeleteFileModal(item, container);
        },
      }));

      row.appendChild(actionsCell);
      table.appendChild(row);
    }

    fileArea.appendChild(table);
  } catch (err) {
    fileArea.innerHTML = '';
    fileArea.appendChild(el('div', { className: 'empty-state', innerHTML: `<p style="color:var(--danger)">Erro: ${err.message}</p>` }));
  }
}

function showCreateDirModal(container) {
  const overlay = el('div', { className: 'modal-overlay' });
  const modal = el('div', { className: 'modal' }, [
    el('div', { className: 'modal-title', textContent: 'Nova Pasta' }),
    el('div', { className: 'form-group' }, [
      el('label', { textContent: 'Nome da pasta' }),
      el('input', { type: 'text', id: 'fm-mkdir-name', placeholder: 'nome-da-pasta' }),
    ]),
    el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' } }, [
      el('span', { textContent: 'Sera criada em: ' }),
      el('code', { textContent: _fmCurrentPath }),
    ]),
    el('div', { className: 'modal-actions' }, [
      el('button', { className: 'btn', textContent: 'Cancelar', onClick: () => overlay.remove() }),
      el('button', {
        className: 'btn btn-primary',
        textContent: 'Criar',
        onClick: async () => {
          const name = document.getElementById('fm-mkdir-name').value.trim();
          if (!name) { showToast('Nome obrigatorio', 'error'); return; }
          if (name.includes('/') || name.includes('\\')) { showToast('Nome invalido', 'error'); return; }
          try {
            const sep = (API.serverEnv && API.serverEnv.sep) || '/';
            await API.createDirectory(_fmCurrentPath + sep + name);
            showToast('Pasta criada!');
            overlay.remove();
            loadDirectory(_fmCurrentPath, container);
          } catch (err) {
            showToast(err.message, 'error');
          }
        },
      }),
    ]),
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  setTimeout(() => document.getElementById('fm-mkdir-name')?.focus(), 100);
}

function showDeleteFileModal(item, container) {
  const overlay = el('div', { className: 'modal-overlay' });
  const typeLabel = item.isDirectory ? 'pasta' : 'arquivo';
  const modal = el('div', { className: 'modal' }, [
    el('div', { className: 'modal-title', textContent: `Excluir ${typeLabel}` }),
    el('p', {
      textContent: `Deseja excluir permanentemente "${item.name}"?${item.isDirectory ? ' Todo o conteudo sera removido.' : ''}`,
      style: { color: 'var(--text-muted)', fontSize: '14px', marginBottom: '16px' },
    }),
    el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', wordBreak: 'break-all' } }, [
      el('code', { textContent: item.path }),
    ]),
    el('div', { className: 'modal-actions' }, [
      el('button', { className: 'btn', textContent: 'Cancelar', onClick: () => overlay.remove() }),
      el('button', {
        className: 'btn btn-danger',
        textContent: 'Excluir',
        onClick: async () => {
          try {
            await API.deleteFile(item.path);
            showToast(`${item.name} excluido!`);
            overlay.remove();
            loadDirectory(_fmCurrentPath, container);
          } catch (err) {
            showToast(err.message, 'error');
          }
        },
      }),
    ]),
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

function triggerFileUpload(container) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = async () => {
    if (input.files.length === 0) return;
    await doUpload(Array.from(input.files), container);
  };
  input.click();
}

async function doUpload(files, container) {
  showToast(`Enviando ${files.length} arquivo(s)...`);
  try {
    const result = await API.uploadFiles(_fmCurrentPath, files);
    showToast(`${result.uploaded.length} arquivo(s) enviado(s)!`);
    loadDirectory(_fmCurrentPath, container);
  } catch (err) {
    showToast('Falha no upload: ' + err.message, 'error');
  }
}

function setupDragDrop(container) {
  const content = document.getElementById('content');
  let dragCounter = 0;

  const handler = (e) => { e.preventDefault(); e.stopPropagation(); };
  content.addEventListener('dragenter', (e) => { handler(e); dragCounter++; content.classList.add('fm-drag-active'); });
  content.addEventListener('dragover', handler);
  content.addEventListener('dragleave', (e) => { handler(e); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; content.classList.remove('fm-drag-active'); } });
  content.addEventListener('drop', async (e) => {
    handler(e);
    dragCounter = 0;
    content.classList.remove('fm-drag-active');
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) await doUpload(files, container);
  });
}

function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp', 'ico'];
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
  const pdfExts = ['pdf'];
  const textExts = [
    'txt', 'md', 'log', 'csv', 'tsv',
    'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
    'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs',
    'html', 'htm', 'css', 'scss', 'less', 'xml', 'svg',
    'json', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg',
    'sh', 'bash', 'zsh', 'fish', 'bat', 'ps1',
    'sql', 'graphql', 'gql',
    'env', 'gitignore', 'dockerignore', 'editorconfig',
    'makefile', 'dockerfile',
    'service', 'timer', 'socket',
    'properties', 'gradle', 'pom',
  ];
  const noExtTextFiles = ['makefile', 'dockerfile', 'gemfile', 'rakefile', 'procfile', 'license', 'readme', 'changelog'];

  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  if (audioExts.includes(ext)) return 'audio';
  if (pdfExts.includes(ext)) return 'pdf';
  if (textExts.includes(ext)) return 'text';
  if (noExtTextFiles.includes(filename.toLowerCase())) return 'text';
  return 'unknown';
}

async function openFileViewer(filePath, fileSize) {
  const fileName = filePath.split('/').pop();
  const fileType = getFileType(fileName);
  const downloadUrl = API.getDownloadUrl(filePath);

  const overlay = el('div', { className: 'fm-editor-overlay' });

  // Header
  const header = el('div', { className: 'fm-editor-header' });
  header.appendChild(el('button', {
    className: 'btn btn-sm',
    innerHTML: '&larr; Voltar',
    onClick: () => overlay.remove(),
  }));
  header.appendChild(el('span', { className: 'fm-editor-title', textContent: filePath }));

  const actionsDiv = el('div', { className: 'fm-editor-actions' });
  const editBtn = el('button', { className: 'btn btn-sm', textContent: 'Editar', style: { display: 'none' } });
  const saveBtn = el('button', { className: 'btn btn-primary btn-sm', textContent: 'Salvar', style: { display: 'none' } });
  const cancelBtn = el('button', { className: 'btn btn-sm', textContent: 'Cancelar', style: { display: 'none' } });
  const downloadBtn = el('button', {
    className: 'btn btn-sm',
    textContent: 'Baixar',
    onClick: () => {
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
  });
  actionsDiv.appendChild(editBtn);
  actionsDiv.appendChild(saveBtn);
  actionsDiv.appendChild(cancelBtn);
  actionsDiv.appendChild(downloadBtn);
  header.appendChild(actionsDiv);
  overlay.appendChild(header);

  // Body
  const body = el('div', { className: 'fm-editor-body' });
  body.appendChild(el('div', { className: 'empty-state', innerHTML: '<p>Carregando...</p>' }));
  overlay.appendChild(body);
  document.body.appendChild(overlay);

  // Close on Escape
  const onKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  let fileContent = '';

  // Render based on file type
  if (fileType === 'image') {
    body.innerHTML = '';
    const img = el('img', {
      src: downloadUrl,
      className: 'fm-preview-image',
      alt: fileName,
    });
    img.onerror = () => {
      body.innerHTML = '';
      body.appendChild(el('div', { className: 'empty-state', innerHTML: '<p style="color:var(--danger)">Erro ao carregar imagem</p>' }));
    };
    body.appendChild(el('div', { className: 'fm-preview-center' }, [img]));

  } else if (fileType === 'video') {
    body.innerHTML = '';
    body.appendChild(el('div', { className: 'fm-preview-center' }, [
      el('video', { src: downloadUrl, controls: 'true', className: 'fm-preview-media', autoplay: 'true' }),
    ]));

  } else if (fileType === 'audio') {
    body.innerHTML = '';
    body.appendChild(el('div', { className: 'fm-preview-center' }, [
      el('audio', { src: downloadUrl, controls: 'true', style: { width: '80%', maxWidth: '500px' } }),
    ]));

  } else if (fileType === 'pdf') {
    body.innerHTML = '';
    body.appendChild(el('iframe', {
      src: downloadUrl,
      className: 'fm-preview-pdf',
    }));

  } else if (fileType === 'text' || (fileType === 'unknown' && fileSize < 500000)) {
    // Text: load content and show code viewer
    try {
      const data = await API.readFile(filePath);
      fileContent = data.content;
      editBtn.style.display = '';
      showTextViewer();
    } catch (err) {
      body.innerHTML = '';
      body.appendChild(el('div', { className: 'empty-state', innerHTML: `<p style="color:var(--danger)">Erro: ${err.message}</p>` }));
    }
  } else {
    // Unknown binary
    body.innerHTML = '';
    body.appendChild(el('div', { className: 'empty-state', innerHTML: `
      <p style="font-size:48px;margin-bottom:12px">📄</p>
      <p><b>${fileName}</b></p>
      <p style="margin-top:8px">${fileSize ? formatFileSize(fileSize) : ''}</p>
      <p style="margin-top:16px;color:var(--text-muted)">Visualizacao nao disponivel para este tipo de arquivo.</p>
    ` }));
  }

  function showTextViewer() {
    body.innerHTML = '';
    editBtn.style.display = '';
    saveBtn.style.display = 'none';
    cancelBtn.style.display = 'none';

    const pre = el('pre', { className: 'fm-code-view' });
    const lineNums = el('div', { className: 'fm-line-numbers' });
    const lines = fileContent.split('\n');
    for (let i = 1; i <= lines.length; i++) {
      lineNums.appendChild(el('div', { textContent: String(i) }));
    }
    pre.appendChild(lineNums);
    pre.appendChild(el('code', { textContent: fileContent }));
    body.appendChild(pre);
  }

  function showTextEditor() {
    body.innerHTML = '';
    editBtn.style.display = 'none';
    saveBtn.style.display = '';
    cancelBtn.style.display = '';

    const textarea = el('textarea', { className: 'fm-code-editor' });
    textarea.value = fileContent;
    body.appendChild(textarea);
    textarea.focus();

    textarea.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        doSave(textarea);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, s) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = s + 2;
      }
    });
  }

  async function doSave(textarea) {
    const content = textarea.value;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';
    try {
      await API.writeFile(filePath, content);
      fileContent = content;
      showToast('Arquivo salvo!');
      showTextViewer();
    } catch (err) {
      showToast('Erro ao salvar: ' + err.message, 'error');
    }
    saveBtn.disabled = false;
    saveBtn.textContent = 'Salvar';
  }

  editBtn.onclick = () => showTextEditor();
  cancelBtn.onclick = () => showTextViewer();
  saveBtn.onclick = () => { const ta = body.querySelector('textarea'); if (ta) doSave(ta); };
}

async function renderFileManagerPage(container, guard) {
  if (!guard) guard = () => true;
  container.innerHTML = '';
  if (!_fmCurrentPath) {
    _fmCurrentPath = (API.serverEnv && API.serverEnv.homeDir) || '/home';
  }

  const header = el('div', { className: 'page-title' }, [
    el('span', { textContent: 'Arquivos' }),
    el('div', { style: { display: 'flex', gap: '8px' } }, [
      el('button', {
        className: 'btn btn-sm',
        textContent: 'Nova Pasta',
        onClick: () => showCreateDirModal(container),
      }),
      el('button', {
        className: 'btn btn-primary btn-sm',
        textContent: 'Upload',
        onClick: () => triggerFileUpload(container),
      }),
    ]),
  ]);
  container.appendChild(header);
  container.appendChild(renderBreadcrumbs(_fmCurrentPath, container));

  const fileArea = el('div', { id: 'fm-file-area' });
  container.appendChild(fileArea);

  setupDragDrop(container);
  await loadDirectory(_fmCurrentPath, container);
}

// ═══════════════════════════════════════════
// GitHub CLI Page
// ═══════════════════════════════════════════

async function renderGitHubCLIPage(container, guard) {
  if (!guard) guard = () => true;
  container.innerHTML = '';
  container.appendChild(el('h2', { textContent: 'GitHub CLI' }));

  const statusCard = el('div', { className: 'card', innerHTML: '<p style="color:var(--text-muted)">Verificando...</p>' });
  container.appendChild(statusCard);

  try {
    const status = await API.getGitHubCLIStatus();
    if (!guard()) return;
    renderGitHubCLIStatus(container, statusCard, status);
  } catch (err) {
    if (!guard()) return;
    statusCard.innerHTML = `<p style="color:var(--danger)">Erro ao verificar: ${err.message}</p>`;
  }
}

function renderGitHubCLIStatus(container, statusCard, status) {
  statusCard.innerHTML = '';

  if (!status.installed) {
    // ─── State 1: Not installed ───
    statusCard.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' } }, [
      el('span', { className: 'status-tag status-crashed', textContent: 'Nao instalado' }),
      el('span', { textContent: 'GitHub CLI nao encontrado neste servidor', style: { color: 'var(--text-muted)', fontSize: '14px' } }),
    ]));

    statusCard.appendChild(el('p', {
      textContent: 'O GitHub CLI (gh) permite clonar repositorios privados e autenticar com sua conta GitHub.',
      style: { fontSize: '14px', marginBottom: '16px' },
    }));

    const installLog = el('pre', {
      className: 'code-block',
      style: { display: 'none', maxHeight: '300px', overflow: 'auto', marginTop: '12px' },
    });

    const installBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Instalar GitHub CLI',
      onClick: async () => {
        installBtn.disabled = true;
        installBtn.textContent = 'Instalando...';
        installLog.style.display = 'block';
        installLog.textContent = '';

        try {
          const result = await API.installGitHubCLI((text) => {
            installLog.textContent += text;
            installLog.scrollTop = installLog.scrollHeight;
          });
          showToast('GitHub CLI instalado!');
          const newStatus = await API.getGitHubCLIStatus();
          renderGitHubCLIStatus(container, statusCard, newStatus);
        } catch (err) {
          showToast('Falha na instalacao: ' + err.message, 'error');
          installBtn.textContent = 'Tentar novamente';
          installBtn.disabled = false;
        }
      },
    });

    statusCard.appendChild(installBtn);
    statusCard.appendChild(installLog);

  } else if (!status.authenticated) {
    // ─── State 2: Installed but not authenticated ───
    statusCard.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' } }, [
      el('span', { className: 'status-tag status-stopped', textContent: 'Nao autenticado' }),
      el('span', { textContent: `gh v${status.version} instalado`, style: { color: 'var(--text-muted)', fontSize: '14px' } }),
    ]));

    statusCard.appendChild(el('p', {
      textContent: 'O GitHub CLI esta instalado. Clique abaixo para abrir o terminal de autenticacao interativo.',
      style: { fontSize: '14px', marginBottom: '16px' },
    }));

    const authBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Autenticar com GitHub',
      onClick: async () => {
        authBtn.disabled = true;
        authBtn.textContent = 'Abrindo terminal...';
        try {
          const result = await API.startGitHubCLIAuth();
          // Open the terminal overlay with this interactive session
          getViewManager().open(result.sessionId);
          document.getElementById('terminal-title').textContent = 'gh auth login';

          // When terminal exits, check auth status and refresh page
          const onExit = (msg) => {
            if (msg.sessionId === result.sessionId) {
              API.off('terminal:exit', onExit);
              setTimeout(async () => {
                const newStatus = await API.getGitHubCLIStatus();
                if (newStatus.authenticated) {
                  showToast('Autenticado como @' + newStatus.user + '!');
                }
                // Re-render page when user comes back
                renderGitHubCLIStatus(container, statusCard, newStatus);
              }, 500);
            }
          };
          API.on('terminal:exit', onExit);
        } catch (err) {
          showToast('Erro: ' + err.message, 'error');
        }
        authBtn.textContent = 'Autenticar com GitHub';
        authBtn.disabled = false;
      },
    });

    statusCard.appendChild(authBtn);

    statusCard.appendChild(el('button', {
      className: 'btn',
      textContent: 'Verificar Autenticacao',
      style: { marginLeft: '8px' },
      onClick: async () => {
        try {
          const newStatus = await API.getGitHubCLIStatus();
          if (newStatus.authenticated) {
            showToast('Autenticado com sucesso!');
          } else {
            showToast('Ainda nao autenticado.', 'error');
          }
          renderGitHubCLIStatus(container, statusCard, newStatus);
        } catch (err) {
          showToast(err.message, 'error');
        }
      },
    }));

  } else {
    // ─── State 3: Installed and authenticated ───
    statusCard.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' } }, [
      el('span', { className: 'status-tag status-completed', textContent: 'Conectado' }),
      el('span', { textContent: `gh v${status.version} — @${status.user}`, style: { color: 'var(--text-muted)', fontSize: '14px' } }),
    ]));

    // Clone repo section
    const cloneSection = el('div', { style: { marginTop: '8px' } });

    cloneSection.appendChild(el('h3', { textContent: 'Clonar Repositorio', style: { fontSize: '16px', marginBottom: '12px' } }));

    // ─── Repo selector with search ───
    let _allRepos = [];
    let _selectedRepo = '';
    let _reposLoaded = false;
    let _reposLoading = false;

    // Extract repo name from URL or owner/repo format
    function extractRepoName(input) {
      return input.split('/').pop().replace(/\.git$/, '') || input;
    }

    // Build paths based on server OS
    const _env = API.serverEnv || {};
    const _sep = _env.sep || '/';
    const _home = _env.homeDir || '/root';
    function _joinPath(base, name) { return base + _sep + name; }

    const repoInput = el('input', {
      type: 'text',
      placeholder: 'Buscar, digitar owner/repo ou colar URL do GitHub...',
      style: { marginBottom: '0' },
    });

    const repoDropdown = el('div', {
      style: {
        maxHeight: '220px', overflowY: 'auto', display: 'none',
        border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 8px 8px',
        background: 'var(--surface0)',
      },
    });

    async function loadRepos() {
      if (_reposLoaded || _reposLoading) return;
      _reposLoading = true;
      repoDropdown.innerHTML = '';
      repoDropdown.appendChild(el('div', {
        textContent: 'Carregando repos...',
        style: { padding: '10px 12px', color: 'var(--text-muted)', fontSize: '13px' },
      }));
      repoDropdown.style.display = 'block';

      try {
        console.log('[GitHub CLI] Fetching repos...');
        const data = await API.listGitHubCLIRepos();
        console.log('[GitHub CLI] Got', (data.repos || []).length, 'repos');
        _allRepos = (data.repos || []).sort((a, b) =>
          new Date(b.updatedAt) - new Date(a.updatedAt)
        );
        _reposLoaded = true;
        renderRepoList(repoInput.value);
      } catch (err) {
        console.error('[GitHub CLI] Error loading repos:', err);
        repoDropdown.innerHTML = '';
        repoDropdown.appendChild(el('div', {
          style: { padding: '10px 12px' },
        }, [
          el('div', { textContent: 'Erro: ' + err.message, style: { color: 'var(--danger)', fontSize: '13px', marginBottom: '8px' } }),
          el('button', {
            className: 'btn btn-sm',
            textContent: 'Tentar novamente',
            style: { fontSize: '11px', padding: '2px 8px' },
            onClick: (e) => { e.stopPropagation(); _reposLoading = false; loadRepos(); },
          }),
        ]));
      } finally {
        _reposLoading = false;
      }
    }

    function renderRepoList(filter) {
      repoDropdown.innerHTML = '';
      const query = (filter || '').toLowerCase();
      const filtered = _allRepos.filter(r =>
        r.nameWithOwner.toLowerCase().includes(query) ||
        (r.description || '').toLowerCase().includes(query)
      );

      if (filtered.length === 0) {
        repoDropdown.appendChild(el('div', {
          textContent: query ? 'Nenhum repo encontrado' : 'Nenhum repositorio',
          style: { padding: '10px 12px', color: 'var(--text-muted)', fontSize: '13px' },
        }));
        repoDropdown.style.display = 'block';
        return;
      }

      for (const r of filtered) {
        const repoName = r.nameWithOwner.split('/').pop();
        const item = el('div', {
          style: {
            padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
            borderBottom: '1px solid var(--border)',
          },
        }, [
          el('span', {
            textContent: r.isPrivate ? '🔒' : '📂',
            style: { fontSize: '14px', flexShrink: '0' },
          }),
          el('div', { style: { flex: '1', minWidth: '0' } }, [
            el('div', {
              textContent: r.nameWithOwner,
              style: { fontSize: '13px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
            }),
            ...(r.description ? [el('div', {
              textContent: r.description,
              style: { fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
            })] : []),
          ]),
        ]);

        item.addEventListener('mouseenter', () => { item.style.background = 'var(--surface1)'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('click', () => {
          _selectedRepo = r.nameWithOwner;
          repoInput.value = r.nameWithOwner;
          repoDropdown.style.display = 'none';
          // Auto-fill destination directory
          if (!destInput.value.trim()) {
            destInput.value = _joinPath(_home, repoName);
          }
        });

        repoDropdown.appendChild(item);
      }
      repoDropdown.style.display = 'block';
    }

    repoInput.addEventListener('focus', () => {
      if (!_reposLoaded) { loadRepos(); return; }
      renderRepoList(repoInput.value);
    });
    repoInput.addEventListener('input', () => {
      _selectedRepo = '';
      const val = repoInput.value.trim();
      // If user pasted a full URL, auto-fill dest and close dropdown
      if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('git@')) {
        repoDropdown.style.display = 'none';
        if (!destInput.value.trim()) {
          destInput.value = _joinPath(_home, extractRepoName(val));
        }
        return;
      }
      if (_reposLoaded) renderRepoList(val);
    });
    document.addEventListener('click', (e) => {
      if (!repoInput.contains(e.target) && !repoDropdown.contains(e.target)) {
        repoDropdown.style.display = 'none';
      }
    });

    // ─── Destination directory with quick-pick buttons ───
    const destInput = el('input', {
      type: 'text',
      placeholder: `Diretorio destino (ex: ${_joinPath(_home, 'repo')})`,
      style: { marginBottom: '4px' },
    });

    const destShortcuts = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' } });

    const basePaths = _env.platform === 'win32' ? [
      { label: 'Documents', path: _joinPath(_home, 'Documents') },
      { label: 'Desktop', path: _joinPath(_home, 'Desktop') },
      { label: 'Projetos', path: _joinPath(_home, 'projetos') },
    ] : [
      { label: 'Home', path: _home },
      { label: '/opt', path: '/opt' },
      { label: '/srv', path: '/srv' },
    ];

    for (const bp of basePaths) {
      destShortcuts.appendChild(el('button', {
        className: 'btn btn-sm',
        textContent: bp.label,
        style: { fontSize: '11px', padding: '2px 8px', color: 'var(--text-muted)' },
        onClick: () => {
          const repo = _selectedRepo || repoInput.value.trim();
          const repoName = repo ? extractRepoName(repo) : '';
          destInput.value = repoName ? _joinPath(bp.path, repoName) : bp.path;
        },
      }));
    }

    const cloneResult = el('div', { style: { marginTop: '12px' } });

    const cloneBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Clonar',
      onClick: async () => {
        const repo = _selectedRepo || repoInput.value.trim();
        if (!repo) { showToast('Selecione ou informe o repositorio', 'error'); return; }

        cloneBtn.disabled = true;
        cloneBtn.textContent = 'Clonando...';
        cloneResult.innerHTML = '';

        try {
          const result = await API.cloneWithGitHubCLI(repo, destInput.value.trim() || undefined);
          showToast(`Repositorio ${result.action === 'pull' ? 'atualizado' : 'clonado'}!`);
          cloneResult.appendChild(el('div', {
            className: 'card',
            style: { background: 'var(--surface1)', marginTop: '8px' },
          }, [
            el('p', { innerHTML: `<b>${result.action === 'pull' ? 'Pull' : 'Clone'}</b> concluido`, style: { color: 'var(--success)' } }),
            el('p', { textContent: `Path: ${result.path}`, style: { fontSize: '13px', color: 'var(--text-muted)' } }),
          ]));
        } catch (err) {
          showToast('Falha: ' + err.message, 'error');
          cloneResult.appendChild(el('p', { textContent: err.message, style: { color: 'var(--danger)', fontSize: '13px' } }));
        }

        cloneBtn.textContent = 'Clonar';
        cloneBtn.disabled = false;
      },
    });

    const repoGroup = el('div', { className: 'form-group', style: { position: 'relative' } }, [
      el('label', { textContent: 'Repositorio' }),
      repoInput,
      repoDropdown,
    ]);

    cloneSection.appendChild(repoGroup);
    cloneSection.appendChild(el('div', { className: 'form-group' }, [
      el('label', { textContent: 'Diretorio destino (opcional)' }),
      destInput,
      destShortcuts,
    ]));
    cloneSection.appendChild(cloneBtn);
    cloneSection.appendChild(cloneResult);

    statusCard.appendChild(cloneSection);
  }
}

// Helper: render a step in the CLI setup wizard
function renderCLIStep(number, title, content) {
  return el('div', { className: 'cli-step', style: { display: 'flex', gap: '12px', marginBottom: '16px' } }, [
    el('div', {
      textContent: number,
      style: {
        minWidth: '28px', height: '28px', borderRadius: '50%', background: 'var(--accent)',
        color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 'bold', fontSize: '14px', flexShrink: '0',
      },
    }),
    el('div', { style: { flex: '1' } }, [
      el('div', { textContent: title, style: { fontWeight: '600', marginBottom: '6px', fontSize: '14px' } }),
      content,
    ]),
  ]);
}

// Helper: render a copyable code block
function renderCopyBlock(text) {
  const block = el('div', {
    className: 'copy-block',
    style: {
      display: 'flex', alignItems: 'center', gap: '8px',
      background: 'var(--surface1)', borderRadius: '6px', padding: '8px 12px',
      fontFamily: 'monospace', fontSize: '13px',
    },
  }, [
    el('code', { textContent: text, style: { flex: '1' } }),
    el('button', {
      className: 'btn btn-sm',
      textContent: 'Copiar',
      style: { fontSize: '11px', padding: '2px 8px' },
      onClick: () => {
        navigator.clipboard.writeText(text);
        showToast('Copiado!');
      },
    }),
  ]);
  return block;
}

// ─── Cline CLI Page ───

async function renderClineCliPage(container, guard) {
  if (!guard) guard = () => true;
  container.innerHTML = '';
  container.appendChild(el('h2', { textContent: 'Cline CLI' }));

  const statusCard = el('div', {
    className: 'card',
    innerHTML: '<p style="color:var(--text-muted)">Verificando...</p>',
  });
  container.appendChild(statusCard);

  try {
    const status = await API.getClineCLIStatus();
    if (!guard()) return;
    renderClineCliStatus(container, statusCard, status);
  } catch (err) {
    if (!guard()) return;
    statusCard.innerHTML = `<p style="color:var(--danger)">Erro ao verificar: ${err.message}</p>`;
  }
}

function renderClineCliStatus(container, statusCard, status) {
  statusCard.innerHTML = '';

  if (!status.installed) {
    // ─── State 1: Not installed ───
    statusCard.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' } }, [
      el('span', { className: 'status-tag status-crashed', textContent: 'Nao instalado' }),
      el('span', { textContent: 'Cline CLI nao encontrado neste servidor', style: { color: 'var(--text-muted)', fontSize: '14px' } }),
    ]));

    statusCard.appendChild(el('p', {
      textContent: 'Cline e uma ferramenta CLI para assistencia de codigo com IA. Requer Node.js 20+. Instale via npm:',
      style: { fontSize: '14px', marginBottom: '12px' },
    }));

    statusCard.appendChild(renderCopyBlock('npm install -g cline'));

    const installLog = el('pre', {
      className: 'code-block',
      style: { display: 'none', maxHeight: '300px', overflow: 'auto', marginTop: '12px' },
    });

    const installBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Instalar Cline CLI',
      style: { marginTop: '12px' },
      onClick: async () => {
        installBtn.disabled = true;
        installBtn.textContent = 'Instalando...';
        installLog.style.display = 'block';
        installLog.textContent = '';

        try {
          await API.installClineCLI((text) => {
            installLog.textContent += text;
            installLog.scrollTop = installLog.scrollHeight;
          });
          showToast('Cline CLI instalado!');
          const newStatus = await API.getClineCLIStatus();
          renderClineCliStatus(container, statusCard, newStatus);
        } catch (err) {
          showToast('Falha na instalacao: ' + err.message, 'error');
          installBtn.textContent = 'Tentar novamente';
          installBtn.disabled = false;
        }
      },
    });

    statusCard.appendChild(installBtn);
    statusCard.appendChild(installLog);

  } else if (!status.configured) {
    // ─── State 2: Installed but not configured ───
    statusCard.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' } }, [
      el('span', { className: 'status-tag status-stopped', textContent: 'Nao configurado' }),
      el('span', { textContent: `Cline v${status.version} instalado`, style: { color: 'var(--text-muted)', fontSize: '14px' } }),
    ]));

    statusCard.appendChild(el('p', {
      textContent: 'Cline esta instalado. Configure a autenticacao (provider + API key) para comecar.',
      style: { fontSize: '14px', marginBottom: '16px' },
    }));

    const authBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Configurar Autenticacao',
      onClick: async () => {
        authBtn.disabled = true;
        authBtn.textContent = 'Abrindo terminal...';
        try {
          const result = await API.startClineCLIAuth();
          getViewManager().open(result.sessionId);
          document.getElementById('terminal-title').textContent = 'cline auth';

          const onExit = (msg) => {
            if (msg.sessionId === result.sessionId) {
              API.off('terminal:exit', onExit);
              setTimeout(async () => {
                const newStatus = await API.getClineCLIStatus();
                if (newStatus.configured) {
                  showToast('Cline configurado com sucesso!');
                }
                renderClineCliStatus(container, statusCard, newStatus);
              }, 500);
            }
          };
          API.on('terminal:exit', onExit);
        } catch (err) {
          showToast('Erro: ' + err.message, 'error');
        }
        authBtn.textContent = 'Configurar Autenticacao';
        authBtn.disabled = false;
      },
    });

    statusCard.appendChild(authBtn);

    statusCard.appendChild(el('button', {
      className: 'btn',
      textContent: 'Verificar Configuracao',
      style: { marginLeft: '8px' },
      onClick: async () => {
        try {
          const newStatus = await API.getClineCLIStatus();
          if (newStatus.configured) {
            showToast('Cline configurado!');
          } else {
            showToast('Cline ainda nao configurado.', 'error');
          }
          renderClineCliStatus(container, statusCard, newStatus);
        } catch (err) {
          showToast(err.message, 'error');
        }
      },
    }));

  } else {
    // ─── State 3: Ready ───
    statusCard.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' } }, [
      el('span', { className: 'status-tag status-completed', textContent: 'Pronto' }),
      el('span', {
        textContent: `Cline v${status.version}${status.provider && status.provider !== 'configured' ? ' — ' + status.provider : ''}`,
        style: { color: 'var(--text-muted)', fontSize: '14px' },
      }),
      el('button', {
        className: 'btn btn-sm',
        textContent: 'Reconfigurar',
        style: { marginLeft: 'auto', fontSize: '11px' },
        onClick: async () => {
          try {
            const result = await API.startClineCLIAuth();
            getViewManager().open(result.sessionId);
            document.getElementById('terminal-title').textContent = 'cline auth';
            const onExit = (msg) => {
              if (msg.sessionId === result.sessionId) {
                API.off('terminal:exit', onExit);
                setTimeout(async () => {
                  const newStatus = await API.getClineCLIStatus();
                  renderClineCliStatus(container, statusCard, newStatus);
                }, 500);
              }
            };
            API.on('terminal:exit', onExit);
          } catch (err) {
            showToast('Erro: ' + err.message, 'error');
          }
        },
      }),
    ]));

    // ─── New Session Button + Collapsible Form ───
    const _env = API.serverEnv || {};
    const _sep = _env.sep || '/';
    const _home = _env.homeDir || '/root';
    function _joinPath(base, name) { return base + _sep + name; }

    const launchForm = el('div', { style: { display: 'none', marginTop: '12px' } });

    const cwdInput = el('input', {
      type: 'text',
      placeholder: `Diretorio de trabalho (padrao: ${_home})`,
      value: _home,
    });

    const cwdShortcuts = el('div', {
      style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' },
    });

    const basePaths = _env.platform === 'win32' ? [
      { label: 'Home', path: _home },
      { label: 'Documents', path: _joinPath(_home, 'Documents') },
      { label: 'Desktop', path: _joinPath(_home, 'Desktop') },
    ] : [
      { label: 'Home', path: _home },
      { label: '/opt', path: '/opt' },
      { label: '/srv', path: '/srv' },
    ];

    for (const bp of basePaths) {
      cwdShortcuts.appendChild(el('button', {
        className: 'btn btn-sm',
        textContent: bp.label,
        style: { fontSize: '11px', padding: '2px 8px', color: 'var(--text-muted)' },
        onClick: () => { cwdInput.value = bp.path; },
      }));
    }

    const promptInput = el('textarea', {
      placeholder: 'Prompt inicial (opcional)',
      style: { minHeight: '50px', resize: 'vertical' },
    });

    function launchCline(prompt) {
      return async () => {
        const btn = prompt ? launchWithPromptBtn : launchInteractiveBtn;
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Iniciando...';
        try {
          const p = prompt ? promptInput.value.trim() : null;
          if (prompt && !p) { showToast('Digite um prompt', 'error'); btn.disabled = false; btn.textContent = origText; return; }
          const session = await API.launchClineSession(p, cwdInput.value.trim() || undefined);
          showToast('Sessao Cline iniciada!');
          launchForm.style.display = 'none';
          newSessionBtn.style.display = '';
          getViewManager().open(session.id);
          document.getElementById('terminal-title').textContent = `Cline — ${session.id.slice(0, 8)}`;
          const onExit = (msg) => {
            if (msg.sessionId === session.id) {
              API.off('terminal:exit', onExit);
              renderClineCliStatus(container, statusCard, status);
            }
          };
          API.on('terminal:exit', onExit);
        } catch (err) {
          showToast('Erro: ' + err.message, 'error');
        }
        btn.textContent = origText;
        btn.disabled = false;
      };
    }

    const launchInteractiveBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Iniciar Interativa',
      onClick: launchCline(false),
    });

    const launchWithPromptBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Iniciar com Prompt',
      onClick: launchCline(true),
    });

    const cancelBtn = el('button', {
      className: 'btn btn-sm',
      textContent: 'Cancelar',
      onClick: () => { launchForm.style.display = 'none'; newSessionBtn.style.display = ''; },
    });

    launchForm.appendChild(el('div', { className: 'form-group' }, [
      el('label', { textContent: 'Diretorio de Trabalho' }),
      cwdInput,
      cwdShortcuts,
    ]));

    launchForm.appendChild(el('div', { className: 'form-group' }, [
      el('label', { textContent: 'Prompt Inicial (opcional)' }),
      promptInput,
    ]));

    launchForm.appendChild(el('div', {
      style: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
    }, [launchInteractiveBtn, launchWithPromptBtn, cancelBtn]));

    const newSessionBtn = el('button', {
      className: 'btn btn-primary',
      textContent: '+ Nova Sessao',
      onClick: () => {
        newSessionBtn.style.display = 'none';
        launchForm.style.display = '';
      },
    });

    statusCard.appendChild(newSessionBtn);
    statusCard.appendChild(launchForm);

    // ─── Active Cline Sessions ───
    const activeSection = el('div', { style: { marginTop: '24px' } });
    statusCard.appendChild(activeSection);
    renderClineActiveSessions(activeSection, container, statusCard, status);

    // ─── Session History ───
    const historySection = el('div', { style: { marginTop: '24px' } });
    statusCard.appendChild(historySection);
    renderClineSessionHistory(historySection);
  }
}

async function renderClineActiveSessions(section, container, statusCard, status) {
  section.innerHTML = '';
  section.appendChild(el('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  }, [
    el('h3', { textContent: 'Sessoes Ativas', style: { fontSize: '16px', margin: '0' } }),
    el('button', {
      className: 'btn btn-sm',
      textContent: 'Atualizar',
      onClick: () => renderClineActiveSessions(section, container, statusCard, status),
    }),
  ]));

  try {
    const sessions = await API.getActiveClineSessions();
    if (sessions.length === 0) {
      section.appendChild(el('p', {
        textContent: 'Nenhuma sessao ativa.',
        style: { color: 'var(--text-muted)', fontSize: '13px' },
      }));
      return;
    }

    for (const s of sessions) {
      const elapsed = formatDuration(s.elapsedSeconds);
      const card = el('div', {
        style: {
          background: 'var(--surface1)', borderRadius: '8px', padding: '12px 16px', marginBottom: '8px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        },
      }, [
        el('div', {}, [
          el('span', {
            textContent: `Sessao ${s.id.slice(0, 8)}`,
            style: { fontWeight: '600', fontSize: '14px' },
          }),
          el('span', {
            textContent: ` — PID ${s.pid} — ${elapsed}`,
            style: { color: 'var(--text-muted)', fontSize: '12px', marginLeft: '8px' },
          }),
          ...(s.prompt ? [el('div', {
            textContent: s.prompt.length > 80 ? s.prompt.slice(0, 80) + '...' : s.prompt,
            style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' },
          })] : []),
        ]),
        el('div', { style: { display: 'flex', gap: '8px' } }, [
          el('button', {
            className: 'btn btn-primary btn-sm',
            textContent: 'Abrir Terminal',
            onClick: () => {
              getViewManager().open(s.id);
              document.getElementById('terminal-title').textContent = `Cline — ${s.id.slice(0, 8)}`;
            },
          }),
          el('button', {
            className: 'btn btn-danger btn-sm',
            textContent: 'Parar',
            onClick: async () => {
              try {
                await API.stopClineSession(s.id);
                showToast('Sessao parada');
                renderClineActiveSessions(section, container, statusCard, status);
              } catch (err) {
                showToast(err.message, 'error');
              }
            },
          }),
        ]),
      ]);
      section.appendChild(card);
    }
  } catch (err) {
    section.appendChild(el('p', {
      textContent: 'Erro: ' + err.message,
      style: { color: 'var(--danger)', fontSize: '13px' },
    }));
  }
}

async function renderClineSessionHistory(section) {
  section.innerHTML = '';
  section.appendChild(el('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  }, [
    el('h3', { textContent: 'Historico', style: { fontSize: '16px', margin: '0' } }),
    el('div', { style: { display: 'flex', gap: '8px' } }, [
      el('button', {
        className: 'btn btn-sm',
        textContent: 'Atualizar',
        onClick: () => renderClineSessionHistory(section),
      }),
      el('button', {
        className: 'btn btn-danger btn-sm',
        textContent: 'Limpar',
        onClick: async () => {
          if (!confirm('Limpar historico de sessoes Cline?')) return;
          try {
            await API.clearClineHistory();
            showToast('Historico limpo');
            renderClineSessionHistory(section);
          } catch (err) {
            showToast(err.message, 'error');
          }
        },
      }),
    ]),
  ]));

  try {
    const sessions = await API.getClineSessionHistory();
    const history = sessions
      .filter(s => s.status !== 'running')
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    if (history.length === 0) {
      section.appendChild(el('p', {
        textContent: 'Nenhuma sessao no historico.',
        style: { color: 'var(--text-muted)', fontSize: '13px' },
      }));
      return;
    }

    const tableContainer = el('div', { className: 'table-container' });
    const table = el('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Sessao</th>
          <th>Prompt</th>
          <th>Status</th>
          <th>Inicio</th>
          <th>Duracao</th>
          <th>Acoes</th>
        </tr>
      </thead>
    `;

    const tbody = el('tbody');
    for (const s of history) {
      const tr = el('tr');
      const statusClass = s.status || 'stopped';

      tr.appendChild(el('td', { textContent: s.id.slice(0, 8) }));
      tr.appendChild(el('td', {
        textContent: s.prompt ? (s.prompt.length > 40 ? s.prompt.slice(0, 40) + '...' : s.prompt) : '(interativo)',
        style: { color: s.prompt ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: s.prompt ? 'normal' : 'italic' },
      }));
      const tdStatus = el('td');
      tdStatus.innerHTML = `<span class="status-tag ${statusClass}">${s.status || '-'}</span>`;
      tr.appendChild(tdStatus);
      tr.appendChild(el('td', { textContent: new Date(s.startedAt).toLocaleString() }));
      tr.appendChild(el('td', { textContent: s.durationSeconds ? formatDuration(s.durationSeconds) : '-' }));

      const tdActions = el('td', { className: 'history-actions' });
      tdActions.appendChild(el('button', {
        className: 'btn btn-sm',
        textContent: 'Output',
        onClick: async () => {
          try {
            const { output } = await API.getClineSessionOutput(s.id);
            getViewManager().openReadOnly(
              `Cline — ${s.id.slice(0, 8)} (historico)`,
              output,
            );
          } catch (err) {
            showToast(err.message, 'error');
          }
        },
      }));
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    section.appendChild(tableContainer);
  } catch (err) {
    section.appendChild(el('p', {
      textContent: 'Erro: ' + err.message,
      style: { color: 'var(--danger)', fontSize: '13px' },
    }));
  }
}

// ═══════════════════════════════════════════
// Gemini CLI Page
// ═══════════════════════════════════════════

async function renderGeminiCliPage(container, guard) {
  if (!guard) guard = () => true;
  container.innerHTML = '';
  container.appendChild(el('h2', { textContent: 'Gemini CLI' }));

  const statusCard = el('div', {
    className: 'card',
    innerHTML: '<p style="color:var(--text-muted)">Verificando...</p>',
  });
  container.appendChild(statusCard);

  try {
    const status = await API.getGeminiCLIStatus();
    if (!guard()) return;
    renderGeminiCliStatus(container, statusCard, status);
  } catch (err) {
    if (!guard()) return;
    statusCard.innerHTML = `<p style="color:var(--danger)">Erro ao verificar: ${err.message}</p>`;
  }
}

function renderGeminiCliStatus(container, statusCard, status) {
  statusCard.innerHTML = '';

  if (!status.installed) {
    // ─── State 1: Not installed ───
    statusCard.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' } }, [
      el('span', { className: 'status-tag status-crashed', textContent: 'Nao instalado' }),
      el('span', { textContent: 'Gemini CLI nao encontrado neste servidor', style: { color: 'var(--text-muted)', fontSize: '14px' } }),
    ]));

    statusCard.appendChild(el('p', {
      textContent: 'Gemini CLI e a ferramenta de linha de comando do Google para IA. Requer Node.js 18+. Instale via npm:',
      style: { fontSize: '14px', marginBottom: '12px' },
    }));

    statusCard.appendChild(renderCopyBlock('npm install -g @google/gemini-cli'));

    const installLog = el('pre', {
      className: 'code-block',
      style: { display: 'none', maxHeight: '300px', overflow: 'auto', marginTop: '12px' },
    });

    const installBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Instalar Gemini CLI',
      style: { marginTop: '12px' },
      onClick: async () => {
        installBtn.disabled = true;
        installBtn.textContent = 'Instalando...';
        installLog.style.display = 'block';
        installLog.textContent = '';

        try {
          await API.installGeminiCLI((text) => {
            installLog.textContent += text;
            installLog.scrollTop = installLog.scrollHeight;
          });
          showToast('Gemini CLI instalado!');
          const newStatus = await API.getGeminiCLIStatus();
          renderGeminiCliStatus(container, statusCard, newStatus);
        } catch (err) {
          showToast('Falha na instalacao: ' + err.message, 'error');
          installBtn.textContent = 'Tentar novamente';
          installBtn.disabled = false;
        }
      },
    });

    statusCard.appendChild(installBtn);
    statusCard.appendChild(installLog);

  } else {
    // ─── State 2: Installed (Ready) ───
    statusCard.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' } }, [
      el('span', { className: 'status-tag status-completed', textContent: 'Instalado' }),
      el('span', {
        textContent: `Gemini CLI v${status.version || '?'}`,
        style: { color: 'var(--text-muted)', fontSize: '14px' },
      }),
    ]));

    statusCard.appendChild(el('p', {
      textContent: 'Na primeira sessao interativa, o Gemini pedira autenticacao via Google OAuth.',
      style: { fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' },
    }));

    // ─── New Session Button + Collapsible Form ───
    const _env = API.serverEnv || {};
    const _sep = _env.sep || '/';
    const _home = _env.homeDir || '/root';
    function _joinPath(base, name) { return base + _sep + name; }

    const launchForm = el('div', { style: { display: 'none', marginTop: '12px' } });

    const cwdInput = el('input', {
      type: 'text',
      placeholder: `Diretorio de trabalho (padrao: ${_home})`,
      value: _home,
    });

    const cwdShortcuts = el('div', {
      style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' },
    });

    const basePaths = _env.platform === 'win32' ? [
      { label: 'Home', path: _home },
      { label: 'Documents', path: _joinPath(_home, 'Documents') },
      { label: 'Desktop', path: _joinPath(_home, 'Desktop') },
    ] : [
      { label: 'Home', path: _home },
      { label: '/opt', path: '/opt' },
      { label: '/srv', path: '/srv' },
    ];

    for (const bp of basePaths) {
      cwdShortcuts.appendChild(el('button', {
        className: 'btn btn-sm',
        textContent: bp.label,
        style: { fontSize: '11px', padding: '2px 8px', color: 'var(--text-muted)' },
        onClick: () => { cwdInput.value = bp.path; },
      }));
    }

    const promptInput = el('textarea', {
      placeholder: 'Prompt inicial (opcional)',
      style: { minHeight: '50px', resize: 'vertical' },
    });

    function launchGemini(withPrompt) {
      return async () => {
        const btn = withPrompt ? launchWithPromptBtn : launchInteractiveBtn;
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Iniciando...';
        try {
          const p = withPrompt ? promptInput.value.trim() : null;
          if (withPrompt && !p) { showToast('Digite um prompt', 'error'); btn.disabled = false; btn.textContent = origText; return; }
          const session = await API.launchGeminiSession(p, cwdInput.value.trim() || undefined);
          showToast('Sessao Gemini iniciada!');
          launchForm.style.display = 'none';
          newSessionBtn.style.display = '';
          getViewManager().open(session.id);
          document.getElementById('terminal-title').textContent = `Gemini — ${session.id.slice(0, 8)}`;
          const onExit = (msg) => {
            if (msg.sessionId === session.id) {
              API.off('terminal:exit', onExit);
              renderGeminiCliStatus(container, statusCard, status);
            }
          };
          API.on('terminal:exit', onExit);
        } catch (err) {
          showToast('Erro: ' + err.message, 'error');
        }
        btn.textContent = origText;
        btn.disabled = false;
      };
    }

    const launchInteractiveBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Iniciar Interativa',
      onClick: launchGemini(false),
    });

    const launchWithPromptBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Iniciar com Prompt',
      onClick: launchGemini(true),
    });

    const cancelBtn = el('button', {
      className: 'btn btn-sm',
      textContent: 'Cancelar',
      onClick: () => { launchForm.style.display = 'none'; newSessionBtn.style.display = ''; },
    });

    launchForm.appendChild(el('div', { className: 'form-group' }, [
      el('label', { textContent: 'Diretorio de Trabalho' }),
      cwdInput,
      cwdShortcuts,
    ]));

    launchForm.appendChild(el('div', { className: 'form-group' }, [
      el('label', { textContent: 'Prompt Inicial (opcional)' }),
      promptInput,
    ]));

    launchForm.appendChild(el('div', {
      style: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
    }, [launchInteractiveBtn, launchWithPromptBtn, cancelBtn]));

    const newSessionBtn = el('button', {
      className: 'btn btn-primary',
      textContent: '+ Nova Sessao',
      onClick: () => {
        newSessionBtn.style.display = 'none';
        launchForm.style.display = '';
      },
    });

    statusCard.appendChild(newSessionBtn);
    statusCard.appendChild(launchForm);

    // ─── Active Gemini Sessions ───
    const activeSection = el('div', { style: { marginTop: '24px' } });
    statusCard.appendChild(activeSection);
    renderGeminiActiveSessions(activeSection, container, statusCard, status);

    // ─── Session History ───
    const historySection = el('div', { style: { marginTop: '24px' } });
    statusCard.appendChild(historySection);
    renderGeminiSessionHistory(historySection);
  }
}

async function renderGeminiActiveSessions(section, container, statusCard, status) {
  section.innerHTML = '';
  section.appendChild(el('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  }, [
    el('h3', { textContent: 'Sessoes Ativas', style: { fontSize: '16px', margin: '0' } }),
    el('button', {
      className: 'btn btn-sm',
      textContent: 'Atualizar',
      onClick: () => renderGeminiActiveSessions(section, container, statusCard, status),
    }),
  ]));

  try {
    const sessions = await API.getActiveGeminiSessions();
    if (sessions.length === 0) {
      section.appendChild(el('p', {
        textContent: 'Nenhuma sessao ativa.',
        style: { color: 'var(--text-muted)', fontSize: '13px' },
      }));
      return;
    }

    for (const s of sessions) {
      const elapsed = formatDuration(s.elapsedSeconds);
      const card = el('div', {
        style: {
          background: 'var(--surface1)', borderRadius: '8px', padding: '12px 16px', marginBottom: '8px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        },
      }, [
        el('div', {}, [
          el('span', {
            textContent: `Sessao ${s.id.slice(0, 8)}`,
            style: { fontWeight: '600', fontSize: '14px' },
          }),
          el('span', {
            textContent: ` — PID ${s.pid} — ${elapsed}`,
            style: { color: 'var(--text-muted)', fontSize: '12px', marginLeft: '8px' },
          }),
          ...(s.prompt ? [el('div', {
            textContent: s.prompt.length > 80 ? s.prompt.slice(0, 80) + '...' : s.prompt,
            style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' },
          })] : []),
        ]),
        el('div', { style: { display: 'flex', gap: '8px' } }, [
          el('button', {
            className: 'btn btn-primary btn-sm',
            textContent: 'Abrir Terminal',
            onClick: () => {
              getViewManager().open(s.id);
              document.getElementById('terminal-title').textContent = `Gemini — ${s.id.slice(0, 8)}`;
            },
          }),
          el('button', {
            className: 'btn btn-danger btn-sm',
            textContent: 'Parar',
            onClick: async () => {
              try {
                await API.stopGeminiSession(s.id);
                showToast('Sessao parada');
                renderGeminiActiveSessions(section, container, statusCard, status);
              } catch (err) {
                showToast(err.message, 'error');
              }
            },
          }),
        ]),
      ]);
      section.appendChild(card);
    }
  } catch (err) {
    section.appendChild(el('p', {
      textContent: 'Erro: ' + err.message,
      style: { color: 'var(--danger)', fontSize: '13px' },
    }));
  }
}

async function renderGeminiSessionHistory(section) {
  section.innerHTML = '';
  section.appendChild(el('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  }, [
    el('h3', { textContent: 'Historico', style: { fontSize: '16px', margin: '0' } }),
    el('div', { style: { display: 'flex', gap: '8px' } }, [
      el('button', {
        className: 'btn btn-sm',
        textContent: 'Atualizar',
        onClick: () => renderGeminiSessionHistory(section),
      }),
      el('button', {
        className: 'btn btn-danger btn-sm',
        textContent: 'Limpar',
        onClick: async () => {
          if (!confirm('Limpar historico de sessoes Gemini?')) return;
          try {
            await API.clearGeminiHistory();
            showToast('Historico limpo');
            renderGeminiSessionHistory(section);
          } catch (err) {
            showToast(err.message, 'error');
          }
        },
      }),
    ]),
  ]));

  try {
    const sessions = await API.getGeminiSessionHistory();
    const history = sessions
      .filter(s => s.status !== 'running')
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    if (history.length === 0) {
      section.appendChild(el('p', {
        textContent: 'Nenhuma sessao no historico.',
        style: { color: 'var(--text-muted)', fontSize: '13px' },
      }));
      return;
    }

    const tableContainer = el('div', { className: 'table-container' });
    const table = el('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Sessao</th>
          <th>Prompt</th>
          <th>Status</th>
          <th>Inicio</th>
          <th>Duracao</th>
          <th>Acoes</th>
        </tr>
      </thead>
    `;

    const tbody = el('tbody');
    for (const s of history) {
      const tr = el('tr');
      const statusClass = s.status || 'stopped';

      tr.appendChild(el('td', { textContent: s.id.slice(0, 8) }));
      tr.appendChild(el('td', {
        textContent: s.prompt ? (s.prompt.length > 40 ? s.prompt.slice(0, 40) + '...' : s.prompt) : '(interativo)',
        style: { color: s.prompt ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: s.prompt ? 'normal' : 'italic' },
      }));
      const tdStatus = el('td');
      tdStatus.innerHTML = `<span class="status-tag ${statusClass}">${s.status || '-'}</span>`;
      tr.appendChild(tdStatus);
      tr.appendChild(el('td', { textContent: new Date(s.startedAt).toLocaleString() }));
      tr.appendChild(el('td', { textContent: s.durationSeconds ? formatDuration(s.durationSeconds) : '-' }));

      const tdActions = el('td', { className: 'history-actions' });
      tdActions.appendChild(el('button', {
        className: 'btn btn-sm',
        textContent: 'Output',
        onClick: async () => {
          try {
            const { output } = await API.getGeminiSessionOutput(s.id);
            getViewManager().openReadOnly(
              `Gemini — ${s.id.slice(0, 8)} (historico)`,
              output,
            );
          } catch (err) {
            showToast(err.message, 'error');
          }
        },
      }));
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    section.appendChild(tableContainer);
  } catch (err) {
    section.appendChild(el('p', {
      textContent: 'Erro: ' + err.message,
      style: { color: 'var(--danger)', fontSize: '13px' },
    }));
  }
}

// ═══════════════════════════════════════════
// Google Workspace CLI Page
// ═══════════════════════════════════════════

async function renderGwsCliPage(container, guard) {
  if (!guard) guard = () => true;
  container.innerHTML = '';
  container.appendChild(el('h2', { textContent: 'Google Workspace CLI' }));

  const statusCard = el('div', {
    className: 'card',
    innerHTML: '<p style="color:var(--text-muted)">Verificando...</p>',
  });
  container.appendChild(statusCard);

  try {
    const status = await API.getGwsCLIStatus();
    if (!guard()) return;
    renderGwsCliStatus(container, statusCard, status);
  } catch (err) {
    if (!guard()) return;
    statusCard.innerHTML = `<p style="color:var(--danger)">Erro ao verificar: ${err.message}</p>`;
  }
}

function renderGwsCliStatus(container, statusCard, status) {
  statusCard.innerHTML = '';

  if (!status.installed) {
    // ─── State 1: Not installed ───
    statusCard.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' } }, [
      el('span', { className: 'status-tag status-crashed', textContent: 'Nao instalado' }),
      el('span', { textContent: 'Google Workspace CLI nao encontrado neste servidor', style: { color: 'var(--text-muted)', fontSize: '14px' } }),
    ]));

    statusCard.appendChild(el('p', {
      textContent: 'Google Workspace CLI (gws) permite interagir com todas as APIs do Google Workspace via linha de comando. Instale via npm:',
      style: { fontSize: '14px', marginBottom: '12px' },
    }));

    statusCard.appendChild(renderCopyBlock('npm install -g @googleworkspace/cli'));

    const installLog = el('pre', {
      className: 'code-block',
      style: { display: 'none', maxHeight: '300px', overflow: 'auto', marginTop: '12px' },
    });

    const installBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Instalar Google Workspace CLI',
      style: { marginTop: '12px' },
      onClick: async () => {
        installBtn.disabled = true;
        installBtn.textContent = 'Instalando...';
        installLog.style.display = 'block';
        installLog.textContent = '';

        try {
          await API.installGwsCLI((text) => {
            installLog.textContent += text;
            installLog.scrollTop = installLog.scrollHeight;
          });
          showToast('Google Workspace CLI instalado!');
          const newStatus = await API.getGwsCLIStatus();
          renderGwsCliStatus(container, statusCard, newStatus);
        } catch (err) {
          showToast('Falha na instalacao: ' + err.message, 'error');
          installBtn.textContent = 'Tentar novamente';
          installBtn.disabled = false;
        }
      },
    });

    statusCard.appendChild(installBtn);
    statusCard.appendChild(installLog);

  } else {
    // ─── State 2: Installed ───
    statusCard.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' } }, [
      el('span', { className: 'status-tag status-completed', textContent: 'Instalado' }),
      el('span', {
        textContent: `GWS CLI v${status.version || '?'}`,
        style: { color: 'var(--text-muted)', fontSize: '14px' },
      }),
    ]));

    // Auth status
    if (!status.authenticated) {
      statusCard.appendChild(el('p', {
        textContent: 'Autenticacao necessaria. Use "gws auth login" para configurar o acesso ao Google Workspace.',
        style: { fontSize: '13px', color: 'var(--warning)', marginBottom: '12px' },
      }));

      const authBtn = el('button', {
        className: 'btn btn-primary',
        textContent: 'Fazer Login (gws auth login)',
        style: { marginBottom: '12px' },
        onClick: async () => {
          authBtn.textContent = 'Abrindo terminal...';
          try {
            const result = await API.startGwsCLIAuth();
            getViewManager().open(result.sessionId);
            document.getElementById('terminal-title').textContent = 'gws auth login';
            const onExit = (msg) => {
              if (msg.sessionId === result.sessionId) {
                API.off('terminal:exit', onExit);
                renderGwsCliPage(container);
              }
            };
            API.on('terminal:exit', onExit);
          } catch (err) {
            showToast('Erro: ' + err.message, 'error');
            authBtn.textContent = 'Fazer Login (gws auth login)';
          }
        },
      });
      statusCard.appendChild(authBtn);
    } else {
      statusCard.appendChild(el('p', {
        textContent: `Autenticado: ${status.user || 'Google OAuth'}`,
        style: { fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' },
      }));
    }

    // ─── New Session Button + Collapsible Form ───
    const _env = API.serverEnv || {};
    const _sep = _env.sep || '/';
    const _home = _env.homeDir || '/root';
    function _joinPath(base, name) { return base + _sep + name; }

    const launchForm = el('div', { style: { display: 'none', marginTop: '12px' } });

    const cwdInput = el('input', {
      type: 'text',
      placeholder: `Diretorio de trabalho (padrao: ${_home})`,
      value: _home,
    });

    const cwdShortcuts = el('div', {
      style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' },
    });

    const basePaths = _env.platform === 'win32' ? [
      { label: 'Home', path: _home },
      { label: 'Documents', path: _joinPath(_home, 'Documents') },
      { label: 'Desktop', path: _joinPath(_home, 'Desktop') },
    ] : [
      { label: 'Home', path: _home },
      { label: '/opt', path: '/opt' },
      { label: '/srv', path: '/srv' },
    ];

    for (const bp of basePaths) {
      cwdShortcuts.appendChild(el('button', {
        className: 'btn btn-sm',
        textContent: bp.label,
        style: { fontSize: '11px', padding: '2px 8px', color: 'var(--text-muted)' },
        onClick: () => { cwdInput.value = bp.path; },
      }));
    }

    const promptInput = el('textarea', {
      placeholder: 'Comando GWS (ex: drive files list --params \'{"pageSize": 10}\')',
      style: { minHeight: '50px', resize: 'vertical' },
    });

    function launchGws(withPrompt) {
      return async () => {
        const btn = withPrompt ? launchWithPromptBtn : launchInteractiveBtn;
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Iniciando...';
        try {
          const p = withPrompt ? promptInput.value.trim() : null;
          if (withPrompt && !p) { showToast('Digite um comando', 'error'); btn.disabled = false; btn.textContent = origText; return; }
          const session = await API.launchGwsSession(p, cwdInput.value.trim() || undefined);
          showToast('Sessao GWS iniciada!');
          launchForm.style.display = 'none';
          newSessionBtn.style.display = '';
          getViewManager().open(session.id);
          document.getElementById('terminal-title').textContent = `GWS — ${session.id.slice(0, 8)}`;
          const onExit = (msg) => {
            if (msg.sessionId === session.id) {
              API.off('terminal:exit', onExit);
              renderGwsCliStatus(container, statusCard, status);
            }
          };
          API.on('terminal:exit', onExit);
        } catch (err) {
          showToast('Erro: ' + err.message, 'error');
        }
        btn.textContent = origText;
        btn.disabled = false;
      };
    }

    const launchInteractiveBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Iniciar Interativa',
      onClick: launchGws(false),
    });

    const launchWithPromptBtn = el('button', {
      className: 'btn btn-primary',
      textContent: 'Iniciar com Comando',
      onClick: launchGws(true),
    });

    const cancelBtn = el('button', {
      className: 'btn btn-sm',
      textContent: 'Cancelar',
      onClick: () => { launchForm.style.display = 'none'; newSessionBtn.style.display = ''; },
    });

    launchForm.appendChild(el('div', { className: 'form-group' }, [
      el('label', { textContent: 'Diretorio de Trabalho' }),
      cwdInput,
      cwdShortcuts,
    ]));

    launchForm.appendChild(el('div', { className: 'form-group' }, [
      el('label', { textContent: 'Comando GWS (opcional)' }),
      promptInput,
    ]));

    launchForm.appendChild(el('div', {
      style: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
    }, [launchInteractiveBtn, launchWithPromptBtn, cancelBtn]));

    const newSessionBtn = el('button', {
      className: 'btn btn-primary',
      textContent: '+ Nova Sessao',
      onClick: () => {
        newSessionBtn.style.display = 'none';
        launchForm.style.display = '';
      },
    });

    statusCard.appendChild(newSessionBtn);
    statusCard.appendChild(launchForm);

    // ─── Active GWS Sessions ───
    const activeSection = el('div', { style: { marginTop: '24px' } });
    statusCard.appendChild(activeSection);
    renderGwsActiveSessions(activeSection, container, statusCard, status);

    // ─── Session History ───
    const historySection = el('div', { style: { marginTop: '24px' } });
    statusCard.appendChild(historySection);
    renderGwsSessionHistory(historySection);
  }
}

async function renderGwsActiveSessions(section, container, statusCard, status) {
  section.innerHTML = '';
  section.appendChild(el('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  }, [
    el('h3', { textContent: 'Sessoes Ativas', style: { fontSize: '16px', margin: '0' } }),
    el('button', {
      className: 'btn btn-sm',
      textContent: 'Atualizar',
      onClick: () => renderGwsActiveSessions(section, container, statusCard, status),
    }),
  ]));

  try {
    const sessions = await API.getActiveGwsSessions();
    if (sessions.length === 0) {
      section.appendChild(el('p', {
        textContent: 'Nenhuma sessao ativa.',
        style: { color: 'var(--text-muted)', fontSize: '13px' },
      }));
      return;
    }

    for (const s of sessions) {
      const elapsed = formatDuration(s.elapsedSeconds);
      const card = el('div', {
        style: {
          background: 'var(--surface1)', borderRadius: '8px', padding: '12px 16px', marginBottom: '8px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        },
      }, [
        el('div', {}, [
          el('span', {
            textContent: `Sessao ${s.id.slice(0, 8)}`,
            style: { fontWeight: '600', fontSize: '14px' },
          }),
          el('span', {
            textContent: ` — PID ${s.pid} — ${elapsed}`,
            style: { color: 'var(--text-muted)', fontSize: '12px', marginLeft: '8px' },
          }),
          ...(s.prompt ? [el('div', {
            textContent: s.prompt.length > 80 ? s.prompt.slice(0, 80) + '...' : s.prompt,
            style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' },
          })] : []),
        ]),
        el('div', { style: { display: 'flex', gap: '8px' } }, [
          el('button', {
            className: 'btn btn-primary btn-sm',
            textContent: 'Abrir Terminal',
            onClick: () => {
              getViewManager().open(s.id);
              document.getElementById('terminal-title').textContent = `GWS — ${s.id.slice(0, 8)}`;
            },
          }),
          el('button', {
            className: 'btn btn-danger btn-sm',
            textContent: 'Parar',
            onClick: async () => {
              try {
                await API.stopGwsSession(s.id);
                showToast('Sessao parada');
                renderGwsActiveSessions(section, container, statusCard, status);
              } catch (err) {
                showToast(err.message, 'error');
              }
            },
          }),
        ]),
      ]);
      section.appendChild(card);
    }
  } catch (err) {
    section.appendChild(el('p', {
      textContent: 'Erro: ' + err.message,
      style: { color: 'var(--danger)', fontSize: '13px' },
    }));
  }
}

async function renderGwsSessionHistory(section) {
  section.innerHTML = '';
  section.appendChild(el('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  }, [
    el('h3', { textContent: 'Historico', style: { fontSize: '16px', margin: '0' } }),
    el('div', { style: { display: 'flex', gap: '8px' } }, [
      el('button', {
        className: 'btn btn-sm',
        textContent: 'Atualizar',
        onClick: () => renderGwsSessionHistory(section),
      }),
      el('button', {
        className: 'btn btn-danger btn-sm',
        textContent: 'Limpar',
        onClick: async () => {
          if (!confirm('Limpar historico de sessoes GWS?')) return;
          try {
            await API.clearGwsHistory();
            showToast('Historico limpo');
            renderGwsSessionHistory(section);
          } catch (err) {
            showToast(err.message, 'error');
          }
        },
      }),
    ]),
  ]));

  try {
    const sessions = await API.getGwsSessionHistory();
    const history = sessions
      .filter(s => s.status !== 'running')
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    if (history.length === 0) {
      section.appendChild(el('p', {
        textContent: 'Nenhuma sessao no historico.',
        style: { color: 'var(--text-muted)', fontSize: '13px' },
      }));
      return;
    }

    const tableContainer = el('div', { className: 'table-container' });
    const table = el('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Sessao</th>
          <th>Comando</th>
          <th>Status</th>
          <th>Inicio</th>
          <th>Duracao</th>
          <th>Acoes</th>
        </tr>
      </thead>
    `;

    const tbody = el('tbody');
    for (const s of history) {
      const tr = el('tr');
      const statusClass = s.status || 'stopped';

      tr.appendChild(el('td', { textContent: s.id.slice(0, 8) }));
      tr.appendChild(el('td', {
        textContent: s.prompt ? (s.prompt.length > 40 ? s.prompt.slice(0, 40) + '...' : s.prompt) : '(interativo)',
        style: { color: s.prompt ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: s.prompt ? 'normal' : 'italic' },
      }));
      const tdStatus = el('td');
      tdStatus.innerHTML = `<span class="status-tag ${statusClass}">${s.status || '-'}</span>`;
      tr.appendChild(tdStatus);
      tr.appendChild(el('td', { textContent: new Date(s.startedAt).toLocaleString() }));
      tr.appendChild(el('td', { textContent: s.durationSeconds ? formatDuration(s.durationSeconds) : '-' }));

      const tdActions = el('td', { className: 'history-actions' });
      tdActions.appendChild(el('button', {
        className: 'btn btn-sm',
        textContent: 'Output',
        onClick: async () => {
          try {
            const { output } = await API.getGwsSessionOutput(s.id);
            getViewManager().openReadOnly(
              `GWS — ${s.id.slice(0, 8)} (historico)`,
              output,
            );
          } catch (err) {
            showToast(err.message, 'error');
          }
        },
      }));
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    section.appendChild(tableContainer);
  } catch (err) {
    section.appendChild(el('p', {
      textContent: 'Erro: ' + err.message,
      style: { color: 'var(--danger)', fontSize: '13px' },
    }));
  }
}

// ═══════════════════════════════════════════
// APM Agent Profiles Page
// ═══════════════════════════════════════════

// ─── Claude Code Agents Page ───

const _agentColorMap = {
  blue: 'var(--accent)',
  green: 'var(--success)',
  cyan: '#94e2d5',
  red: 'var(--danger)',
  yellow: 'var(--warning)',
};

async function renderClaudeAgentsPage(container, guard) {
  if (!guard) guard = () => true;
  container.innerHTML = '';

  const header = el('div', { className: 'page-title' }, [
    el('span', { textContent: 'Agentes Claude Code' }),
    el('button', {
      className: 'btn btn-sm',
      textContent: 'Atualizar',
      onClick: () => renderClaudeAgentsPage(container),
    }),
  ]);
  container.appendChild(header);

  const loadingEl = el('div', { className: 'empty-state', innerHTML: '<p>Carregando agentes...</p>' });
  container.appendChild(loadingEl);

  try {
    const data = await API.getClaudeAgents();
    if (!guard()) return;
    if (loadingEl.parentNode) container.removeChild(loadingEl);

    // Info bar
    const infoBar = el('div', { className: 'card', style: { marginBottom: '24px', padding: '12px 16px' } }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        el('span', {
          className: 'status-tag status-completed',
          textContent: `${(data.agents || []).length} agentes`,
        }),
        el('span', {
          style: { color: 'var(--text-muted)', fontSize: '13px' },
          textContent: data.agentsDir || '~/.claude/agents/',
        }),
      ]),
    ]);
    container.appendChild(infoBar);

    const agents = data.agents || [];
    if (agents.length === 0) {
      container.appendChild(el('div', { className: 'empty-state', innerHTML:
        '<p>Nenhum agente encontrado.<br>Crie arquivos <code>.md</code> em <code>~/.claude/agents/</code></p>'
      }));
      return;
    }

    // Agent grid
    const grid = el('div', { className: 'card-grid' });

    for (const agent of agents) {
      const borderColor = _agentColorMap[agent.color] || 'var(--accent)';
      const modelLabel = (agent.model || 'sonnet').toUpperCase();

      const card = el('div', { className: 'card', style: { borderLeft: `3px solid ${borderColor}` } }, [
        // Header row: name + model tag
        el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' } }, [
          el('div', { className: 'card-title', textContent: agent.name, style: { marginBottom: '0' } }),
          el('span', {
            className: 'status-tag',
            textContent: modelLabel,
            style: {
              background: `${borderColor}33`,
              color: borderColor,
              fontSize: '10px',
              fontWeight: '600',
            },
          }),
        ]),
        // Meta: color, memory
        el('div', { className: 'card-meta', style: { marginBottom: '8px', fontSize: '12px' } }, [
          el('span', {
            textContent: agent.color,
            style: { color: borderColor, marginRight: '12px' },
          }),
          el('span', {
            textContent: `memory: ${agent.memory}`,
            style: { color: 'var(--text-muted)' },
          }),
        ]),
        // Short description
        el('div', {
          textContent: agent.shortDescription || '',
          style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: '1.4' },
        }),
        // Actions
        el('div', { className: 'card-actions' }, [
          el('button', {
            className: 'btn btn-success btn-sm',
            textContent: 'Lancar',
            onClick: () => showLaunchClaudeAgentModal(agent),
          }),
          el('button', {
            className: 'btn btn-sm',
            textContent: 'Ver Detalhes',
            onClick: () => showClaudeAgentDetailModal(agent),
          }),
        ]),
      ]);
      grid.appendChild(card);
    }

    container.appendChild(grid);
  } catch (err) {
    if (!guard()) return;
    if (loadingEl.parentNode) container.removeChild(loadingEl);
    container.appendChild(el('div', { className: 'empty-state', innerHTML:
      `<p style="color:var(--danger)">Erro ao carregar agentes: ${err.message}</p>`
    }));
  }
}

function showLaunchClaudeAgentModal(agent) {
  const overlay = el('div', { className: 'modal-overlay' });
  const modal = el('div', { className: 'modal' });

  const _env = API.serverEnv || {};
  const _home = _env.homeDir || '/root';
  const borderColor = _agentColorMap[agent.color] || 'var(--accent)';

  modal.innerHTML = `
    <div class="modal-title" style="display:flex;align-items:center;gap:8px">
      <span style="color:${borderColor}">&#9654;</span> Lancar ${agent.name}
    </div>
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">${agent.shortDescription || ''}</p>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:16px;font-family:monospace">
      claude --agent ${agent.name} [--dangerously-skip-permissions]
    </div>
    <div class="form-group">
      <label>Diretorio de Trabalho</label>
      <input type="text" id="cagent-launch-cwd" value="${_home}" placeholder="${_home}">
    </div>
    <div class="form-group">
      <label>Modo</label>
      <select id="cagent-launch-mode">
        <option value="bypass" selected>Bypass (sem pedir permissao)</option>
        <option value="normal">Normal</option>
      </select>
    </div>
    <div class="form-group">
      <label>Node Memory MB (opcional)</label>
      <input type="number" id="cagent-launch-mem" placeholder="Ex: 8192">
    </div>
    <div class="modal-actions">
      <button class="btn" id="cagent-launch-cancel">Cancelar</button>
      <button class="btn btn-primary" id="cagent-launch-go">Lancar Agente</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.querySelector('#cagent-launch-cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  modal.querySelector('#cagent-launch-go').onclick = async () => {
    const cwd = modal.querySelector('#cagent-launch-cwd').value.trim();
    const mode = modal.querySelector('#cagent-launch-mode').value;
    const mem = parseInt(modal.querySelector('#cagent-launch-mem').value) || null;

    if (!cwd) {
      showToast('Diretorio de trabalho e obrigatorio', 'error');
      return;
    }

    overlay.remove();

    try {
      const useStreamJson = true; // always use stream-json for clean chat UI
      const session = await API.launchClaudeAgent(agent.name, cwd, mode, mem, { streamJson: useStreamJson });
      showToast(`Agente "${agent.name}" lancado!`);
      getViewManager().open(session.id, { streamJson: useStreamJson });
      document.getElementById('terminal-title').textContent =
        `Agent: ${agent.name} \u2014 ${session.id.slice(0, 8)}`;
      updateActiveCount();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  setTimeout(() => modal.querySelector('#cagent-launch-cwd').focus(), 100);
}

async function showClaudeAgentDetailModal(agent) {
  const overlay = el('div', { className: 'modal-overlay' });
  const modal = el('div', { className: 'modal', style: { maxWidth: '700px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' } });

  const borderColor = _agentColorMap[agent.color] || 'var(--accent)';

  modal.innerHTML = `
    <div class="modal-title" style="display:flex;align-items:center;gap:8px">
      <span style="color:${borderColor}">&#9883;</span> ${agent.name}
    </div>
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
      <span class="status-tag" style="background:${borderColor}33;color:${borderColor};font-size:11px">${(agent.model || 'sonnet').toUpperCase()}</span>
      <span class="status-tag" style="font-size:11px">color: ${agent.color}</span>
      <span class="status-tag" style="font-size:11px">memory: ${agent.memory}</span>
    </div>
    <div style="flex:1;overflow:auto;margin-bottom:16px">
      <pre style="white-space:pre-wrap;word-wrap:break-word;font-size:12px;line-height:1.5;color:var(--text-primary);background:var(--bg-secondary);padding:16px;border-radius:8px;max-height:none">Carregando...</pre>
    </div>
    <div class="modal-actions">
      <button class="btn" id="cagent-detail-close">Fechar</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.querySelector('#cagent-detail-close').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  try {
    const detail = await API.getClaudeAgent(agent.name);
    const pre = modal.querySelector('pre');
    // Remove YAML frontmatter for cleaner display
    let body = detail.content || '';
    body = body.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');
    pre.textContent = body.trim();
  } catch (err) {
    const pre = modal.querySelector('pre');
    pre.textContent = `Erro ao carregar: ${err.message}`;
    pre.style.color = 'var(--danger)';
  }
}

// ─── APM Agent Profiles Page ───

async function renderAgentProfilesPage(container, guard) {
  if (!guard) guard = () => true;
  container.innerHTML = '';

  const header = el('div', { className: 'page-title' }, [
    el('span', { textContent: 'Perfis de Agentes (APM)' }),
    el('button', {
      className: 'btn btn-sm',
      textContent: 'Atualizar',
      onClick: () => renderAgentProfilesPage(container),
    }),
  ]);
  container.appendChild(header);

  const loadingEl = el('div', { className: 'empty-state', innerHTML: '<p>Carregando status do APM...</p>' });
  container.appendChild(loadingEl);

  try {
    const [statusData, agentsData] = await Promise.all([
      API.getApmStatus(),
      API.getApmAgents(),
    ]);
    if (!guard()) return;

    if (loadingEl.parentNode) container.removeChild(loadingEl);

    // Section 1: Status card
    renderApmStatusCard(container, statusData);

    if (!statusData.installed) {
      container.appendChild(el('div', { className: 'empty-state', innerHTML:
        '<p>Templates APM nao encontrados.<br>Verifique se a pasta <code>apm-templates/</code> existe no servidor.</p>'
      }));
      return;
    }

    // Section 2: Agent profiles grid
    renderAgentProfilesGrid(container, agentsData.agents || []);

    // Section 3: Project APM status
    if (!guard()) return;
    await renderProjectApmSection(container);
  } catch (err) {
    if (!guard()) return;
    if (loadingEl.parentNode) container.removeChild(loadingEl);
    container.appendChild(el('div', { className: 'empty-state', innerHTML:
      `<p style="color:var(--danger)">Erro ao carregar APM: ${err.message}</p>`
    }));
  }
}

function renderApmStatusCard(container, status) {
  const statusTag = status.installed
    ? el('span', { className: 'status-tag status-completed', textContent: 'Disponivel' })
    : el('span', { className: 'status-tag status-crashed', textContent: 'Nao encontrado' });

  const infoText = status.installed
    ? `${status.commandsCount} agentes, ${status.guidesCount} guias`
    : 'Templates APM nao encontrados';

  const card = el('div', { className: 'card', style: { marginBottom: '24px' } }, [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } }, [
      statusTag,
      el('span', { textContent: infoText, style: { color: 'var(--text-muted)', fontSize: '14px' } }),
    ]),
    ...(status.installed ? [
      el('div', { className: 'card-meta', style: { fontSize: '12px', color: 'var(--text-muted)' } }, [
        el('span', { textContent: 'Templates: ' }),
        el('code', { textContent: status.templatesDir }),
      ]),
    ] : []),
  ]);

  container.appendChild(card);
}

function renderAgentProfilesGrid(container, agents) {
  const categoryLabels = { initiate: 'Iniciacao', handover: 'Handover', delegate: 'Delegacao' };
  const categoryColors = { initiate: 'var(--accent)', handover: 'var(--warning)', delegate: 'var(--success)' };

  // Group by category
  const grouped = {};
  for (const a of agents) {
    if (!grouped[a.category]) grouped[a.category] = [];
    grouped[a.category].push(a);
  }

  for (const cat of ['initiate', 'handover', 'delegate']) {
    if (!grouped[cat]) continue;

    container.appendChild(el('h3', {
      textContent: categoryLabels[cat] || cat,
      style: { fontSize: '16px', marginTop: '20px', marginBottom: '12px', color: categoryColors[cat] },
    }));

    const grid = el('div', { className: 'card-grid' });

    for (const agent of grouped[cat]) {
      const card = el('div', { className: 'card' }, [
        el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' } }, [
          el('div', { className: 'card-title', textContent: agent.agentType, style: { marginBottom: '0' } }),
          el('span', {
            className: 'status-tag',
            textContent: `#${agent.priority}`,
            style: { background: 'rgba(137,180,250,0.2)', color: 'var(--accent)', fontSize: '10px' },
          }),
        ]),
        el('div', {
          textContent: agent.description,
          style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: '1.4' },
        }),
        el('div', { className: 'card-meta', style: { marginBottom: '12px' } }, [
          el('span', {}, [el('span', { textContent: 'Comando: ' }), el('code', { textContent: agent.commandName })]),
          el('span', { textContent: ' ' }),
          el('span', {}, [el('span', { textContent: 'Arquivo: ' }), el('code', { textContent: agent.filename })]),
        ]),
        el('div', { className: 'card-actions' }, [
          el('button', {
            className: 'btn btn-success btn-sm',
            textContent: 'Lancar',
            onClick: () => showLaunchAgentModal(agent),
          }),
          el('button', {
            className: 'btn btn-sm',
            textContent: 'Ver Prompt',
            onClick: () => showAgentPromptModal(agent),
          }),
        ]),
      ]);
      grid.appendChild(card);
    }

    container.appendChild(grid);
  }
}

function showLaunchAgentModal(agent) {
  const overlay = el('div', { className: 'modal-overlay' });
  const modal = el('div', { className: 'modal' });

  const _env = API.serverEnv || {};
  const _home = _env.homeDir || '/root';

  modal.innerHTML = `
    <div class="modal-title">Lancar ${agent.agentType}</div>
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">${agent.description}</p>
    <div class="form-group">
      <label>Diretorio de Trabalho</label>
      <input type="text" id="apm-launch-cwd" value="${_home}" placeholder="${_home}">
      <small style="color:var(--text-muted);display:block;margin-top:4px">O projeto deve ter o APM instalado (.apm/ e .claude/commands/)</small>
    </div>
    <div class="form-group">
      <label>Modo</label>
      <select id="apm-launch-mode">
        <option value="bypass" selected>Bypass (recomendado para APM)</option>
        <option value="normal">Normal</option>
      </select>
    </div>
    <div class="form-group">
      <label>Node Memory MB (opcional)</label>
      <input type="number" id="apm-launch-mem" placeholder="Ex: 8192">
    </div>
    <div class="modal-actions">
      <button class="btn" id="apm-launch-cancel">Cancelar</button>
      <button class="btn btn-primary" id="apm-launch-go">Lancar Agente</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  modal.querySelector('#apm-launch-cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  modal.querySelector('#apm-launch-go').onclick = async () => {
    const cwd = modal.querySelector('#apm-launch-cwd').value.trim();
    const mode = modal.querySelector('#apm-launch-mode').value;
    const mem = parseInt(modal.querySelector('#apm-launch-mem').value) || null;

    if (!cwd) {
      showToast('Diretorio de trabalho e obrigatorio', 'error');
      return;
    }

    overlay.remove();

    try {
      const session = await API.launchAgent(agent.id, cwd, mode, mem, { streamJson: isMobileView() });
      showToast(`${agent.agentType} lancado!`);
      getViewManager().open(session.id, { streamJson: isMobileView() });
      document.getElementById('terminal-title').textContent =
        `APM ${agent.agentType} \u2014 ${session.id.slice(0, 8)}`;
      updateActiveCount();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  setTimeout(() => modal.querySelector('#apm-launch-cwd').focus(), 100);
}

async function showAgentPromptModal(agent) {
  const overlay = el('div', { className: 'modal-overlay' });
  const modal = el('div', { className: 'modal', style: { maxWidth: '700px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' } });

  modal.appendChild(el('div', { className: 'modal-title', textContent: `${agent.agentType} \u2014 Prompt` }));

  const contentArea = el('pre', {
    style: {
      flex: '1', overflow: 'auto', maxHeight: '60vh', marginBottom: '16px',
      borderRadius: 'var(--radius)', border: '1px solid var(--border)',
      background: 'var(--bg-primary)', padding: '16px', fontSize: '12px',
      lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      color: 'var(--text-primary)',
    },
  });
  contentArea.appendChild(el('code', { textContent: 'Carregando...' }));
  modal.appendChild(contentArea);

  modal.appendChild(el('div', { className: 'modal-actions' }, [
    el('button', { className: 'btn', textContent: 'Fechar', onClick: () => overlay.remove() }),
  ]));

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  try {
    const data = await API.getApmAgent(agent.id);
    contentArea.innerHTML = '';
    contentArea.appendChild(el('code', { textContent: data.content }));
  } catch (err) {
    contentArea.innerHTML = '';
    contentArea.appendChild(el('code', { textContent: 'Erro: ' + err.message, style: { color: 'var(--danger)' } }));
  }
}

async function renderProjectApmSection(container) {
  container.appendChild(el('h3', {
    textContent: 'Projetos com APM',
    style: { fontSize: '16px', marginTop: '28px', marginBottom: '12px' },
  }));

  let projectsData;
  try {
    projectsData = await API.getApmProjects();
  } catch (err) {
    container.appendChild(el('p', {
      textContent: 'Erro ao verificar projetos: ' + err.message,
      style: { color: 'var(--danger)', fontSize: '13px' },
    }));
    return;
  }

  const projects = projectsData.projects;

  // Install row
  const dirInput = el('input', {
    type: 'text',
    placeholder: 'Diretorio do projeto para instalar APM...',
    style: {
      flex: '1', padding: '8px 12px', background: 'var(--bg-primary)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      color: 'var(--text-primary)', fontSize: '14px',
    },
  });

  const installRow = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' } }, [
    dirInput,
    el('button', {
      className: 'btn btn-primary',
      textContent: 'Instalar APM',
      onClick: () => showInstallApmModal(dirInput.value.trim(), container),
    }),
  ]);
  container.appendChild(installRow);

  if (projects.length === 0) {
    container.appendChild(el('div', { className: 'empty-state', innerHTML:
      '<p>Nenhum projeto com perfis cadastrados.<br>Crie perfis com diretorios de trabalho para detectar APM.</p>'
    }));
    return;
  }

  // Table
  const tableContainer = el('div', { className: 'table-container' });
  const table = el('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Projeto</th>
        <th>Diretorio</th>
        <th>APM</th>
        <th>Comandos</th>
        <th>Acoes</th>
      </tr>
    </thead>
  `;

  const tbody = el('tbody');
  for (const p of projects) {
    const tr = el('tr');

    tr.appendChild(el('td', { textContent: p.profileName }));
    tr.appendChild(el('td', { textContent: p.path, style: { fontFamily: 'monospace', fontSize: '12px' } }));

    const tdApm = el('td');
    if (p.apmInstalled) {
      tdApm.appendChild(el('span', { className: 'status-tag status-completed', textContent: `Sim (${p.guidesCount} guias)` }));
    } else {
      tdApm.appendChild(el('span', { className: 'status-tag status-stopped', textContent: 'Nao' }));
    }
    tr.appendChild(tdApm);

    const tdCmd = el('td');
    if (p.commandsInstalled) {
      tdCmd.appendChild(el('span', { className: 'status-tag status-completed', textContent: `Sim (${p.commandsCount})` }));
    } else {
      tdCmd.appendChild(el('span', { className: 'status-tag status-stopped', textContent: 'Nao' }));
    }
    tr.appendChild(tdCmd);

    const tdActions = el('td', { className: 'history-actions' });
    if (!p.apmInstalled) {
      tdActions.appendChild(el('button', {
        className: 'btn btn-primary btn-sm',
        textContent: 'Instalar',
        onClick: () => showInstallApmModal(p.path, container),
      }));
    } else {
      tdActions.appendChild(el('button', {
        className: 'btn btn-sm',
        textContent: 'Atualizar',
        onClick: () => showInstallApmModal(p.path, container, true),
      }));
    }
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  tableContainer.appendChild(table);
  container.appendChild(tableContainer);
}

function showInstallApmModal(targetDir, pageContainer, isUpdate = false) {
  if (!targetDir) {
    showToast('Informe o diretorio do projeto', 'error');
    return;
  }

  const overlay = el('div', { className: 'modal-overlay' });
  const modal = el('div', { className: 'modal' }, [
    el('div', { className: 'modal-title', textContent: isUpdate ? 'Atualizar APM' : 'Instalar APM' }),
    el('p', {
      textContent: isUpdate
        ? 'Isto vai sobrescrever os guias e comandos existentes com as versoes mais recentes (traduzidas) do launcher.'
        : 'Isto vai copiar a estrutura APM e os comandos traduzidos para o diretorio do projeto.',
      style: { fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' },
    }),
    el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' } }, [
      el('div', {}, [el('span', { textContent: 'Destino: ' }), el('code', { textContent: targetDir })]),
      el('div', { style: { marginTop: '4px' } }, [el('span', { textContent: 'Origem: ' }), el('code', { textContent: 'apm-templates/ (do launcher)' })]),
    ]),
    el('div', { className: 'modal-actions' }, [
      el('button', { className: 'btn', textContent: 'Cancelar', onClick: () => overlay.remove() }),
      el('button', {
        className: 'btn btn-primary',
        textContent: isUpdate ? 'Atualizar' : 'Instalar',
        onClick: async () => {
          overlay.remove();
          try {
            const result = await API.installApm(targetDir, isUpdate);
            showToast(`APM ${isUpdate ? 'atualizado' : 'instalado'}: ${result.guidesCount} guias, ${result.commandsCount} comandos`);
            renderAgentProfilesPage(pageContainer);
          } catch (err) {
            if (err.message && err.message.includes('already installed')) {
              showInstallApmModal(targetDir, pageContainer, true);
            } else {
              showToast(err.message, 'error');
            }
          }
        },
      }),
    ]),
  ]);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

// ─── Voice Manager Page ───

async function renderVoiceManagerPage(container) {
  container.innerHTML = `
    <div class="page-title"><span>Voice Manager</span></div>
    <div id="vm-root" style="display:flex;gap:20px;width:100%;flex-wrap:wrap">
      <div id="vm-left" style="flex:1;min-width:300px">
        <div style="background:var(--bg-secondary);border-radius:8px;padding:16px;border:1px solid var(--border);margin-bottom:16px">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
            <select id="vm-agent" style="flex:1;padding:8px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px"></select>
            <button id="vm-launch-btn" class="btn btn-primary" style="white-space:nowrap">Iniciar Agente</button>
          </div>
          <div id="vm-agent-status" style="font-size:13px;color:var(--text-muted)">Selecione um agente e clique Iniciar</div>
        </div>
        <div style="background:var(--bg-secondary);border-radius:8px;padding:16px;border:1px solid var(--border);margin-bottom:16px">
          <div style="display:flex;gap:8px;align-items:center">
            <button id="vm-mic-btn" style="width:60px;height:60px;border-radius:50%;border:2px solid var(--border);background:var(--bg-primary);color:var(--text-primary);font-size:24px;cursor:pointer;transition:all 0.3s">&#127908;</button>
            <div style="flex:1">
              <div id="vm-mic-status" style="font-size:13px;color:var(--text-muted)">Clique para falar</div>
              <div id="vm-timer" style="font-family:monospace;font-size:18px;color:var(--accent);min-height:22px"></div>
            </div>
            <select id="vm-voice" style="padding:6px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;font-size:12px">
              <option value="pt-BR-FranciscaNeural">Francisca</option>
              <option value="pt-BR-AntonioNeural" selected>Antonio</option>
              <option value="pt-BR-ThalitaMultilingualNeural">Thalita</option>
            </select>
          </div>
        </div>
        <div id="vm-conversation" style="display:flex;flex-direction:column;gap:8px;max-height:500px;overflow-y:auto"></div>
      </div>
      <div id="vm-right" style="width:350px;flex-shrink:0">
        <div id="vm-avatar-container" style="width:350px;height:420px;background:#111;border-radius:12px;border:1px solid var(--border);overflow:hidden;position:relative">
          <div id="vm-avatar-loading" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#666;font-size:14px">Carregando avatar...</div>
        </div>
      </div>
    </div>
  `;

  // Load agents into select
  try {
    var resp = await API.getClaudeAgents(); var agents = resp.agents || resp;
    var select = document.getElementById('vm-agent');
    var manager = agents.find(function(a) { return a.name === 'manager-agent'; });
    if (manager) {
      var opt = document.createElement('option');
      opt.value = manager.name;
      opt.textContent = manager.name;
      opt.selected = true;
      select.appendChild(opt);
    }
    agents.filter(function(a) { return a.name !== 'manager-agent'; }).forEach(function(a) {
      var opt = document.createElement('option');
      opt.value = a.name;
      opt.textContent = a.name;
      select.appendChild(opt);
    });
  } catch (e) {
    document.getElementById('vm-agent-status').textContent = 'Erro ao carregar agentes: ' + e.message;
  }

  // State
  var sessionId = null;
  var recording = false;
  var mediaRecorder = null;
  var audioChunks = [];
  var timerInterval = null;
  var head = null;
  var avatarReady = false;

  // Avatar init
  async function initAvatar() {
    var mod = await import('https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/modules/talkinghead.mjs');
    var TalkingHead = mod.TalkingHead;

    var avatarContainer = document.getElementById('vm-avatar-container');
    var loading = document.getElementById('vm-avatar-loading');

    head = new TalkingHead(avatarContainer, {
      lipsyncModules: ['en', 'fi'],
      cameraView: 'head',
      cameraRotateEnable: false,
      cameraPanEnable: false,
      cameraZoomEnable: false,
      avatarIdleEyeContact: 1,
      avatarIdleHeadMove: 0,
      modelFPS: 30
    });

    await head.showAvatar({
      url: '/api/voice/avatars/avatarsdk.glb',
      body: 'M',
      avatarMood: 'neutral',
      lipsyncLang: 'en',
      retarget: {
        Neck: { z: -0.01, rx: -0.7 }, Neck1: { z: -0.01, rx: -0.7 }, Neck2: { z: -0.01, rx: -0.7 },
        LeftShoulder: { rz: -0.3 }, RightShoulder: { rz: 0.3 },
        scaleToEyesLevel: 1.0, origin: { y: -0.1 }
      },
      baseline: { headRotateX: -0.4, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 }
    }, function(ev) {
      if (ev.lengthComputable) {
        loading.textContent = 'Carregando avatar ' + Math.round(ev.loaded / ev.total * 100) + '%';
      }
    });

    loading.style.display = 'none';
    avatarReady = true;
    head.setView('head', { cameraDistance: 0.6, cameraX: 0, cameraY: 0, cameraRotateX: 0, cameraRotateY: 0 });
    head.lookAtCamera(100);
    setInterval(function() { if (avatarReady && head) head.lookAtCamera(500); }, 1000);
  }

  initAvatar().catch(function(err) {
    console.error('Avatar init error:', err);
    var el = document.getElementById('vm-avatar-loading');
    if (el) el.textContent = 'Erro avatar: ' + err.message;
  });

  // Launch agent
  document.getElementById('vm-launch-btn').addEventListener('click', async function() {
    var agentName = document.getElementById('vm-agent').value;
    if (!agentName) return;
    var statusEl = document.getElementById('vm-agent-status');
    var btn = document.getElementById('vm-launch-btn');

    if (sessionId) {
      try { await API.stopSession(sessionId); } catch(e) {}
      API.off('output', handleAgentOutput);
      sessionId = null;
      btn.textContent = 'Iniciar Agente';
      statusEl.textContent = 'Agente parado';
      statusEl.style.color = 'var(--text-muted)';
      return;
    }

    btn.disabled = true;
    statusEl.textContent = 'Iniciando ' + agentName + '...';
    try {
      var result = await API.launchClaudeAgent(agentName, 'C:\\Users\\PC', 'bypassPermissions', 8192);
      sessionId = result.sessionId;
      btn.textContent = 'Parar Agente';
      statusEl.textContent = agentName + ' ativo';
      statusEl.style.color = 'var(--accent)';
      API.attachSession(sessionId);
      API.on('output', handleAgentOutput);
    } catch (e) {
      statusEl.textContent = 'Erro: ' + e.message;
      statusEl.style.color = '#ef5350';
    }
    btn.disabled = false;
  });

  // Agent output
  var outputBuffer = '';
  var outputTimeout = null;

  function handleAgentOutput(data) {
    if (data.sessionId !== sessionId) return;
    outputBuffer += data.data;
    clearTimeout(outputTimeout);
    outputTimeout = setTimeout(function() {
      var clean = outputBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '').trim();
      outputBuffer = '';
      if (clean.length > 10) {
        addMessage('agent', clean);
        if (avatarReady && clean.length < 2000) {
          speakWithAvatar(clean);
        }
      }
    }, 2000);
  }

  // TTS with avatar
  async function speakWithAvatar(text) {
    var voice = document.getElementById('vm-voice').value;
    try {
      var resp = await fetch(_url('api/voice/tts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API._token },
        body: JSON.stringify({ text: text.substring(0, 500), voice: voice, lipsync: true })
      });
      if (!resp.ok) return;
      var data = await resp.json();
      if (data.error) return;

      var audioBytes = Uint8Array.from(atob(data.audio), function(c) { return c.charCodeAt(0); });
      var audioBuffer = await head.audioCtx.decodeAudioData(audioBytes.buffer.slice(0));

      head.speakAudio({
        audio: audioBuffer,
        words: data.words || [],
        wtimes: data.wtimes || [],
        wdurations: data.wdurations || [],
        markers: [function() { head.lookAtCamera(100); }],
        mtimes: [0]
      });
    } catch (e) {
      console.error('TTS error:', e);
    }
  }

  // Mic
  document.getElementById('vm-mic-btn').addEventListener('click', async function() {
    recording ? stopRec() : await startRec();
  });

  async function startRec() {
    if (!sessionId) {
      document.getElementById('vm-mic-status').textContent = 'Inicie o agente primeiro!';
      return;
    }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunks = [];
      mediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = function() { stream.getTracks().forEach(function(t) { t.stop(); }); transcribeAndSend(); };
      mediaRecorder.start();
      recording = true;
      var micBtn = document.getElementById('vm-mic-btn');
      micBtn.style.borderColor = '#ef5350';
      micBtn.style.background = '#2a1515';
      document.getElementById('vm-mic-status').textContent = 'Gravando...';
      var start = Date.now();
      timerInterval = setInterval(function() {
        var s = Math.floor((Date.now() - start) / 1000);
        document.getElementById('vm-timer').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      }, 200);
    } catch (e) {
      document.getElementById('vm-mic-status').textContent = 'Erro microfone: ' + e.message;
    }
  }

  function stopRec() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    recording = false;
    var micBtn = document.getElementById('vm-mic-btn');
    micBtn.style.borderColor = 'var(--border)';
    micBtn.style.background = 'var(--bg-primary)';
    clearInterval(timerInterval);
    document.getElementById('vm-timer').textContent = '';
  }

  async function transcribeAndSend() {
    document.getElementById('vm-mic-status').textContent = 'Transcrevendo...';
    var blob = new Blob(audioChunks, { type: 'audio/webm' });
    var fd = new FormData();
    fd.append('audio', blob, 'recording.webm');

    try {
      var resp = await fetch(_url('api/voice/transcribe'), {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + API._token },
        body: fd
      });
      var data = await resp.json();
      if (data.error) {
        document.getElementById('vm-mic-status').textContent = 'Erro: ' + data.error;
        return;
      }

      var text = data.text;
      if (!text || text.trim().length === 0) {
        document.getElementById('vm-mic-status').textContent = 'Nada detectado. Tente novamente.';
        return;
      }

      document.getElementById('vm-mic-status').textContent = 'Clique para falar';
      addMessage('user', text);
      API.sendInput(sessionId, text + '\n');
    } catch (e) {
      document.getElementById('vm-mic-status').textContent = 'Erro: ' + e.message;
    }
  }

  function addMessage(role, text) {
    var conv = document.getElementById('vm-conversation');
    if (!conv) return;
    var div = document.createElement('div');
    div.style.cssText = 'padding:10px 14px;border-radius:8px;font-size:14px;line-height:1.5;max-width:100%;word-wrap:break-word;white-space:pre-wrap;';
    if (role === 'user') {
      div.style.background = 'var(--accent)';
      div.style.color = '#000';
      div.style.alignSelf = 'flex-end';
      div.style.borderBottomRightRadius = '2px';
    } else {
      div.style.background = 'var(--bg-primary)';
      div.style.color = 'var(--text-primary)';
      div.style.border = '1px solid var(--border)';
      div.style.borderBottomLeftRadius = '2px';
    }
    div.textContent = text.substring(0, 2000);
    conv.appendChild(div);
    conv.scrollTop = conv.scrollHeight;
  }
}
