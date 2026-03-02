// ─── App (Preact + HTM) ───

const { h, render: preactRender } = preact;
const { useState, useEffect, useRef, useCallback } = preactHooks;
const html = htm.bind(h);

// ─── Legacy Page Wrapper ───
// Wraps old-style render functions as Preact components.
// When Preact unmounts this, the container is detached from DOM,
// so any stale async appends from the old function are harmless.

function LegacyPage({ renderFn }) {
  const ref = useRef(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.innerHTML = '';
    renderFn(c);
    return () => { c.innerHTML = ''; };
  }, [renderFn]);

  return html`<div ref=${ref} style="display:contents"></div>`;
}

// ─── Profiles Page (Preact) ───

function ProfilesPage() {
  const [profiles, setProfiles] = useState(null);

  const load = useCallback(async () => {
    try { setProfiles(await API.getProfiles()); }
    catch { setProfiles([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return html`
    <div class="page-title">
      <span>Projetos</span>
      <button class="btn btn-primary" onClick=${() => {
        showProfileModal(null, async (data) => {
          try {
            await API.createProfile(data);
            showToast('Projeto criado!');
            load();
          } catch (err) { showToast(err.message, 'error'); }
        });
      }}>+ Novo Projeto</button>
    </div>
    ${!profiles
      ? html`<div class="empty-state"><p>Carregando...</p></div>`
      : profiles.length === 0
        ? html`<div class="empty-state"><p>Nenhum projeto criado.<br/>Crie um projeto para lancar sessoes do Claude.</p></div>`
        : html`<div class="card-grid">
            ${profiles.map(p => html`
              <div class="card" key=${p.id}>
                <div class="card-title">${p.name}</div>
                <div class="card-meta">
                  <span>Modo: ${p.mode === 'bypass' ? 'Bypass' : 'Normal'}</span>
                  <span>Dir: ${p.workingDirectory || '(padrao)'}</span>
                  ${p.initialPrompt ? html`<span>Prompt: ${p.initialPrompt.substring(0, 50)}...</span>` : null}
                  ${p.githubRepo ? html`<span style="color:var(--success)">Repo: ${p.githubRepo} (${p.syncStrategy === 'main' ? 'commit direto' : 'branch+PR'})</span>` : null}
                </div>
                <div class="card-actions">
                  <button class="btn btn-success btn-sm" onClick=${async () => {
                    try {
                      const session = await API.launchSession(p.id, { streamJson: isMobileView() });
                      showToast('Sessao lancada!');
                      getViewManager().open(session.id, { streamJson: isMobileView() });
                      document.getElementById('terminal-title').textContent = p.name + ' - ' + session.id.slice(0, 8);
                      updateActiveCount();
                    } catch (err) { showToast(err.message, 'error'); }
                  }}>Lancar</button>
                  <button class="btn btn-sm" onClick=${() => {
                    showProfileModal(p, async (data) => {
                      try {
                        await API.updateProfile(p.id, data);
                        showToast('Projeto atualizado!');
                        load();
                      } catch (err) { showToast(err.message, 'error'); }
                    });
                  }}>Editar</button>
                  <button class="btn btn-danger btn-sm" onClick=${async () => {
                    if (!confirm('Excluir este projeto?')) return;
                    try {
                      await API.deleteProfile(p.id);
                      showToast('Projeto excluido');
                      load();
                    } catch (err) { showToast(err.message, 'error'); }
                  }}>Excluir</button>
                </div>
              </div>
            `)}
          </div>`
    }
  `;
}

// ─── Active Sessions Page (Preact) ───

function ActivePage() {
  const [sessions, setSessions] = useState(null);

  const load = useCallback(async () => {
    try { setSessions(await API.getActiveSessions()); }
    catch { setSessions([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh on session exit (WS event)
  useEffect(() => {
    const handler = () => { load(); updateActiveCount(); };
    API.on('terminal:exit', handler);
    return () => API.off('terminal:exit', handler);
  }, [load]);

  return html`
    <div class="page-title">
      <span>Sessoes Ativas</span>
      <button class="btn btn-sm" onClick=${load}>Atualizar</button>
    </div>
    ${!sessions
      ? html`<div class="empty-state"><p>Carregando...</p></div>`
      : sessions.length === 0
        ? html`<div class="empty-state"><p>Nenhuma sessao ativa.<br/>Lance uma sessao a partir dos Projetos.</p></div>`
        : html`<div class="card-grid">
            ${sessions.map(s => html`
              <div class="card" key=${s.id}>
                <div class="card-title">Sessao ${s.id.slice(0, 8)}</div>
                <div class="card-meta">
                  <span>PID: ${s.pid}</span>
                  <span>Inicio: ${new Date(s.startedAt).toLocaleString()}</span>
                  <span>Tempo: ${formatDuration(s.elapsedSeconds)}</span>
                </div>
                <div class="card-actions">
                  <button class="btn btn-primary btn-sm" onClick=${() => {
                    getViewManager().open(s.id, { streamJson: isMobileView() });
                    document.getElementById('terminal-title').textContent = 'Sessao ' + s.id.slice(0, 8);
                  }}>Abrir Terminal</button>
                  <button class="btn btn-danger btn-sm" onClick=${async () => {
                    try {
                      await API.stopSession(s.id);
                      showToast('Sessao parada');
                      updateActiveCount();
                    } catch (err) { showToast(err.message, 'error'); }
                  }}>Parar</button>
                </div>
              </div>
            `)}
          </div>`
    }
  `;
}

// ─── History Page (Preact) ───

function HistoryPage() {
  const [sessions, setSessions] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      const data = await API.getSessionHistory();
      data.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
      setSessions(data);
    } catch { setSessions([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filters = ['all', 'completed', 'crashed', 'stopped'];
  const filterLabels = { all: 'Todas', completed: 'Completadas', crashed: 'Crashadas', stopped: 'Paradas' };
  const filtered = !sessions ? [] : filter === 'all' ? sessions : sessions.filter(s => s.status === filter);

  return html`
    <div class="page-title">
      <span>Historico</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm" onClick=${load}>Atualizar</button>
        <button class="btn btn-danger btn-sm" onClick=${async () => {
          if (!confirm('Limpar historico de sessoes?')) return;
          try { await API.clearHistory(); showToast('Historico limpo'); load(); }
          catch (err) { showToast(err.message, 'error'); }
        }}>Limpar</button>
      </div>
    </div>
    ${!sessions
      ? html`<div class="empty-state"><p>Carregando...</p></div>`
      : sessions.length === 0
        ? html`<div class="empty-state"><p>Nenhuma sessao no historico.</p></div>`
        : html`
          <div class="filter-bar">
            ${filters.map(f => {
              const count = f === 'all' ? sessions.length : sessions.filter(s => s.status === f).length;
              return html`<button class="btn btn-sm btn-filter ${filter === f ? 'active' : ''}"
                onClick=${() => setFilter(f)}>${filterLabels[f]} (${count})</button>`;
            })}
          </div>
          ${filtered.length === 0
            ? html`<div class="empty-state"><p>Nenhuma sessao com este filtro.</p></div>`
            : html`<div class="table-container">
                <table>
                  <thead><tr>
                    <th>Projeto</th><th>Modo</th><th>Status</th><th>Inicio</th><th>Duracao</th><th>Exit</th><th>Acoes</th>
                  </tr></thead>
                  <tbody>
                    ${filtered.map(s => html`
                      <tr key=${s.id}>
                        <td>${s.profileName || '-'}</td>
                        <td><span class="status-tag ${s.mode === 'bypass' ? 'crashed' : 'completed'}">${s.mode || 'normal'}</span></td>
                        <td><span class="status-tag ${s.status || 'stopped'}">${s.status || '-'}</span></td>
                        <td>${new Date(s.startedAt).toLocaleString()}</td>
                        <td>${s.durationSeconds ? formatDuration(s.durationSeconds) : '-'}</td>
                        <td>${s.exitCode !== null && s.exitCode !== undefined ? s.exitCode : '-'}</td>
                        <td class="history-actions">
                          <button class="btn btn-sm" onClick=${async () => {
                            try {
                              const data = await API.getSessionOutputData(s.id);
                              getViewManager().openReadOnly(
                                (s.profileName || 'Sessao') + ' - ' + s.id.slice(0, 8) + ' (historico)',
                                data.output
                              );
                            } catch (err) { showToast(err.message, 'error'); }
                          }}>Output</button>
                          ${s.status !== 'running' ? html`
                            <button class="btn btn-success btn-sm" onClick=${async () => {
                              try {
                                const ns = await API.resumeSession(s.id, { streamJson: isMobileView() });
                                showToast('Sessao retomada!');
                                getViewManager().open(ns.id, { streamJson: isMobileView() });
                                document.getElementById('terminal-title').textContent =
                                  ns.profileName + ' - ' + ns.id.slice(0, 8);
                                updateActiveCount();
                              } catch (err) { showToast(err.message, 'error'); }
                            }}>Retomar</button>
                          ` : null}
                        </td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>`
          }
        `
    }
  `;
}

// ─── Setup Page ───

function SetupPage({ onDone }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');

  const doSetup = async () => {
    if (!user || user.length < 3) { showToast('Usuario deve ter no minimo 3 caracteres', 'error'); return; }
    if (!pass || pass.length < 4) { showToast('Senha deve ter no minimo 4 caracteres', 'error'); return; }
    if (pass !== pass2) { showToast('Senhas nao conferem', 'error'); return; }
    try {
      await API.setup(user, pass);
      showToast('Conta criada com sucesso!');
      onDone();
    } catch (err) { showToast(err.message, 'error'); }
  };

  return html`
    <div style="max-width:400px;margin:60px auto">
      <h2 style="text-align:center;margin-bottom:8px;color:var(--accent)">Claude Launcher</h2>
      <p style="text-align:center;color:var(--text-muted);margin-bottom:24px;font-size:14px">Primeiro acesso - crie sua conta</p>
      <div class="card">
        <div class="form-group"><label>Usuario</label>
          <input type="text" value=${user} onInput=${e => setUser(e.target.value)} placeholder="Seu usuario" /></div>
        <div class="form-group"><label>Senha</label>
          <input type="password" value=${pass} onInput=${e => setPass(e.target.value)} placeholder="Sua senha" /></div>
        <div class="form-group"><label>Confirmar Senha</label>
          <input type="password" value=${pass2} onInput=${e => setPass2(e.target.value)} placeholder="Repita a senha"
            onKeyDown=${e => { if (e.key === 'Enter') doSetup(); }} /></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" onClick=${doSetup}>Criar Conta</button>
      </div>
    </div>
  `;
}

// ─── Login Page ───

function LoginPage({ onDone }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');

  const doLogin = async () => {
    if (!user || !pass) { showToast('Preencha usuario e senha', 'error'); return; }
    try {
      await API.login(user, pass);
      onDone();
    } catch (err) { showToast(err.message, 'error'); }
  };

  return html`
    <div style="max-width:360px;margin:80px auto">
      <h2 style="text-align:center;margin-bottom:24px;color:var(--accent)">Claude Launcher</h2>
      <div class="card">
        <div class="form-group"><label>Usuario</label>
          <input type="text" value=${user} onInput=${e => setUser(e.target.value)} placeholder="Seu usuario" /></div>
        <div class="form-group"><label>Senha</label>
          <input type="password" value=${pass} onInput=${e => setPass(e.target.value)} placeholder="Sua senha"
            onKeyDown=${e => { if (e.key === 'Enter') doLogin(); }} /></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" onClick=${doLogin}>Entrar</button>
      </div>
    </div>
  `;
}

// ─── Marketplace Page (Preact) ───

function MarketplacePage() {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await API.getMarketplaceCatalog();
      setCatalog(data);
    } catch (err) {
      showToast('Erro ao carregar catalogo: ' + err.message, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setBusyKey = (key, val) => setBusy(prev => ({ ...prev, [key]: val }));

  // Refresh agent pack from GitHub
  const refreshPack = async (packId) => {
    setBusyKey('refresh-' + packId, true);
    try {
      await API.refreshAgentPack(packId);
      showToast('Catalogo atualizado do GitHub');
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setBusyKey('refresh-' + packId, false);
  };

  // Install all agents from pack
  const installAll = async (packId) => {
    setBusyKey('all-' + packId, true);
    try {
      const result = await API.installAgents(packId);
      showToast(`${result.installed.length} agentes instalados!`);
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setBusyKey('all-' + packId, false);
  };

  // Install single agent
  const installAgent = async (packId, filename) => {
    setBusyKey('agent-' + filename, true);
    try {
      await API.installAgents(packId, [filename]);
      showToast('Agente instalado!');
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setBusyKey('agent-' + filename, false);
  };

  // Uninstall single agent
  const uninstallAgent = async (filename) => {
    setBusyKey('agent-' + filename, true);
    try {
      await API.uninstallAgent(filename);
      showToast('Agente removido');
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setBusyKey('agent-' + filename, false);
  };

  // Install plugin
  const installPlugin = async (pluginId) => {
    setBusyKey('plugin-' + pluginId, true);
    try {
      const result = await API.installPlugin(pluginId);
      showToast(`Plugin instalado! v${result.version}`);
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setBusyKey('plugin-' + pluginId, false);
  };

  // Uninstall plugin
  const uninstallPlugin = async (pluginId) => {
    if (!confirm('Remover este plugin?')) return;
    setBusyKey('plugin-' + pluginId, true);
    try {
      await API.uninstallPlugin(pluginId);
      showToast('Plugin removido');
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setBusyKey('plugin-' + pluginId, false);
  };

  if (loading && !catalog) {
    return html`<div class="empty-state"><p>Carregando catalogo...</p></div>`;
  }

  if (!catalog) {
    return html`<div class="empty-state"><p>Erro ao carregar catalogo</p></div>`;
  }

  const modelColors = { opus: '#cba6f7', sonnet: '#89b4fa', haiku: '#a6e3a1' };

  return html`
    <div class="page-title">
      <span>Marketplace</span>
      <button class="btn btn-sm" onClick=${load}>Atualizar</button>
    </div>

    ${catalog.agentPacks.map(pack => html`
      <div key=${pack.id} style="margin-bottom:32px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
          <h3 style="margin:0;font-size:18px">${pack.name}</h3>
          <span class="status-tag ${pack.cached ? 'completed' : 'stopped'}" style="font-size:11px">
            ${pack.cached ? pack.agents.length + ' agentes' : 'Nao carregado'}
          </span>
          <div style="display:flex;gap:6px;margin-left:auto">
            <button class="btn btn-sm" onClick=${() => refreshPack(pack.id)}
              disabled=${busy['refresh-' + pack.id]}>
              ${busy['refresh-' + pack.id] ? 'Baixando...' : 'Baixar do GitHub'}
            </button>
            ${pack.cached && html`
              <button class="btn btn-primary btn-sm" onClick=${() => installAll(pack.id)}
                disabled=${busy['all-' + pack.id]}>
                ${busy['all-' + pack.id] ? 'Instalando...' : 'Instalar Todos'}
              </button>
            `}
          </div>
        </div>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:12px">
          Repo: <a href=${'https://github.com/' + pack.repo} target="_blank" style="color:var(--accent)">${pack.repo}</a>
          ${' — ' + pack.description}
        </p>

        ${pack.cached && pack.agents.length > 0 ? html`
          <div class="card-grid">
            ${pack.agents.map(agent => html`
              <div key=${agent.filename} class="card" style="position:relative">
                <div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span>${agent.name}</span>
                  <span class="status-tag" style=${'font-size:10px;background:' + (modelColors[agent.model] || '#89b4fa') + ';color:#1e1e2e'}>
                    ${(agent.model || 'sonnet').toUpperCase()}
                  </span>
                  ${agent.installed && html`
                    <span class="status-tag completed" style="font-size:10px">Instalado</span>
                  `}
                </div>
                <div class="card-meta">
                  <span>${agent.description || 'Sem descricao'}</span>
                </div>
                <div class="card-actions">
                  ${agent.installed ? html`
                    <button class="btn btn-danger btn-sm" onClick=${() => uninstallAgent(agent.filename)}
                      disabled=${busy['agent-' + agent.filename]}>
                      ${busy['agent-' + agent.filename] ? '...' : 'Remover'}
                    </button>
                  ` : html`
                    <button class="btn btn-success btn-sm" onClick=${() => installAgent(pack.id, agent.filename)}
                      disabled=${busy['agent-' + agent.filename]}>
                      ${busy['agent-' + agent.filename] ? 'Instalando...' : 'Instalar'}
                    </button>
                  `}
                </div>
              </div>
            `)}
          </div>
        ` : !pack.cached && html`
          <div class="empty-state" style="padding:24px">
            <p>Clique em "Baixar do GitHub" para carregar a lista de agentes</p>
          </div>
        `}
      </div>
    `)}

    <div style="margin-bottom:32px">
      <h3 style="margin-bottom:16px;font-size:18px">Plugins</h3>
      <div class="card-grid">
        ${catalog.plugins.map(plugin => html`
          <div key=${plugin.id} class="card">
            <div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span>${plugin.name}</span>
              ${plugin.installed ? html`
                <span class="status-tag completed" style="font-size:10px">v${plugin.version}</span>
              ` : html`
                <span class="status-tag stopped" style="font-size:10px">Nao instalado</span>
              `}
            </div>
            <div class="card-meta">
              <span>${plugin.description}</span>
              <span>
                <a href=${'https://github.com/' + plugin.repo} target="_blank" style="color:var(--accent);font-size:12px">${plugin.repo}</a>
              </span>
            </div>
            <div class="card-actions">
              ${plugin.installed ? html`
                <button class="btn btn-danger btn-sm" onClick=${() => uninstallPlugin(plugin.id)}
                  disabled=${busy['plugin-' + plugin.id]}>
                  ${busy['plugin-' + plugin.id] ? '...' : 'Remover'}
                </button>
              ` : html`
                <button class="btn btn-success btn-sm" onClick=${() => installPlugin(plugin.id)}
                  disabled=${busy['plugin-' + plugin.id]}>
                  ${busy['plugin-' + plugin.id] ? 'Instalando...' : 'Instalar'}
                </button>
              `}
            </div>
          </div>
        `)}
      </div>
    </div>
  `;
}

// ─── Schedules Page (Preact) ───

function SchedulePage() {
  const [tab, setTab] = useState('schedules');
  const [schedules, setSchedules] = useState(null);
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState({});

  const loadSchedules = useCallback(async () => {
    try { setSchedules(await API.getSchedules()); }
    catch { setSchedules([]); }
  }, []);

  const loadLog = useCallback(async () => {
    try { setLog(await API.getScheduleLog()); }
    catch { setLog([]); }
  }, []);

  useEffect(() => {
    loadSchedules();
    loadLog();
  }, [loadSchedules, loadLog]);

  // WebSocket events for real-time updates
  useEffect(() => {
    const onStarted = () => { loadSchedules(); loadLog(); };
    const onCompleted = () => { loadSchedules(); loadLog(); };
    const onSkipped = (msg) => { showToast('Agendamento "' + (msg.scheduleName || '') + '" pulado (sessao anterior ativa)', 'error'); loadLog(); };
    API.on('schedule:started', onStarted);
    API.on('schedule:completed', onCompleted);
    API.on('schedule:skipped', onSkipped);
    return () => {
      API.off('schedule:started', onStarted);
      API.off('schedule:completed', onCompleted);
      API.off('schedule:skipped', onSkipped);
    };
  }, [loadSchedules, loadLog]);

  const typeLabel = (s) => {
    if (s.type === 'interval') return 'A cada ' + s.intervalMinutes + ' min';
    if (s.type === 'once') return 'Uma vez: ' + new Date(s.runAt).toLocaleString();
    if (s.type === 'cron' && s.cron) {
      const cp = s.cron.trim().split(/\s+/);
      if (cp.length === 5) {
        if (cp[0] === '0' && /^\*\/\d+$/.test(cp[1]) && cp[2] === '*' && cp[3] === '*' && cp[4] === '*')
          return 'A cada ' + cp[1].replace('*/', '') + 'h';
        const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
        const hora = (cp[1] || '0').padStart(2, '0') + ':' + (cp[0] || '0').padStart(2, '0');
        if (cp[2] === '*' && cp[3] === '*' && cp[4] === '*')
          return 'Diario as ' + hora;
        if (cp[2] === '*' && cp[3] === '*' && cp[4] !== '*')
          return (dias[parseInt(cp[4])] || cp[4]) + ' as ' + hora;
        if (cp[2] !== '*' && cp[3] === '*' && cp[4] === '*')
          return 'Dia ' + cp[2] + ' as ' + hora;
      }
      return 'Cron: ' + s.cron;
    }
    return s.type;
  };

  const targetLabel = (s) => {
    if (s.targetType === 'profile') return 'Perfil';
    if (s.targetType === 'agent') return 'Agente';
    if (s.targetType === 'apm') return 'APM';
    return s.targetType;
  };

  const statusBadge = (status) => {
    const colors = { completed: '#a6e3a1', failed: '#f38ba8', skipped: '#f9e2af', running: '#89b4fa' };
    return html`<span style="color:${colors[status] || '#cdd6f4'};font-weight:600">${status}</span>`;
  };

  const formatDuration = (start, end) => {
    if (!start || !end) return '-';
    const ms = new Date(end) - new Date(start);
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  };

  return html`
    <div class="page-title">
      <span>Agendamentos</span>
      <button class="btn btn-primary" onClick=${() => {
        showScheduleModal(null, async (data) => {
          try {
            await API.createSchedule(data);
            showToast('Agendamento criado!');
            loadSchedules();
          } catch (err) { showToast(err.message, 'error'); }
        });
      }}>+ Novo Agendamento</button>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn btn-sm ${tab === 'schedules' ? 'btn-primary' : ''}" onClick=${() => setTab('schedules')}>Agendamentos</button>
      <button class="btn btn-sm ${tab === 'log' ? 'btn-primary' : ''}" onClick=${() => { setTab('log'); loadLog(); }}>Log de Execucoes</button>
    </div>

    ${tab === 'schedules' ? html`
      ${!schedules
        ? html`<div class="empty-state"><p>Carregando...</p></div>`
        : schedules.length === 0
          ? html`<div class="empty-state"><p>Nenhum agendamento criado.</p></div>`
          : html`<div class="card-grid">
              ${schedules.map(s => html`
                <div class="card" key=${s.id} style="border-left:3px solid ${s.enabled ? (s.isRunning ? '#89b4fa' : '#a6e3a1') : '#585b70'}">
                  <div class="card-title" style="display:flex;align-items:center;gap:8px">
                    ${s.isRunning ? html`<span style="color:#89b4fa">&#9654;</span>` : null}
                    ${s.name}
                    <span style="font-size:11px;color:${s.enabled ? '#a6e3a1' : '#585b70'};margin-left:auto">${s.enabled ? 'Ativo' : 'Inativo'}</span>
                  </div>
                  <div class="card-meta">
                    <span>${targetLabel(s)}: ${s.targetId}</span>
                    <span>${typeLabel(s)}</span>
                    ${s.lastRun ? html`<span>Ultima exec: ${new Date(s.lastRun).toLocaleString()}</span>` : null}
                  </div>
                  <div class="card-actions">
                    <button class="btn btn-sm ${s.enabled ? 'btn-danger' : 'btn-success'}" disabled=${busy[s.id]}
                      onClick=${async () => {
                        setBusy(b => ({ ...b, [s.id]: true }));
                        try {
                          await API.toggleSchedule(s.id);
                          showToast(s.enabled ? 'Desativado' : 'Ativado');
                          await loadSchedules();
                        } catch (err) { showToast(err.message, 'error'); }
                        setBusy(b => ({ ...b, [s.id]: false }));
                      }}>${s.enabled ? 'Desativar' : 'Ativar'}</button>
                    <button class="btn btn-sm btn-success" disabled=${busy[s.id] || s.isRunning}
                      onClick=${async () => {
                        setBusy(b => ({ ...b, [s.id]: true }));
                        try {
                          await API.runScheduleNow(s.id);
                          showToast('Executando "' + s.name + '"');
                          await loadSchedules();
                        } catch (err) { showToast(err.message, 'error'); }
                        setBusy(b => ({ ...b, [s.id]: false }));
                      }}>Executar Agora</button>
                    <button class="btn btn-sm" onClick=${() => {
                      showScheduleModal(s, async (data) => {
                        try {
                          await API.updateSchedule(s.id, data);
                          showToast('Agendamento atualizado!');
                          loadSchedules();
                        } catch (err) { showToast(err.message, 'error'); }
                      });
                    }}>Editar</button>
                    <button class="btn btn-danger btn-sm" onClick=${async () => {
                      if (!confirm('Excluir agendamento "' + s.name + '"?')) return;
                      try {
                        await API.deleteSchedule(s.id);
                        showToast('Agendamento excluido');
                        loadSchedules();
                      } catch (err) { showToast(err.message, 'error'); }
                    }}>Excluir</button>
                  </div>
                </div>
              `)}
            </div>`
      }
    ` : html`
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        <button class="btn btn-sm btn-danger" onClick=${async () => {
          if (!confirm('Limpar todo o log de execucoes?')) return;
          try {
            await API.clearScheduleLog();
            showToast('Log limpo');
            loadLog();
          } catch (err) { showToast(err.message, 'error'); }
        }}>Limpar Log</button>
      </div>
      ${!log
        ? html`<div class="empty-state"><p>Carregando...</p></div>`
        : log.length === 0
          ? html`<div class="empty-state"><p>Nenhuma execucao registrada.</p></div>`
          : html`<div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                  <tr style="border-bottom:1px solid #45475a;text-align:left">
                    <th style="padding:8px">Data/Hora</th>
                    <th style="padding:8px">Agendamento</th>
                    <th style="padding:8px">Target</th>
                    <th style="padding:8px">Status</th>
                    <th style="padding:8px">Duracao</th>
                  </tr>
                </thead>
                <tbody>
                  ${log.map(entry => html`
                    <tr key=${entry.id} style="border-bottom:1px solid #313244">
                      <td style="padding:8px;white-space:nowrap">${new Date(entry.startedAt).toLocaleString()}</td>
                      <td style="padding:8px">${entry.scheduleName}</td>
                      <td style="padding:8px">${entry.targetName || entry.targetType}</td>
                      <td style="padding:8px">${statusBadge(entry.status)}</td>
                      <td style="padding:8px">${formatDuration(entry.startedAt, entry.completedAt)}</td>
                    </tr>
                  `)}
                </tbody>
              </table>
            </div>`
      }
    `}
  `;
}

// ─── Content Router ───

function ContentRouter({ page }) {
  switch (page) {
    case 'profiles': return html`<${ProfilesPage} />`;
    case 'active': return html`<${ActivePage} />`;
    case 'history': return html`<${HistoryPage} />`;
    case 'marketplace': return html`<${MarketplacePage} />`;
    case 'schedules': return html`<${SchedulePage} />`;
    case 'files': return html`<${LegacyPage} renderFn=${renderFileManagerPage} />`;
    case 'github-cli': return html`<${LegacyPage} renderFn=${renderGitHubCLIPage} />`;
    case 'cline-cli': return html`<${LegacyPage} renderFn=${renderClineCliPage} />`;
    case 'gemini-cli': return html`<${LegacyPage} renderFn=${renderGeminiCliPage} />`;
    case 'claude-agents': return html`<${LegacyPage} renderFn=${renderClaudeAgentsPage} />`;
    case 'agent-profiles': return html`<${LegacyPage} renderFn=${renderAgentProfilesPage} />`;
    default: return null;
  }
}

// ─── Main App ───

function App() {
  const [authState, setAuthState] = useState('loading');
  const [page, setPage] = useState('profiles');

  // Boot: check auth status
  useEffect(() => {
    API.loadToken();
    API.checkAuthStatus().then(status => {
      if (status.env) API.serverEnv = status.env;
      if (status.needsSetup) setAuthState('setup');
      else if (status.loggedIn) setAuthState('app');
      else setAuthState('login');
    }).catch(() => setAuthState('error'));
  }, []);

  // When authed: show sidebar, connect WS, poll active count
  useEffect(() => {
    if (authState !== 'app') {
      document.getElementById('sidebar').style.display = 'none';
      return;
    }
    document.getElementById('sidebar').style.display = 'flex';
    API.connectWS();
    updateActiveCount();
    const interval = setInterval(updateActiveCount, 10000);
    return () => clearInterval(interval);
  }, [authState]);

  // WS status indicator
  useEffect(() => {
    const onConnect = () => {
      document.getElementById('server-status').className = 'status-dot online';
      document.getElementById('server-status-text').textContent = 'Conectado';
    };
    const onDisconnect = () => {
      document.getElementById('server-status').className = 'status-dot offline';
      document.getElementById('server-status-text').textContent = 'Desconectado';
    };
    API.on('ws:connected', onConnect);
    API.on('ws:disconnected', onDisconnect);
    return () => { API.off('ws:connected', onConnect); API.off('ws:disconnected', onDisconnect); };
  }, []);

  // Watcher indicators
  useEffect(() => {
    let commitCount = 0;
    const setIndicator = (text, color) => {
      const el = document.getElementById('watcher-indicator');
      if (!el) return;
      el.style.display = text ? 'inline' : 'none';
      el.textContent = text;
      if (color) el.style.color = color;
    };
    const onCommit = (msg) => { commitCount = msg.commitCount || (commitCount + 1); setIndicator(`Auto-sync: ${commitCount} commit(s)`, '#a6e3a1'); };
    const onClineStart = () => setIndicator('Syncing...', '#f9e2af');
    const onClineDone = (msg) => { msg.success ? setIndicator(`Auto-sync: ${commitCount} commit(s)`, '#a6e3a1') : setIndicator('Sync error', '#f38ba8'); };
    const onPr = (msg) => { if (msg.prUrl) { showToast('PR criado: ' + msg.prUrl); setIndicator('PR aberto', '#89b4fa'); } };
    API.on('watcher:commit', onCommit);
    API.on('watcher:cline-start', onClineStart);
    API.on('watcher:cline-done', onClineDone);
    API.on('watcher:pr', onPr);
    return () => {
      API.off('watcher:commit', onCommit);
      API.off('watcher:cline-start', onClineStart);
      API.off('watcher:cline-done', onClineDone);
      API.off('watcher:pr', onPr);
    };
  }, []);

  // Sidebar nav links -> update Preact page state
  useEffect(() => {
    const links = document.querySelectorAll('.nav-link');
    const appEl = document.getElementById('app');
    const closeSidebar = () => appEl.classList.remove('sidebar-open');

    const handlers = [];
    links.forEach(link => {
      const handler = (e) => {
        e.preventDefault();
        closeSidebar();
        const target = link.dataset.page;
        setPage(target);
        links.forEach(l => l.classList.toggle('active', l.dataset.page === target));
      };
      link.addEventListener('click', handler);
      handlers.push({ link, handler });
    });
    return () => handlers.forEach(({ link, handler }) => link.removeEventListener('click', handler));
  }, []);

  // Mobile sidebar toggle
  useEffect(() => {
    const toggle = document.getElementById('sidebar-toggle');
    const overlay = document.getElementById('sidebar-overlay');
    const appEl = document.getElementById('app');
    const onToggle = () => appEl.classList.toggle('sidebar-open');
    const onOverlay = () => appEl.classList.remove('sidebar-open');
    const onResize = () => { if (window.innerWidth > 768) appEl.classList.remove('sidebar-open'); };
    toggle.addEventListener('click', onToggle);
    overlay.addEventListener('click', onOverlay);
    window.addEventListener('resize', onResize);
    return () => {
      toggle.removeEventListener('click', onToggle);
      overlay.removeEventListener('click', onOverlay);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // Terminal controls
  useEffect(() => {
    const backBtn = document.getElementById('terminal-back');
    const stopBtn = document.getElementById('terminal-stop');
    const onBack = () => {
      getViewManager().close();
      const ind = document.getElementById('watcher-indicator');
      if (ind) { ind.style.display = 'none'; ind.textContent = ''; }
    };
    const onStop = async () => {
      const sessionId = getViewManager().currentSessionId;
      if (!sessionId) return;
      try { await API.stopSession(sessionId); showToast('Sessao parada'); updateActiveCount(); }
      catch (err) { showToast(err.message, 'error'); }
    };
    backBtn.onclick = onBack;
    stopBtn.onclick = onStop;
    return () => { backBtn.onclick = null; stopBtn.onclick = null; };
  }, []);

  // Auth done callback
  const onAuthDone = useCallback(() => setAuthState('app'), []);

  switch (authState) {
    case 'loading': return html`<div class="empty-state"><p>Carregando...</p></div>`;
    case 'error': return html`<div class="empty-state"><p>Servidor indisponivel. Verifique a conexao.</p></div>`;
    case 'setup': return html`<${SetupPage} onDone=${onAuthDone} />`;
    case 'login': return html`<${LoginPage} onDone=${onAuthDone} />`;
    case 'app': return html`<${ContentRouter} page=${page} />`;
    default: return null;
  }
}

// ─── Mount ───
preactRender(html`<${App} />`, document.getElementById('content'));
