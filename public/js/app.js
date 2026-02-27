// ─── App Router & Init ───

(function () {
  const content = document.getElementById('content');
  let currentPage = 'profiles';

  // ─── Setup Screen (first access - no users exist) ───

  function showSetup() {
    document.getElementById('sidebar').style.display = 'none';
    content.innerHTML = '';
    const box = el('div', { style: { maxWidth: '400px', margin: '60px auto' } }, [
      el('h2', { textContent: 'Claude Launcher', style: { textAlign: 'center', marginBottom: '8px', color: 'var(--accent)' } }),
      el('p', { textContent: 'Primeiro acesso - crie sua conta', style: { textAlign: 'center', color: 'var(--text-muted)', marginBottom: '24px', fontSize: '14px' } }),
      el('div', { className: 'card' }, [
        el('div', { className: 'form-group' }, [
          el('label', { textContent: 'Usuario' }),
          el('input', { type: 'text', id: 'setup-user', placeholder: 'Seu usuario' }),
        ]),
        el('div', { className: 'form-group' }, [
          el('label', { textContent: 'Senha' }),
          el('input', { type: 'password', id: 'setup-pass', placeholder: 'Sua senha' }),
        ]),
        el('div', { className: 'form-group' }, [
          el('label', { textContent: 'Confirmar Senha' }),
          el('input', { type: 'password', id: 'setup-pass2', placeholder: 'Repita a senha' }),
        ]),
        el('button', {
          className: 'btn btn-primary',
          textContent: 'Criar Conta',
          style: { width: '100%', justifyContent: 'center' },
          onClick: doSetup,
        }),
      ]),
    ]);
    content.appendChild(box);

    setTimeout(() => {
      const userInput = document.getElementById('setup-user');
      if (userInput) userInput.focus();
      document.getElementById('setup-pass2')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSetup(); });
    }, 100);
  }

  async function doSetup() {
    const user = document.getElementById('setup-user').value.trim();
    const pass = document.getElementById('setup-pass').value;
    const pass2 = document.getElementById('setup-pass2').value;

    if (!user || user.length < 3) {
      showToast('Usuario deve ter no minimo 3 caracteres', 'error');
      return;
    }
    if (!pass || pass.length < 4) {
      showToast('Senha deve ter no minimo 4 caracteres', 'error');
      return;
    }
    if (pass !== pass2) {
      showToast('Senhas nao conferem', 'error');
      return;
    }

    try {
      await API.setup(user, pass);
      showToast('Conta criada com sucesso!');
      document.getElementById('sidebar').style.display = 'flex';
      initApp();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ─── Login Screen ───

  function showLogin() {
    document.getElementById('sidebar').style.display = 'none';
    content.innerHTML = '';
    const box = el('div', { style: { maxWidth: '360px', margin: '80px auto' } }, [
      el('h2', { textContent: 'Claude Launcher', style: { textAlign: 'center', marginBottom: '24px', color: 'var(--accent)' } }),
      el('div', { className: 'card' }, [
        el('div', { className: 'form-group' }, [
          el('label', { textContent: 'Usuario' }),
          el('input', { type: 'text', id: 'login-user', placeholder: 'Seu usuario' }),
        ]),
        el('div', { className: 'form-group' }, [
          el('label', { textContent: 'Senha' }),
          el('input', { type: 'password', id: 'login-pass', placeholder: 'Sua senha' }),
        ]),
        el('button', {
          className: 'btn btn-primary',
          textContent: 'Entrar',
          style: { width: '100%', justifyContent: 'center' },
          onClick: doLogin,
        }),
      ]),
    ]);
    content.appendChild(box);

    setTimeout(() => {
      const userInput = document.getElementById('login-user');
      if (userInput) userInput.focus();
      document.getElementById('login-pass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    }, 100);
  }

  async function doLogin() {
    const user = document.getElementById('login-user').value.trim();
    const pass = document.getElementById('login-pass').value;

    if (!user || !pass) {
      showToast('Preencha usuario e senha', 'error');
      return;
    }

    try {
      await API.login(user, pass);
      document.getElementById('sidebar').style.display = 'flex';
      initApp();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ─── Router ───

  function navigate(page) {
    currentPage = page;

    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
    });

    switch (page) {
      case 'profiles': renderProfilesPage(content); break;
      case 'active': renderActivePage(content); break;
      case 'history': renderHistoryPage(content); break;
      case 'files': renderFileManagerPage(content); break;
      case 'github-cli': renderGitHubCLIPage(content); break;
    }
  }

  // ─── Nav Click Handlers ───

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(link.dataset.page);
    });
  });

  // ─── Terminal Controls ───

  document.getElementById('terminal-back').onclick = () => {
    TerminalManager.close();
    updateWatcherIndicator('');
    _watcherCommitCount = 0;
  };

  document.getElementById('terminal-stop').onclick = async () => {
    const sessionId = TerminalManager.currentSessionId;
    if (!sessionId) return;
    try {
      await API.stopSession(sessionId);
      showToast('Sessao parada');
      updateActiveCount();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ─── WebSocket Status ───

  function updateWSStatus(connected) {
    const dot = document.getElementById('server-status');
    const text = document.getElementById('server-status-text');
    if (connected) {
      dot.className = 'status-dot online';
      text.textContent = 'Conectado';
    } else {
      dot.className = 'status-dot offline';
      text.textContent = 'Desconectado';
    }
  }

  API.on('ws:connected', () => updateWSStatus(true));
  API.on('ws:disconnected', () => updateWSStatus(false));

  // ─── Watcher Indicator ───

  let _watcherCommitCount = 0;

  function updateWatcherIndicator(text, color) {
    const indicator = document.getElementById('watcher-indicator');
    if (!indicator) return;
    indicator.style.display = text ? 'inline' : 'none';
    indicator.textContent = text;
    if (color) indicator.style.color = color;
  }

  API.on('watcher:commit', (msg) => {
    _watcherCommitCount = msg.commitCount || (_watcherCommitCount + 1);
    updateWatcherIndicator(`Auto-sync: ${_watcherCommitCount} commit(s)`, '#a6e3a1');
  });

  API.on('watcher:cline-start', () => {
    updateWatcherIndicator(`Syncing...`, '#f9e2af');
  });

  API.on('watcher:cline-done', (msg) => {
    if (msg.success) {
      updateWatcherIndicator(`Auto-sync: ${_watcherCommitCount} commit(s)`, '#a6e3a1');
    } else {
      updateWatcherIndicator(`Sync error`, '#f38ba8');
    }
  });

  API.on('watcher:pr', (msg) => {
    if (msg.prUrl) {
      showToast(`PR criado: ${msg.prUrl}`);
      updateWatcherIndicator(`PR aberto`, '#89b4fa');
    }
  });

  // ─── Init ───

  function initApp() {
    API.connectWS();
    _watcherCommitCount = 0;
    navigate('profiles');
    updateActiveCount();
    setInterval(updateActiveCount, 10000);
  }

  // ─── Boot: check auth status ───

  async function boot() {
    // Try to load saved token
    API.loadToken();

    try {
      const status = await API.checkAuthStatus();

      if (status.needsSetup) {
        showSetup();
      } else if (status.loggedIn) {
        document.getElementById('sidebar').style.display = 'flex';
        initApp();
      } else {
        showLogin();
      }
    } catch {
      // Server unreachable
      content.innerHTML = '';
      content.appendChild(el('div', { className: 'empty-state', innerHTML: '<p>Servidor indisponivel. Verifique a conexao.</p>' }));
    }
  }

  boot();
})();
