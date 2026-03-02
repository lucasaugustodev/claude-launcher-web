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

// ─── Content Router ───

function ContentRouter({ page }) {
  switch (page) {
    case 'profiles': return html`<${ProfilesPage} />`;
    case 'active': return html`<${ActivePage} />`;
    case 'history': return html`<${HistoryPage} />`;
    case 'files': return html`<${LegacyPage} renderFn=${renderFileManagerPage} />`;
    case 'github-cli': return html`<${LegacyPage} renderFn=${renderGitHubCLIPage} />`;
    case 'cline-cli': return html`<${LegacyPage} renderFn=${renderClineCliPage} />`;
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
