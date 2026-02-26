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

    // GitHub Sync button (for ended sessions)
    if (s.status !== 'running') {
      tdActions.appendChild(el('button', {
        className: 'btn btn-sm',
        textContent: 'Sync',
        style: { color: 'var(--text-muted)', fontSize: '12px' },
        onClick: async (e) => {
          const btn = e.target;
          btn.textContent = '...';
          btn.disabled = true;
          try {
            const result = await API.syncSessionToGitHub(s.id);
            if (result.success) {
              showToast('Sincronizado com GitHub!');
            } else {
              showToast(result.error || 'GitHub nao configurado', 'error');
            }
          } catch (err) {
            showToast(err.message, 'error');
          }
          btn.textContent = 'Sync';
          btn.disabled = false;
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

// ─── GitHub Settings Page ───

async function renderGitHubPage(container) {
  container.innerHTML = '';

  const header = el('div', { className: 'page-title' }, [
    el('span', { textContent: 'GitHub Sync' }),
  ]);
  container.appendChild(header);

  let status;
  try {
    status = await API.getGitHubStatus();
  } catch (err) {
    container.appendChild(el('div', { className: 'empty-state', innerHTML: `<p>Erro: ${err.message}</p>` }));
    return;
  }

  if (status.connected && status.enabled) {
    renderGitHubConnected(container, status);
  } else {
    renderGitHubDisconnected(container);
  }
}

function renderGitHubConnected(container, status) {
  const card = el('div', { className: 'card', style: { maxWidth: '500px' } });

  const statusLine = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' } }, [
    el('span', { className: 'status-dot online' }),
    el('span', { textContent: 'Conectado', style: { color: 'var(--text-secondary)', fontSize: '13px' } }),
  ]);
  card.appendChild(statusLine);

  const info = el('div', { style: { marginBottom: '16px' } });
  info.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div><strong>Conta:</strong> ${status.owner}</div>
      <div><strong>Repositorio:</strong> <a href="https://github.com/${status.owner}/${status.repo}" target="_blank" style="color:var(--accent)">${status.owner}/${status.repo}</a></div>
      <div><strong>Sync:</strong> Automatico (cada sessao finalizada)</div>
    </div>
  `;
  card.appendChild(info);

  const actions = el('div', { style: { display: 'flex', gap: '8px' } });

  actions.appendChild(el('button', {
    className: 'btn btn-primary',
    textContent: 'Testar Conexao',
    onClick: async (e) => {
      const btn = e.target;
      btn.textContent = 'Testando...';
      btn.disabled = true;
      try {
        const result = await API.testGitHub();
        if (result.success) {
          showToast(`Conexao OK! Repo: ${result.repoName}`);
        } else {
          showToast(`Falha: ${result.error}`, 'error');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
      btn.textContent = 'Testar Conexao';
      btn.disabled = false;
    },
  }));

  actions.appendChild(el('button', {
    className: 'btn btn-danger',
    textContent: 'Desconectar',
    onClick: async () => {
      if (!confirm('Desconectar GitHub? Sessoes nao serao mais sincronizadas.')) return;
      try {
        await API.disconnectGitHub();
        showToast('GitHub desconectado');
        renderGitHubPage(container);
      } catch (err) {
        showToast(err.message, 'error');
      }
    },
  }));

  card.appendChild(actions);
  container.appendChild(card);
}

function renderGitHubDisconnected(container) {
  const card = el('div', { className: 'card', style: { maxWidth: '500px' } });

  const statusLine = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' } }, [
    el('span', { className: 'status-dot offline' }),
    el('span', { textContent: 'Desconectado', style: { color: 'var(--text-secondary)', fontSize: '13px' } }),
  ]);
  card.appendChild(statusLine);

  const desc = el('p', {
    textContent: 'Conecte sua conta GitHub para salvar sessoes automaticamente em um repositorio.',
    style: { color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px' },
  });
  card.appendChild(desc);

  // Step 1: Install app
  const step1 = el('div', { style: { marginBottom: '20px' } });
  step1.innerHTML = `
    <div style="color:var(--text-secondary);font-weight:600;margin-bottom:8px;">1. Instale o app na sua conta GitHub</div>
    <a href="https://github.com/apps/ia-hub-project/installations/new" target="_blank" class="btn btn-primary" style="display:inline-flex;text-decoration:none;">
      Instalar ia-hub-project
    </a>
    <div style="color:var(--text-muted);font-size:12px;margin-top:6px;">Abre o GitHub em nova aba. Autorize o app e volte aqui.</div>
  `;
  card.appendChild(step1);

  // Step 2: Detect
  const step2 = el('div', { style: { marginBottom: '8px' } });
  step2.innerHTML = `
    <div style="color:var(--text-secondary);font-weight:600;margin-bottom:8px;">2. Detectar instalacao</div>
  `;

  const detectBtn = el('button', {
    className: 'btn',
    textContent: 'Detectar Instalacao',
    id: 'gh-detect-btn',
    onClick: async () => {
      detectBtn.textContent = 'Buscando...';
      detectBtn.disabled = true;
      try {
        const data = await API.detectInstallations();
        renderInstallationsList(card, data.installations || []);
      } catch (err) {
        showToast(err.message, 'error');
      }
      detectBtn.textContent = 'Detectar Instalacao';
      detectBtn.disabled = false;
    },
  });
  step2.appendChild(detectBtn);
  card.appendChild(step2);

  // Installations list placeholder
  card.appendChild(el('div', { id: 'gh-installations' }));

  container.appendChild(card);
}

function renderInstallationsList(card, installations) {
  const listDiv = card.querySelector('#gh-installations');
  listDiv.innerHTML = '';

  if (installations.length === 0) {
    listDiv.innerHTML = '<p style="color:var(--text-muted);font-size:13px;margin-top:12px;">Nenhuma instalacao encontrada. Instale o app primeiro.</p>';
    return;
  }

  const container = document.getElementById('content');

  for (const inst of installations) {
    const row = el('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', marginTop: '8px',
        background: 'var(--bg-primary)', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
      },
    }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        inst.avatarUrl
          ? el('img', { src: inst.avatarUrl, style: { width: '28px', height: '28px', borderRadius: '50%' } })
          : el('span', { textContent: inst.account.slice(0, 1).toUpperCase(), style: { width: '28px', height: '28px', borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: '600' } }),
        el('div', {}, [
          el('div', { textContent: inst.account, style: { fontWeight: '500' } }),
          el('div', { textContent: `ID: ${inst.id}`, style: { fontSize: '12px', color: 'var(--text-muted)' } }),
        ]),
      ]),
      el('button', {
        className: 'btn btn-success btn-sm',
        textContent: 'Conectar',
        onClick: async (e) => {
          const btn = e.target;
          btn.textContent = 'Conectando...';
          btn.disabled = true;
          try {
            const result = await API.connectGitHub(inst.id, inst.account, inst.accountType);
            if (result.ok) {
              showToast(`Conectado! Repo: ${result.repo}`);
              renderGitHubPage(container);
            } else if (result.needsRepo) {
              // Repo doesn't exist — show create link
              const row = btn.closest('div[style]');
              let hint = row.querySelector('.repo-hint');
              if (!hint) {
                hint = el('div', { className: 'repo-hint', style: { marginTop: '8px', padding: '10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', fontSize: '13px' } });
                hint.innerHTML = `
                  <div style="color:var(--warning);margin-bottom:6px;">Repo <b>claude-sessions</b> nao encontrado.</div>
                  <a href="${result.createUrl}" target="_blank" class="btn btn-primary btn-sm" style="text-decoration:none;display:inline-flex;margin-bottom:6px;">Criar repo no GitHub</a>
                  <div style="color:var(--text-muted);font-size:12px;">Crie o repo e clique "Conectar" novamente.</div>
                `;
                row.parentElement.insertBefore(hint, row.nextSibling);
              }
            } else {
              showToast('Falha ao conectar', 'error');
            }
          } catch (err) {
            showToast(err.message, 'error');
          }
          btn.textContent = 'Conectar';
          btn.disabled = false;
        },
      }),
    ]);
    listDiv.appendChild(row);
  }
}
