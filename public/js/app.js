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
                      const session = await API.launchSession(p.id, { streamJson: true });
                      showToast('Sessao lancada!');
                      getViewManager().open(session.id, { streamJson: true });
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
                    getViewManager().open(s.id, { streamJson: true });
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
                                const ns = await API.resumeSession(s.id, { streamJson: true });
                                showToast('Sessao retomada!');
                                getViewManager().open(ns.id, { streamJson: true });
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

// ─── Onboarding Page ───

function OnboardingPage({ onDone }) {
  const [claudeStatus, setClaudeStatus] = useState(null);
  const [pollTimer, setPollTimer] = useState(null);

  // Poll Claude Code status every 3s to detect auth completion
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const s = await API.getClaudeCLIStatus();
        if (active) setClaudeStatus(s);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 3000);
    setPollTimer(t);
    return () => { active = false; clearInterval(t); };
  }, []);

  const claudeReady = claudeStatus && claudeStatus.installed && (claudeStatus.authenticated || claudeStatus.configured);

  const handleContinue = async () => {
    if (!claudeReady) {
      showToast('Faca login no Claude Code para continuar', 'error');
      return;
    }
    try {
      await fetch('/api/onboarding/complete', { method: 'POST' });
      if (pollTimer) clearInterval(pollTimer);
      onDone();
    } catch (err) {
      showToast('Erro ao salvar: ' + err.message, 'error');
    }
  };

  return html`
    <div style="max-width:560px;margin:40px auto;padding:0 16px">
      <h2 style="text-align:center;margin-bottom:8px;color:var(--accent)">Claude Launcher</h2>
      <p style="text-align:center;color:var(--text-muted);margin-bottom:8px;font-size:14px">
        Bem-vindo! Configure suas ferramentas CLI para comecar.
      </p>
      <p style="text-align:center;color:var(--text-secondary);margin-bottom:24px;font-size:13px">
        O login no <strong>Claude Code</strong> e obrigatorio. As demais ferramentas sao recomendadas.
      </p>

      <div style="position:relative">
        <div style="position:absolute;left:-8px;top:0;bottom:0;width:3px;background:${claudeReady ? 'var(--accent)' : '#f38ba8'};border-radius:2px"></div>
        <div style="padding-left:8px">
          <div style="font-size:12px;font-weight:600;color:${claudeReady ? 'var(--accent)' : '#f38ba8'};margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">
            ${claudeReady ? 'Obrigatorio - Pronto!' : 'Obrigatorio'}
          </div>
          <${ConfigToolCard}
            name="Claude Code"
            icon="\u{1F916}"
            statusFn=${() => API.getClaudeCLIStatus()}
            installFn=${(cb) => API.installClaudeCLI(cb)}
            authFn=${() => API.startClaudeCLIAuth()}
            authLabel="Login"
          />
        </div>
      </div>

      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin:16px 0 6px;text-transform:uppercase;letter-spacing:0.5px">
        Recomendado
      </div>
      <${ConfigToolCard}
        name="GitHub CLI"
        icon="\u{1F4BB}"
        statusFn=${() => API.getGitHubCLIStatus()}
        installFn=${(cb) => API.installGitHubCLI(cb)}
        authFn=${() => API.startGitHubCLIAuth()}
        authLabel="Login"
      />
      <${ConfigToolCard}
        name="Gemini CLI"
        icon="\u2728"
        statusFn=${() => API.getGeminiCLIStatus()}
        installFn=${(cb) => API.installGeminiCLI(cb)}
        authFn=${() => API.startGeminiCLIAuth()}
        authLabel="Login"
      />
      <${ConfigToolCard}
        name="Cline CLI"
        icon="\u26A1"
        statusFn=${() => API.getClineCLIStatus()}
        installFn=${(cb) => API.installClineCLI(cb)}
        authFn=${() => API.startClineCLIAuth()}
        authLabel="Login"
      />
      <${ConfigToolCard}
        name="Google Workspace CLI"
        icon="\uD83C\uDFE2"
        statusFn=${() => API.getGwsCLIStatus()}
        installFn=${(cb) => API.installGwsCLI(cb)}
        authFn=${() => API.startGwsCLIAuth()}
        authLabel="Login"
      />

      <button
        class="btn ${claudeReady ? 'btn-primary' : ''}"
        style="width:100%;justify-content:center;margin-top:20px;margin-bottom:40px;padding:12px;font-size:15px;${!claudeReady ? 'opacity:0.5;cursor:not-allowed;background:var(--surface-hover);color:var(--text-muted)' : ''}"
        onClick=${handleContinue}
        disabled=${!claudeReady}
      >
        ${claudeReady ? 'Continuar' : 'Faca login no Claude Code para continuar'}
      </button>
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

// ─── Skills Page (Preact) ───

function SkillsPage() {
  const [tab, setTab] = useState('claude');

  // Claude state
  const [skills, setSkills] = useState(null);
  const [personalDir, setPersonalDir] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState({});
  const [expandedSkill, setExpandedSkill] = useState(null);
  const [form, setForm] = useState({
    name: '', description: '', content: '', model: '',
    context: 'inline', argumentHint: '', disableModelInvocation: false, userInvocable: true,
  });

  // Gemini state
  const [gemini, setGemini] = useState(null);
  const [showGeminiForm, setShowGeminiForm] = useState(false);
  const [geminiForm, setGeminiForm] = useState({ name: '', description: '', command: '', args: '' });
  const [expandedGemini, setExpandedGemini] = useState(null);
  const [geminiEditing, setGeminiEditing] = useState(null);

  // Load Claude skills
  const loadClaude = useCallback(async () => {
    try {
      const data = await API.getSkills();
      setSkills(data.skills || []);
      setPersonalDir(data.personalDir || '~/.claude/skills/');
    } catch { setSkills([]); }
  }, []);

  // Load Gemini skills
  const loadGemini = useCallback(async () => {
    try { setGemini(await API.getGeminiSkills()); }
    catch { setGemini({ commands: [], extensions: [], geminiMd: null }); }
  }, []);

  useEffect(() => { loadClaude(); loadGemini(); }, [loadClaude, loadGemini]);

  // ── Claude handlers ──
  const resetForm = () => {
    setForm({ name: '', description: '', content: '', model: '', context: 'inline', argumentHint: '', disableModelInvocation: false, userInvocable: true });
    setShowForm(false);
    setEditing(null);
  };

  const createSkill = async () => {
    if (!form.name) { showToast('Nome e obrigatorio', 'error'); return; }
    setBusy(b => ({ ...b, create: true }));
    try { await API.createSkill(form); showToast('Skill criada!'); resetForm(); loadClaude(); }
    catch (err) { showToast(err.message, 'error'); }
    setBusy(b => ({ ...b, create: false }));
  };

  const deleteSkill = async (name) => {
    if (!confirm('Excluir skill "' + name + '"?')) return;
    try { await API.deleteSkill(name); showToast('Skill excluida'); loadClaude(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  const viewSkill = async (skill) => {
    if (expandedSkill && expandedSkill.id === skill.id) { setExpandedSkill(null); return; }
    setBusy(b => ({ ...b, ['view-' + skill.id]: true }));
    try {
      const detail = await API.getSkillDetail(skill.scope, skill.dirName);
      setExpandedSkill({ ...skill, raw: detail.raw, fullBody: detail.body });
    } catch (err) { showToast(err.message, 'error'); }
    setBusy(b => ({ ...b, ['view-' + skill.id]: false }));
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(b => ({ ...b, save: true }));
    try { await API.updateSkill(editing.dirName, editing.raw); showToast('Skill atualizada!'); setEditing(null); setExpandedSkill(null); loadClaude(); }
    catch (err) { showToast(err.message, 'error'); }
    setBusy(b => ({ ...b, save: false }));
  };

  // ── Gemini handlers ──
  const createGeminiCmd = async () => {
    if (!geminiForm.name) { showToast('Nome e obrigatorio', 'error'); return; }
    setBusy(b => ({ ...b, gcreate: true }));
    try { await API.createGeminiCommand(geminiForm); showToast('Comando Gemini criado!'); setShowGeminiForm(false); setGeminiForm({ name: '', description: '', command: '', args: '' }); loadGemini(); }
    catch (err) { showToast(err.message, 'error'); }
    setBusy(b => ({ ...b, gcreate: false }));
  };

  const deleteGeminiCmd = async (name) => {
    if (!confirm('Excluir comando "' + name + '"?')) return;
    try { await API.deleteGeminiCommand(name); showToast('Comando excluido'); loadGemini(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  const viewGeminiCmd = async (cmd) => {
    if (expandedGemini && expandedGemini.id === cmd.id) { setExpandedGemini(null); return; }
    try {
      const detail = await API.getGeminiCommand(cmd.filename.replace('.toml', ''));
      setExpandedGemini({ ...cmd, raw: detail.raw });
    } catch (err) { showToast(err.message, 'error'); }
  };

  const saveGeminiEdit = async () => {
    if (!geminiEditing) return;
    setBusy(b => ({ ...b, gsave: true }));
    try { await API.updateGeminiCommand(geminiEditing.name, geminiEditing.raw); showToast('Comando atualizado!'); setGeminiEditing(null); setExpandedGemini(null); loadGemini(); }
    catch (err) { showToast(err.message, 'error'); }
    setBusy(b => ({ ...b, gsave: false }));
  };

  const scopeLabel = (scope) => {
    if (scope === 'personal') return 'Pessoal';
    if (scope.startsWith('project:')) return 'Projeto: ' + scope.slice(8);
    return scope;
  };

  return html`
    <div class="page-title">
      <span>Skills</span>
      <button class="btn btn-sm" onClick=${() => { loadClaude(); loadGemini(); }}>Atualizar</button>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn btn-sm ${tab === 'claude' ? 'btn-primary' : ''}" onClick=${() => setTab('claude')}>
        Claude Code ${skills ? '(' + skills.length + ')' : ''}
      </button>
      <button class="btn btn-sm ${tab === 'gemini' ? 'btn-primary' : ''}" onClick=${() => setTab('gemini')}>
        Gemini CLI ${gemini ? '(' + gemini.commands.length + ' cmds, ' + gemini.extensions.length + ' ext)' : ''}
      </button>
    </div>

    ${tab === 'claude' && html`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <p style="font-size:13px;color:var(--text-muted);margin:0">
          Skills sao instrucoes em <code>SKILL.md</code>. Invoque com <code>/nome</code>.
          <span style="color:var(--accent)"> ${personalDir}</span>
        </p>
        <button class="btn btn-primary btn-sm" onClick=${() => { resetForm(); setShowForm(true); }}>+ Nova Skill</button>
      </div>

      ${showForm && html`
        <div class="card" style="margin-bottom:20px;border:1px solid var(--accent);padding:16px">
          <h3 style="margin:0 0 12px;font-size:15px;color:var(--accent)">Nova Skill Claude</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group" style="margin:0">
              <label>Nome * <span style="font-size:11px;color:var(--text-muted)">(a-z, 0-9, hifens)</span></label>
              <input type="text" value=${form.name} onInput=${e => setForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} placeholder="Ex: code-review" />
            </div>
            <div class="form-group" style="margin:0">
              <label>Modelo</label>
              <select value=${form.model} onChange=${e => setForm(f => ({ ...f, model: e.target.value }))} style="background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:8px">
                <option value="">Padrao</option><option value="opus">Opus</option><option value="sonnet">Sonnet</option><option value="haiku">Haiku</option>
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-top:12px">
            <label>Descricao</label>
            <input type="text" value=${form.description} onInput=${e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Quando Claude deve usar esta skill" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group" style="margin:0">
              <label>Contexto</label>
              <select value=${form.context} onChange=${e => setForm(f => ({ ...f, context: e.target.value }))} style="background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:8px">
                <option value="inline">Inline</option><option value="fork">Fork (subagent)</option>
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label>Argument Hint</label>
              <input type="text" value=${form.argumentHint} onInput=${e => setForm(f => ({ ...f, argumentHint: e.target.value }))} placeholder="[arquivo] [opcoes]" />
            </div>
          </div>
          <div style="display:flex;gap:16px;margin:12px 0;font-size:13px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" checked=${form.userInvocable} onChange=${e => setForm(f => ({ ...f, userInvocable: e.target.checked }))} /> Invocavel (/nome)
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" checked=${form.disableModelInvocation} onChange=${e => setForm(f => ({ ...f, disableModelInvocation: e.target.checked }))} /> Desabilitar auto-invocacao
            </label>
          </div>
          <div class="form-group">
            <label>Instrucoes (SKILL.md)</label>
            <textarea rows="6" value=${form.content} onInput=${e => setForm(f => ({ ...f, content: e.target.value }))} placeholder="# Instrucoes para o Claude..." style="font-family:monospace;font-size:13px;width:100%;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:8px;resize:vertical"></textarea>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn-sm" onClick=${resetForm}>Cancelar</button>
            <button class="btn btn-primary btn-sm" disabled=${busy.create} onClick=${createSkill}>${busy.create ? 'Criando...' : 'Criar'}</button>
          </div>
        </div>
      `}

      ${!skills
        ? html`<div class="empty-state"><p>Carregando...</p></div>`
        : skills.length === 0
          ? html`<div class="empty-state"><p>Nenhuma skill Claude encontrada.<br/><span style="font-size:13px;color:var(--text-muted)">Crie uma ou adicione em <code>${personalDir}</code></span></p></div>`
          : html`<div class="card-grid">
              ${skills.map(s => html`
                <div class="card" key=${s.id} style="border-left:3px solid ${s.scope === 'personal' ? 'var(--accent)' : 'var(--success)'}">
                  <div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span style="font-family:monospace">/${s.name}</span>
                    <span class="status-tag" style="font-size:10px;background:${s.scope === 'personal' ? 'var(--accent)' : 'var(--success)'};color:#1e1e2e">${scopeLabel(s.scope)}</span>
                    ${s.model && html`<span class="status-tag" style="font-size:10px;background:#cba6f7;color:#1e1e2e">${s.model.toUpperCase()}</span>`}
                    ${s.context === 'fork' && html`<span class="status-tag" style="font-size:10px;background:var(--warning);color:#1e1e2e">Fork</span>`}
                    ${!s.userInvocable && html`<span class="status-tag" style="font-size:10px;background:#585b70;color:#cdd6f4">Auto-only</span>`}
                  </div>
                  <div class="card-meta">
                    ${s.description && html`<span>${s.description}</span>`}
                    ${s.argumentHint && html`<span style="font-family:monospace;font-size:12px;color:var(--text-muted)">/${s.name} ${s.argumentHint}</span>`}
                    <span style="font-size:11px;color:var(--text-muted)">${s.path} (${(s.fileSize / 1024).toFixed(1)}KB)${s.supportFiles.length > 0 ? ' + ' + s.supportFiles.length + ' arquivo(s)' : ''}</span>
                  </div>
                  <div class="card-actions">
                    <button class="btn btn-sm" onClick=${() => viewSkill(s)}>${expandedSkill && expandedSkill.id === s.id ? 'Fechar' : 'Ver'}</button>
                    ${s.scope === 'personal' && html`
                      <button class="btn btn-danger btn-sm" onClick=${() => deleteSkill(s.dirName)}>Excluir</button>
                    `}
                  </div>
                  ${expandedSkill && expandedSkill.id === s.id && html`
                    <div style="margin-top:12px;background:var(--bg-primary);border-radius:6px;padding:12px">
                      ${editing && editing.id === s.id ? html`
                        <textarea rows="15" value=${editing.raw} onInput=${e => setEditing(ed => ({ ...ed, raw: e.target.value }))} style="font-family:monospace;font-size:12px;width:100%;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:8px;resize:vertical"></textarea>
                        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                          <button class="btn btn-sm" onClick=${() => setEditing(null)}>Cancelar</button>
                          <button class="btn btn-primary btn-sm" disabled=${busy.save} onClick=${saveEdit}>${busy.save ? 'Salvando...' : 'Salvar'}</button>
                        </div>
                      ` : html`
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                          <span style="font-size:12px;font-weight:600;color:var(--accent)">SKILL.md</span>
                          ${s.scope === 'personal' && html`<button class="btn btn-sm" style="font-size:11px;padding:2px 8px" onClick=${() => setEditing({ id: s.id, dirName: s.dirName, raw: expandedSkill.raw })}>Editar</button>`}
                        </div>
                        <pre style="margin:0;white-space:pre-wrap;font-size:12px;color:var(--text-primary);max-height:400px;overflow-y:auto">${expandedSkill.raw}</pre>
                      `}
                    </div>
                  `}
                </div>
              `)}
            </div>`
      }
    `}

    ${tab === 'gemini' && html`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <p style="font-size:13px;color:var(--text-muted);margin:0">
          Comandos customizados (<code>.toml</code>) e extensoes do Gemini CLI.
          ${gemini && html`<span style="color:var(--accent)"> ${gemini.commandsDir}</span>`}
        </p>
        <button class="btn btn-primary btn-sm" onClick=${() => setShowGeminiForm(true)}>+ Novo Comando</button>
      </div>

      ${showGeminiForm && html`
        <div class="card" style="margin-bottom:20px;border:1px solid #a6e3a1;padding:16px">
          <h3 style="margin:0 0 12px;font-size:15px;color:#a6e3a1">Novo Comando Gemini</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group" style="margin:0">
              <label>Nome *</label>
              <input type="text" value=${geminiForm.name} onInput=${e => setGeminiForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: analise-codigo" />
            </div>
            <div class="form-group" style="margin:0">
              <label>Descricao</label>
              <input type="text" value=${geminiForm.description} onInput=${e => setGeminiForm(f => ({ ...f, description: e.target.value }))} placeholder="O que este comando faz" />
            </div>
          </div>
          <div class="form-group" style="margin-top:12px">
            <label>Comando</label>
            <input type="text" value=${geminiForm.command} onInput=${e => setGeminiForm(f => ({ ...f, command: e.target.value }))} placeholder="Ex: /analyze" />
          </div>
          <div class="form-group">
            <label>Args template</label>
            <input type="text" value=${geminiForm.args} onInput=${e => setGeminiForm(f => ({ ...f, args: e.target.value }))} placeholder='Ex: Analise {{args}} e sugira melhorias' />
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn-sm" onClick=${() => setShowGeminiForm(false)}>Cancelar</button>
            <button class="btn btn-primary btn-sm" disabled=${busy.gcreate} onClick=${createGeminiCmd}>${busy.gcreate ? 'Criando...' : 'Criar'}</button>
          </div>
        </div>
      `}

      ${!gemini
        ? html`<div class="empty-state"><p>Carregando...</p></div>`
        : html`
          ${gemini.commands.length > 0 && html`
            <h3 style="font-size:15px;margin-bottom:12px;color:#a6e3a1">Comandos (${gemini.commands.length})</h3>
            <div class="card-grid" style="margin-bottom:24px">
              ${gemini.commands.map(cmd => html`
                <div class="card" key=${cmd.id} style="border-left:3px solid #a6e3a1">
                  <div class="card-title" style="display:flex;align-items:center;gap:8px">
                    <span style="font-family:monospace">/${cmd.name}</span>
                    <span class="status-tag" style="font-size:10px;background:#a6e3a1;color:#1e1e2e">TOML</span>
                  </div>
                  <div class="card-meta">
                    ${cmd.description && html`<span>${cmd.description}</span>`}
                    <span style="font-size:11px;color:var(--text-muted)">${cmd.path}</span>
                  </div>
                  <div class="card-actions">
                    <button class="btn btn-sm" onClick=${() => viewGeminiCmd(cmd)}>${expandedGemini && expandedGemini.id === cmd.id ? 'Fechar' : 'Ver'}</button>
                    <button class="btn btn-danger btn-sm" onClick=${() => deleteGeminiCmd(cmd.filename.replace('.toml', ''))}>Excluir</button>
                  </div>
                  ${expandedGemini && expandedGemini.id === cmd.id && html`
                    <div style="margin-top:12px;background:var(--bg-primary);border-radius:6px;padding:12px">
                      ${geminiEditing && geminiEditing.id === cmd.id ? html`
                        <textarea rows="8" value=${geminiEditing.raw} onInput=${e => setGeminiEditing(ed => ({ ...ed, raw: e.target.value }))} style="font-family:monospace;font-size:12px;width:100%;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;padding:8px;resize:vertical"></textarea>
                        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                          <button class="btn btn-sm" onClick=${() => setGeminiEditing(null)}>Cancelar</button>
                          <button class="btn btn-primary btn-sm" disabled=${busy.gsave} onClick=${saveGeminiEdit}>${busy.gsave ? 'Salvando...' : 'Salvar'}</button>
                        </div>
                      ` : html`
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                          <span style="font-size:12px;font-weight:600;color:#a6e3a1">${cmd.filename}</span>
                          <button class="btn btn-sm" style="font-size:11px;padding:2px 8px" onClick=${() => setGeminiEditing({ id: cmd.id, name: cmd.filename.replace('.toml', ''), raw: expandedGemini.raw })}>Editar</button>
                        </div>
                        <pre style="margin:0;white-space:pre-wrap;font-size:12px;color:var(--text-primary)">${expandedGemini.raw}</pre>
                      `}
                    </div>
                  `}
                </div>
              `)}
            </div>
          `}

          ${gemini.extensions.length > 0 && html`
            <h3 style="font-size:15px;margin-bottom:12px;color:var(--accent)">Extensoes (${gemini.extensions.length})</h3>
            <div class="card-grid" style="margin-bottom:24px">
              ${gemini.extensions.map(ext => html`
                <div class="card" key=${ext.id} style="border-left:3px solid var(--accent)">
                  <div class="card-title" style="display:flex;align-items:center;gap:8px">
                    <span>${ext.name}</span>
                    ${ext.version && html`<span class="status-tag completed" style="font-size:10px">v${ext.version}</span>`}
                    ${ext.skillCount > 0 && html`<span class="status-tag" style="font-size:10px;background:var(--warning);color:#1e1e2e">${ext.skillCount} skill(s)</span>`}
                  </div>
                  <div class="card-meta">
                    ${ext.description && html`<span>${ext.description}</span>`}
                    <span style="font-size:11px;color:var(--text-muted)">${ext.path}</span>
                  </div>
                </div>
              `)}
            </div>
          `}

          ${gemini.geminiMd && html`
            <h3 style="font-size:15px;margin-bottom:12px;color:var(--text-muted)">GEMINI.md</h3>
            <div class="card" style="border-left:3px solid #585b70">
              <div class="card-meta">
                <span>${gemini.geminiMd.path} (${(gemini.geminiMd.fileSize / 1024).toFixed(1)}KB)</span>
              </div>
            </div>
          `}

          ${gemini.commands.length === 0 && gemini.extensions.length === 0 && !gemini.geminiMd && html`
            <div class="empty-state">
              <p>Nenhum comando ou extensao Gemini encontrado.</p>
              <p style="font-size:13px;color:var(--text-muted)">Crie comandos em <code>~/.gemini/commands/*.toml</code><br/>ou instale extensoes com <code>gemini extensions install</code></p>
            </div>
          `}
        `
      }
    `}
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

// ─── Workflows Page (BMAD) ───

const BMAD_PHASES = ['analysis', 'planning', 'solutioning', 'implementation'];
const PHASE_LABELS = { analysis: 'Analysis', planning: 'Planning', solutioning: 'Solutioning', implementation: 'Implementation', completed: 'Completed' };
const PHASE_COLORS = { analysis: '#89b4fa', planning: '#f9e2af', solutioning: '#cba6f7', implementation: '#a6e3a1', completed: '#6c7086' };

function WorkflowsPage() {
  const [workflows, setWorkflows] = useState(null);
  const [agents, setAgents] = useState([]);
  const [view, setView] = useState('pipeline');
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState({});
  const [form, setForm] = useState({ name: '', description: '', workingDirectory: '', phase: 'analysis' });

  const load = useCallback(async () => {
    try { setWorkflows(await API.getWorkflows()); } catch { setWorkflows([]); }
  }, []);

  const loadAgents = useCallback(async () => {
    try { setAgents(await API.getWorkflowAgents()); } catch { setAgents([]); }
  }, []);

  useEffect(() => { load(); loadAgents(); }, [load, loadAgents]);

  const resetForm = () => { setForm({ name: '', description: '', workingDirectory: '', phase: 'analysis' }); setShowForm(false); };

  const handleCreate = async () => {
    if (!form.name || !form.workingDirectory) return showToast('Nome e diretorio sao obrigatorios', 'error');
    try {
      await API.createWorkflow(form);
      showToast('Projeto criado');
      resetForm();
      await load();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Deletar este projeto?')) return;
    try { await API.deleteWorkflow(id); showToast('Projeto deletado'); await load(); if (selected === id) { setView('pipeline'); setSelected(null); } }
    catch (err) { showToast(err.message, 'error'); }
  };

  const handleAdvance = async (wf) => {
    setBusy(b => ({ ...b, ['adv-' + wf.id]: true }));
    try { await API.advanceWorkflow(wf.id); showToast(`Avancado para ${PHASE_LABELS[BMAD_PHASES[BMAD_PHASES.indexOf(wf.phase) + 1]] || 'proximo'}`); await load(); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(b => ({ ...b, ['adv-' + wf.id]: false })); }
  };

  const handleLaunch = async (wf, agentOverride) => {
    setBusy(b => ({ ...b, ['launch-' + wf.id]: true }));
    try {
      const session = await API.launchWorkflowAgent(wf.id, agentOverride || undefined);
      showToast(`Agente lancado (sessao ${session.id.slice(0, 8)})`);
      await load();
      if (typeof getViewManager === 'function') getViewManager().open(session.id, session);
    } catch (err) { showToast(err.message, 'error'); }
    finally { setBusy(b => ({ ...b, ['launch-' + wf.id]: false })); }
  };

  const openDetail = (wf) => { setSelected(wf.id); setView('detail'); };

  const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'agora';
    if (diff < 3600) return Math.floor(diff / 60) + 'm atras';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h atras';
    return Math.floor(diff / 86400) + 'd atras';
  };

  if (!workflows) return html`<div class="empty-state"><p>Carregando...</p></div>`;

  // ── Pipeline View ──
  if (view === 'pipeline') {
    return html`
      <div class="page-title">
        <span>Workflows</span>
        <button class="btn btn-primary" onClick=${() => setShowForm(true)}>+ Novo Projeto</button>
      </div>

      <div class="workflow-pipeline">
        ${BMAD_PHASES.map(phase => {
          const items = workflows.filter(w => w.phase === phase);
          return html`
            <div class="workflow-column">
              <div class="workflow-column-title" style="border-bottom: 2px solid ${PHASE_COLORS[phase]}">
                <span style="color:${PHASE_COLORS[phase]}">${PHASE_LABELS[phase]}</span>
                <span style="font-size:11px;color:var(--text-muted)">${items.length}</span>
              </div>
              ${items.length === 0 && html`<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px 0">Nenhum projeto</div>`}
              ${items.map(wf => html`
                <div class="card" style="cursor:pointer" onClick=${() => openDetail(wf)}>
                  <div class="card-title" style="font-size:14px">${wf.name}</div>
                  <div class="card-meta">
                    ${wf.artifacts.length} artefato(s) · ${timeAgo(wf.updatedAt)}
                  </div>
                  <div class="card-actions" onClick=${(e) => e.stopPropagation()}>
                    <button class="btn btn-success btn-sm" disabled=${busy['launch-' + wf.id]}
                      onClick=${() => handleLaunch(wf)}>
                      ${busy['launch-' + wf.id] ? 'Iniciando...' : 'Iniciar'}
                    </button>
                  </div>
                </div>
              `)}
            </div>
          `;
        })}
      </div>

      ${workflows.filter(w => w.phase === 'completed').length > 0 && html`
        <div style="margin-top:24px">
          <h3 style="font-size:14px;color:var(--text-muted);margin-bottom:12px">Concluidos</h3>
          <div class="card-grid">
            ${workflows.filter(w => w.phase === 'completed').map(wf => html`
              <div class="card" style="opacity:0.7;cursor:pointer" onClick=${() => openDetail(wf)}>
                <div class="card-title">${wf.name}</div>
                <div class="card-meta">${wf.artifacts.length} artefato(s) · ${timeAgo(wf.updatedAt)}</div>
              </div>
            `)}
          </div>
        </div>
      `}

      ${showForm && html`
        <div class="modal-overlay" onClick=${(e) => { if (e.target.classList.contains('modal-overlay')) resetForm(); }}>
          <div class="modal">
            <h2 style="margin-bottom:16px">Novo Projeto BMAD</h2>
            <div class="form-group">
              <label>Nome *</label>
              <input value=${form.name} onInput=${(e) => setForm({ ...form, name: e.target.value })} placeholder="Meu Projeto SaaS" />
            </div>
            <div class="form-group">
              <label>Descricao</label>
              <input value=${form.description} onInput=${(e) => setForm({ ...form, description: e.target.value })} placeholder="Breve descricao do projeto" />
            </div>
            <div class="form-group">
              <label>Diretorio de Trabalho *</label>
              <input value=${form.workingDirectory} onInput=${(e) => setForm({ ...form, workingDirectory: e.target.value })} placeholder="/home/user/projects/meu-projeto" />
            </div>
            <div class="form-group">
              <label>Fase Inicial</label>
              <select value=${form.phase} onChange=${(e) => setForm({ ...form, phase: e.target.value })}>
                ${BMAD_PHASES.map(p => html`<option value=${p}>${PHASE_LABELS[p]}</option>`)}
              </select>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
              <button class="btn" onClick=${resetForm}>Cancelar</button>
              <button class="btn btn-primary" onClick=${handleCreate}>Criar</button>
            </div>
          </div>
        </div>
      `}
    `;
  }

  // ── Detail View ──
  const wf = workflows.find(w => w.id === selected);
  if (!wf) { setView('pipeline'); return null; }

  const phaseAgents = agents.filter(a => a.phase === wf.phase);
  const currentPhaseIdx = BMAD_PHASES.indexOf(wf.phase);

  return html`
    <div class="page-title">
      <span>
        <button class="btn btn-sm" onClick=${() => { setView('pipeline'); setSelected(null); }} style="margin-right:8px">← Voltar</button>
        ${wf.name}
      </span>
      <div style="display:flex;gap:8px">
        ${wf.phase !== 'completed' && html`
          <button class="btn btn-primary" disabled=${busy['launch-' + wf.id]} onClick=${() => handleLaunch(wf)}
            style="background:var(--success);border-color:var(--success);color:var(--bg-primary)">
            ${busy['launch-' + wf.id] ? 'Iniciando...' : 'Iniciar Sessao'}
          </button>
        `}
        <button class="btn btn-danger btn-sm" onClick=${() => handleDelete(wf.id)}>Deletar</button>
      </div>
    </div>

    ${wf.description && html`<p style="color:var(--text-secondary);margin-bottom:16px;font-size:14px">${wf.description}</p>`}
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${wf.workingDirectory}</p>

    <!-- Phase Progress Bar -->
    <div class="workflow-phase-bar">
      ${BMAD_PHASES.map((phase, i) => {
        const isDone = i < currentPhaseIdx || wf.phase === 'completed';
        const isActive = phase === wf.phase && wf.phase !== 'completed';
        return html`
          ${i > 0 && html`<div class="workflow-phase-line ${isDone || (isActive && i <= currentPhaseIdx) ? 'done' : ''}"></div>`}
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
            <div class="workflow-phase-dot ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}"></div>
            <span style="font-size:10px;color:${isActive ? PHASE_COLORS[phase] : isDone ? 'var(--success)' : 'var(--text-muted)'};white-space:nowrap">${PHASE_LABELS[phase]}</span>
          </div>
        `;
      })}
    </div>

    <!-- Agents for current phase -->
    ${wf.phase !== 'completed' && html`
      <div class="workflow-detail-section">
        <h3>Agentes da Fase: ${PHASE_LABELS[wf.phase]}</h3>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">O orquestrador lanca esses agentes automaticamente. Ou lance diretamente:</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${phaseAgents.map(a => html`
            <button class="btn btn-sm" style="border-color:${a.color}" disabled=${busy['launch-' + wf.id]}
              onClick=${() => handleLaunch(wf, a.name)}>
              ${a.icon} ${a.persona} (${a.title})
            </button>
          `)}
          <span style="color:var(--border);margin:0 4px">|</span>
          <button class="btn btn-sm" style="color:var(--accent)" disabled=${busy['adv-' + wf.id]}
            onClick=${() => handleAdvance(wf)}>Avancar Fase Manualmente</button>
        </div>
      </div>
    `}

    <!-- Artifacts -->
    <div class="workflow-detail-section">
      <h3>Artefatos (${wf.artifacts.length})</h3>
      ${wf.artifacts.length === 0
        ? html`<p style="color:var(--text-muted);font-size:13px">Nenhum artefato registrado ainda</p>`
        : html`
          <table style="width:100%;font-size:13px">
            <thead><tr><th style="text-align:left;padding:4px 8px">Tipo</th><th style="text-align:left;padding:4px 8px">Nome</th><th style="text-align:left;padding:4px 8px">Criado por</th><th style="text-align:left;padding:4px 8px">Data</th></tr></thead>
            <tbody>
              ${wf.artifacts.map(a => html`
                <tr><td style="padding:4px 8px"><span class="status-tag">${a.type}</span></td><td style="padding:4px 8px">${a.name}</td><td style="padding:4px 8px">${a.createdBy || '-'}</td><td style="padding:4px 8px;color:var(--text-muted)">${timeAgo(a.createdAt)}</td></tr>
              `)}
            </tbody>
          </table>
        `
      }
    </div>

    <!-- History Timeline -->
    <div class="workflow-detail-section">
      <h3>Historico</h3>
      <div class="workflow-timeline">
        ${[...(wf.history || [])].reverse().map(h => html`
          <div class="workflow-timeline-item">
            <div>
              ${h.action === 'created' && 'Projeto criado'}
              ${h.action === 'phase-advanced' && html`Fase avancada: <strong>${PHASE_LABELS[h.from]}</strong> → <strong>${PHASE_LABELS[h.to]}</strong> ${h.note ? `— ${h.note}` : ''}`}
              ${h.action === 'agent-launched' && html`Agente lancado: <strong>${h.agent}</strong> <span style="color:var(--text-muted)">(${(h.sessionId || '').slice(0, 8)})</span>`}
            </div>
            <div class="time">${timeAgo(h.at)}</div>
          </div>
        `)}
      </div>
    </div>
  `;
}

// ─── Config Page (Preact) ───

function ConfigToolCard({ name, icon, statusFn, installFn, authFn, authLabel, hint }) {
  const [status, setStatus] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState('');
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await statusFn()); }
    catch { setStatus({ installed: false }); }
  }, [statusFn]);

  useEffect(() => { load(); }, [load]);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    setShowLog(true);
    setInstallLog('');
    try {
      await installFn((text) => setInstallLog(prev => prev + text));
      showToast(name + ' instalado!');
      await load();
    } catch (err) {
      showToast('Falha: ' + err.message, 'error');
    }
    setInstalling(false);
  }, [installFn, name, load]);

  const handleAuth = useCallback(async () => {
    try {
      const result = await authFn();
      TerminalManager.open(result.sessionId);
      document.getElementById('terminal-title').textContent = name + ' - Login';
      const onExit = (msg) => {
        if (msg.sessionId === result.sessionId) {
          API.off('terminal:exit', onExit);
          setTimeout(() => load(), 1000);
        }
      };
      API.on('terminal:exit', onExit);
    } catch (err) {
      showToast('Erro: ' + err.message, 'error');
    }
  }, [authFn, name, load]);

  if (!status) {
    return html`
      <div class="card" style="margin-bottom: 12px">
        <div style="display:flex; align-items:center; gap:12px">
          <span style="font-size:24px">${icon}</span>
          <div style="flex:1">
            <div class="card-title">${name}</div>
            <span style="color:var(--text-muted); font-size:13px">Verificando...</span>
          </div>
        </div>
      </div>
    `;
  }

  const isInstalled = status.installed;
  const isAuthed = status.authenticated || status.configured;
  const versionText = status.version ? 'v' + status.version : '';
  const userText = status.user
    ? (status.user.includes('@') ? ' (' + status.user + ')' : ' (@' + status.user + ')')
    : (status.provider ? ' (' + status.provider + ')' : '');

  return html`
    <div class="card" style="margin-bottom: 12px">
      <div style="display:flex; align-items:center; gap:12px">
        <span style="font-size:24px">${icon}</span>
        <div style="flex:1">
          <div class="card-title">${name}</div>
          <div style="display:flex; align-items:center; gap:8px; margin-top:4px">
            ${isInstalled
              ? html`
                  <span class="status-tag completed">Instalado ${versionText}</span>
                  ${isAuthed !== undefined && isAuthed !== null
                    ? (isAuthed
                        ? html`<span class="status-tag completed">Autenticado${userText}</span>`
                        : html`<span class="status-tag stopped">Nao autenticado</span>`)
                    : null}
                `
              : html`<span class="status-tag crashed">Nao instalado</span>`
            }
          </div>
        </div>
        <div style="display:flex; gap:8px">
          ${!isInstalled
            ? html`<button class="btn btn-primary btn-sm" onClick=${handleInstall} disabled=${installing}>
                ${installing ? 'Instalando...' : 'Instalar'}
              </button>`
            : null}
          ${isInstalled && authFn && !isAuthed
            ? html`<button class="btn btn-sm btn-primary" onClick=${handleAuth}>
                ${authLabel || 'Login'}
              </button>`
            : null}
        </div>
      </div>
      ${hint && isInstalled ? html`
        <div style="margin-top:8px; font-size:12px; color:var(--text-muted)">${hint}</div>
      ` : null}
      ${showLog && installLog ? html`
        <pre class="code-block" style="margin-top:12px; max-height:200px; overflow:auto; font-size:12px">${installLog}</pre>
      ` : null}
    </div>
  `;
}

function ConfigPage() {
  return html`
    <div class="page-title"><span>Configuracao</span></div>
    <p style="color:var(--text-secondary); margin-bottom:20px; font-size:14px">
      Instale e autentique as ferramentas CLI utilizadas pelo launcher.
    </p>
    <${ConfigToolCard}
      name="Claude Code"
      icon="\u{1F916}"
      statusFn=${() => API.getClaudeCLIStatus()}
      installFn=${(cb) => API.installClaudeCLI(cb)}
      authFn=${() => API.startClaudeCLIAuth()}
      authLabel="Login"
    />
    <${ConfigToolCard}
      name="GitHub CLI"
      icon="\u{1F4BB}"
      statusFn=${() => API.getGitHubCLIStatus()}
      installFn=${(cb) => API.installGitHubCLI(cb)}
      authFn=${() => API.startGitHubCLIAuth()}
      authLabel="Login"
    />
    <${ConfigToolCard}
      name="Gemini CLI"
      icon="\u2728"
      statusFn=${() => API.getGeminiCLIStatus()}
      installFn=${(cb) => API.installGeminiCLI(cb)}
      authFn=${() => API.startGeminiCLIAuth()}
      authLabel="Login"
    />
    <${ConfigToolCard}
      name="Cline CLI"
      icon="\u26A1"
      statusFn=${() => API.getClineCLIStatus()}
      installFn=${(cb) => API.installClineCLI(cb)}
      authFn=${() => API.startClineCLIAuth()}
      authLabel="Login"
    />
    <${ConfigToolCard}
      name="Google Workspace CLI"
      icon="\uD83C\uDFE2"
      statusFn=${() => API.getGwsCLIStatus()}
      installFn=${(cb) => API.installGwsCLI(cb)}
      authFn=${() => API.startGwsCLIAuth()}
      authLabel="Login"
    />
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
    case 'skills': return html`<${SkillsPage} />`;
    case 'workflows': return html`<${WorkflowsPage} />`;
    case 'config': return html`<${ConfigPage} />`;
    case 'files': return html`<${LegacyPage} renderFn=${renderFileManagerPage} />`;
    case 'github-cli': return html`<${LegacyPage} renderFn=${renderGitHubCLIPage} />`;
    case 'cline-cli': return html`<${LegacyPage} renderFn=${renderClineCliPage} />`;
    case 'gemini-cli': return html`<${LegacyPage} renderFn=${renderGeminiCliPage} />`;
    case 'gws-cli': return html`<${LegacyPage} renderFn=${renderGwsCliPage} />`;
    case 'claude-agents': return html`<${LegacyPage} renderFn=${renderClaudeAgentsPage} />`;
    case 'agent-profiles': return html`<${LegacyPage} renderFn=${renderAgentProfilesPage} />`;
    case 'voice-manager': return html`<${LegacyPage} renderFn=${renderVoiceManagerPage} />`;
    case 'planning': return html`<${LegacyPage} renderFn=${typeof renderPlanningPage === 'function' ? renderPlanningPage : (c) => { c.innerHTML = '<div class="empty-state"><p>Carregando modulo de planejamento...</p></div>'; }} />`;
    default: return null;
  }
}

// ─── Main App ───

function App() {
  const [authState, setAuthState] = useState('loading');
  const [page, setPage] = useState('profiles');

  // Boot: check auth status
  useEffect(() => {
    API.checkAuthStatus().then(status => {
      if (status.env) API.serverEnv = status.env;
      if (!status.onboardingDone) setAuthState('onboarding');
      else setAuthState('app');
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
    case 'onboarding': return html`<${OnboardingPage} onDone=${onAuthDone} />`;
    case 'app': return html`<${ContentRouter} page=${page} />`;
    default: return null;
  }
}

// ─── Mount ───
preactRender(html`<${App} />`, document.getElementById('content'));
