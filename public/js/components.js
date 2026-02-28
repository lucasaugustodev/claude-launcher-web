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
        ${p.githubRepo ? `<span style="color:var(--success)">Repo: ${p.githubRepo} (${p.syncStrategy === 'main' ? 'commit direto' : 'branch+PR'})</span>` : ''}
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

    // Resume button (for any non-running session)
    if (s.status !== 'running') {
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

// ═══════════════════════════════════════════
// File Manager Page
// ═══════════════════════════════════════════

let _fmCurrentPath = '/home';

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
  const parts = currentPath.split('/').filter(Boolean);
  const bc = el('div', { className: 'fm-breadcrumbs' });

  bc.appendChild(el('span', {
    className: 'fm-crumb clickable',
    textContent: '/',
    onClick: () => { _fmCurrentPath = '/'; loadDirectory('/', container); },
  }));

  let accumulated = '';
  for (let i = 0; i < parts.length; i++) {
    accumulated += '/' + parts[i];
    const p = accumulated;

    bc.appendChild(el('span', { className: 'fm-sep', textContent: ' / ' }));

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
            await API.createDirectory(_fmCurrentPath + '/' + name);
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

async function renderFileManagerPage(container) {
  container.innerHTML = '';

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

async function renderGitHubCLIPage(container) {
  container.innerHTML = '';
  container.appendChild(el('h2', { textContent: 'GitHub CLI' }));

  const statusCard = el('div', { className: 'card', innerHTML: '<p style="color:var(--text-muted)">Verificando...</p>' });
  container.appendChild(statusCard);

  try {
    const status = await API.getGitHubCLIStatus();
    renderGitHubCLIStatus(container, statusCard, status);
  } catch (err) {
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
          TerminalManager.open(result.sessionId);
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

async function renderClineCliPage(container) {
  container.innerHTML = '';
  container.appendChild(el('h2', { textContent: 'Cline CLI' }));

  const statusCard = el('div', {
    className: 'card',
    innerHTML: '<p style="color:var(--text-muted)">Verificando...</p>',
  });
  container.appendChild(statusCard);

  try {
    const status = await API.getClineCLIStatus();
    renderClineCliStatus(container, statusCard, status);
  } catch (err) {
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
          TerminalManager.open(result.sessionId);
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
            TerminalManager.open(result.sessionId);
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
          TerminalManager.open(session.id);
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
              TerminalManager.open(s.id);
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
            TerminalManager.openReadOnly(
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
