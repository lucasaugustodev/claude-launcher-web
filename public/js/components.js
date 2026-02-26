// ─── UI Components ───

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
    <div class="modal-title">${isEdit ? 'Editar Perfil' : 'Novo Perfil'}</div>
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
    const data = {
      name: modal.querySelector('#pf-name').value.trim(),
      workingDirectory: modal.querySelector('#pf-cwd').value.trim(),
      mode: modal.querySelector('#pf-mode').value,
      initialPrompt: modal.querySelector('#pf-prompt').value.trim(),
      nodeMemory: parseInt(modal.querySelector('#pf-mem').value) || null,
    };

    if (!data.name) {
      showToast('Nome e obrigatorio', 'error');
      return;
    }

    overlay.remove();
    if (onSave) onSave(data);
  };

  // Focus name field
  setTimeout(() => modal.querySelector('#pf-name').focus(), 100);
}

// ─── Profiles Page ───

async function renderProfilesPage(container) {
  container.innerHTML = '';

  const header = el('div', { className: 'page-title' }, [
    el('span', { textContent: 'Perfis' }),
    el('button', {
      className: 'btn btn-primary',
      textContent: '+ Novo Perfil',
      onClick: () => {
        showProfileModal(null, async (data) => {
          try {
            await API.createProfile(data);
            showToast('Perfil criado!');
            renderProfilesPage(container);
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      },
    }),
  ]);
  container.appendChild(header);

  let profiles;
  try {
    profiles = await API.getProfiles();
  } catch (err) {
    container.appendChild(el('div', { className: 'empty-state', innerHTML: `<p>Erro: ${err.message}</p>` }));
    return;
  }

  if (profiles.length === 0) {
    container.appendChild(el('div', { className: 'empty-state', innerHTML: '<p>Nenhum perfil criado.<br>Crie um perfil para lancar sessoes do Claude.</p>' }));
    return;
  }

  const grid = el('div', { className: 'card-grid' });

  for (const p of profiles) {
    const card = el('div', { className: 'card' }, [
      el('div', { className: 'card-title', textContent: p.name }),
      el('div', { className: 'card-meta', innerHTML: `
        <span>Modo: ${p.mode === 'bypass' ? 'Bypass' : 'Normal'}</span>
        <span>Dir: ${p.workingDirectory || '(padrao)'}</span>
        ${p.initialPrompt ? `<span>Prompt: ${p.initialPrompt.substring(0, 50)}...</span>` : ''}
      `}),
      el('div', { className: 'card-actions' }, [
        el('button', {
          className: 'btn btn-success btn-sm',
          textContent: 'Lancar',
          onClick: async () => {
            try {
              const session = await API.launchSession(p.id);
              showToast('Sessao lancada!');
              TerminalManager.open(session.id);
              document.getElementById('terminal-title').textContent = `${p.name} - ${session.id.slice(0, 8)}`;
              updateActiveCount();
            } catch (err) {
              showToast(err.message, 'error');
            }
          },
        }),
        el('button', {
          className: 'btn btn-sm',
          textContent: 'Editar',
          onClick: () => {
            showProfileModal(p, async (data) => {
              try {
                await API.updateProfile(p.id, data);
                showToast('Perfil atualizado!');
                renderProfilesPage(container);
              } catch (err) {
                showToast(err.message, 'error');
              }
            });
          },
        }),
        el('button', {
          className: 'btn btn-danger btn-sm',
          textContent: 'Excluir',
          onClick: async () => {
            if (!confirm('Excluir este perfil?')) return;
            try {
              await API.deleteProfile(p.id);
              showToast('Perfil excluido');
              renderProfilesPage(container);
            } catch (err) {
              showToast(err.message, 'error');
            }
          },
        }),
      ]),
    ]);
    grid.appendChild(card);
  }

  container.appendChild(grid);
}

// ─── Active Sessions Page ───

async function renderActivePage(container) {
  container.innerHTML = '';

  const header = el('div', { className: 'page-title' }, [
    el('span', { textContent: 'Sessoes Ativas' }),
    el('button', {
      className: 'btn btn-sm',
      textContent: 'Atualizar',
      onClick: () => renderActivePage(container),
    }),
  ]);
  container.appendChild(header);

  let sessions;
  try {
    sessions = await API.getActiveSessions();
  } catch (err) {
    container.appendChild(el('div', { className: 'empty-state', innerHTML: `<p>Erro: ${err.message}</p>` }));
    return;
  }

  if (sessions.length === 0) {
    container.appendChild(el('div', { className: 'empty-state', innerHTML: '<p>Nenhuma sessao ativa.<br>Lance uma sessao a partir dos Perfis.</p>' }));
    return;
  }

  const grid = el('div', { className: 'card-grid' });

  for (const s of sessions) {
    const elapsed = formatDuration(s.elapsedSeconds);

    const card = el('div', { className: 'card' }, [
      el('div', { className: 'card-title', textContent: `Sessao ${s.id.slice(0, 8)}` }),
      el('div', { className: 'card-meta', innerHTML: `
        <span>PID: ${s.pid}</span>
        <span>Inicio: ${new Date(s.startedAt).toLocaleString()}</span>
        <span>Tempo: ${elapsed}</span>
      `}),
      el('div', { className: 'card-actions' }, [
        el('button', {
          className: 'btn btn-primary btn-sm',
          textContent: 'Abrir Terminal',
          onClick: () => {
            TerminalManager.open(s.id);
            document.getElementById('terminal-title').textContent = `Sessao ${s.id.slice(0, 8)}`;
          },
        }),
        el('button', {
          className: 'btn btn-danger btn-sm',
          textContent: 'Parar',
          onClick: async () => {
            try {
              await API.stopSession(s.id);
              showToast('Sessao parada');
              renderActivePage(container);
              updateActiveCount();
            } catch (err) {
              showToast(err.message, 'error');
            }
          },
        }),
      ]),
    ]);
    grid.appendChild(card);
  }

  container.appendChild(grid);
}

// ─── History Page ───

let _historyFilter = 'all';

async function renderHistoryPage(container) {
  container.innerHTML = '';

  // Header with title + actions
  const header = el('div', { className: 'page-title' }, [
    el('span', { textContent: 'Historico' }),
    el('div', { style: { display: 'flex', gap: '8px' } }, [
      el('button', {
        className: 'btn btn-sm',
        textContent: 'Atualizar',
        onClick: () => renderHistoryPage(container),
      }),
      el('button', {
        className: 'btn btn-danger btn-sm',
        textContent: 'Limpar',
        onClick: async () => {
          if (!confirm('Limpar historico de sessoes?')) return;
          try {
            await API.clearHistory();
            showToast('Historico limpo');
            renderHistoryPage(container);
          } catch (err) {
            showToast(err.message, 'error');
          }
        },
      }),
    ]),
  ]);
  container.appendChild(header);

  let sessions;
  try {
    sessions = await API.getSessionHistory();
  } catch (err) {
    container.appendChild(el('div', { className: 'empty-state', innerHTML: `<p>Erro: ${err.message}</p>` }));
    return;
  }

  if (sessions.length === 0) {
    container.appendChild(el('div', { className: 'empty-state', innerHTML: '<p>Nenhuma sessao no historico.</p>' }));
    return;
  }

  // Sort by startedAt descending
  sessions.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  // Filter tabs
  const filters = ['all', 'completed', 'crashed', 'stopped'];
  const filterLabels = { all: 'Todas', completed: 'Completadas', crashed: 'Crashadas', stopped: 'Paradas' };
  const filterBar = el('div', { className: 'filter-bar' });
  for (const f of filters) {
    const count = f === 'all' ? sessions.length : sessions.filter(s => s.status === f).length;
    filterBar.appendChild(el('button', {
      className: `btn btn-sm btn-filter ${_historyFilter === f ? 'active' : ''}`,
      textContent: `${filterLabels[f]} (${count})`,
      onClick: () => {
        _historyFilter = f;
        renderHistoryPage(container);
      },
    }));
  }
  container.appendChild(filterBar);

  // Apply filter
  const filtered = _historyFilter === 'all'
    ? sessions
    : sessions.filter(s => s.status === _historyFilter);

  if (filtered.length === 0) {
    container.appendChild(el('div', { className: 'empty-state', innerHTML: '<p>Nenhuma sessao com este filtro.</p>' }));
    return;
  }

  const tableContainer = el('div', { className: 'table-container' });
  const table = el('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Perfil</th>
        <th>Modo</th>
        <th>Status</th>
        <th>Inicio</th>
        <th>Duracao</th>
        <th>Exit</th>
        <th>Acoes</th>
      </tr>
    </thead>
  `;

  const tbody = el('tbody');
  for (const s of filtered) {
    const tr = el('tr');
    const statusClass = s.status || 'stopped';

    const tdProfile = el('td', { textContent: s.profileName || '-' });
    const tdMode = el('td');
    tdMode.innerHTML = `<span class="status-tag ${s.mode === 'bypass' ? 'crashed' : 'completed'}">${s.mode || 'normal'}</span>`;
    const tdStatus = el('td');
    tdStatus.innerHTML = `<span class="status-tag ${statusClass}">${s.status || '-'}</span>`;
    const tdStart = el('td', { textContent: new Date(s.startedAt).toLocaleString() });
    const tdDur = el('td', { textContent: s.durationSeconds ? formatDuration(s.durationSeconds) : '-' });
    const tdExit = el('td', { textContent: (s.exitCode !== null && s.exitCode !== undefined) ? s.exitCode : '-' });

    // Action buttons
    const tdActions = el('td', { className: 'history-actions' });

    // View Output button
    tdActions.appendChild(el('button', {
      className: 'btn btn-sm',
      textContent: 'Output',
      onClick: async () => {
        try {
          const { output } = await API.getSessionOutputData(s.id);
          TerminalManager.openReadOnly(
            `${s.profileName || 'Sessao'} - ${s.id.slice(0, 8)} (historico)`,
            output
          );
        } catch (err) {
          showToast(err.message, 'error');
        }
      },
    }));

    // Resume button (only for crashed/stopped, not running or completed)
    if (s.status === 'crashed' || s.status === 'stopped') {
      tdActions.appendChild(el('button', {
        className: 'btn btn-success btn-sm',
        textContent: 'Retomar',
        onClick: async () => {
          try {
            const newSession = await API.resumeSession(s.id);
            showToast('Sessao retomada!');
            TerminalManager.open(newSession.id);
            document.getElementById('terminal-title').textContent =
              `${newSession.profileName} - ${newSession.id.slice(0, 8)}`;
            updateActiveCount();
          } catch (err) {
            showToast(err.message, 'error');
          }
        },
      }));
    }

    tr.appendChild(tdProfile);
    tr.appendChild(tdMode);
    tr.appendChild(tdStatus);
    tr.appendChild(tdStart);
    tr.appendChild(tdDur);
    tr.appendChild(tdExit);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  tableContainer.appendChild(table);
  container.appendChild(tableContainer);
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
