// ─── Terminal Manager ───

const TerminalManager = {
  _term: null,
  _fitAddon: null,
  _currentSessionId: null,
  _outputHandler: null,
  _exitHandler: null,

  open(sessionId) {
    this._currentSessionId = sessionId;

    const container = document.getElementById('terminal-container');
    container.innerHTML = '';

    // Create xterm instance
    this._term = new Terminal({
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
      fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
    });

    // Fit addon
    this._fitAddon = new FitAddon.FitAddon();
    this._term.loadAddon(this._fitAddon);

    this._term.open(container);

    // Fit after a small delay to ensure container is sized
    setTimeout(() => {
      this._fitAddon.fit();
      API.resizeTerminal(sessionId, this._term.cols, this._term.rows);
    }, 100);

    // Intercept Ctrl+C: copy to clipboard when text is selected, otherwise send SIGINT
    this._term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'c') {
        const selection = this._term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
          this._term.clearSelection();
          return false; // prevent sending to PTY
        }
      }
      // Ctrl+V: paste from clipboard
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
        navigator.clipboard.readText().then(text => {
          if (text) API.sendInput(sessionId, text);
        }).catch(() => {});
        return false;
      }
      return true;
    });

    // Handle user input -> send to PTY
    this._term.onData((data) => {
      API.sendInput(sessionId, data);
    });

    // Handle terminal output from WebSocket
    this._outputHandler = (msg) => {
      if (msg.sessionId === sessionId && this._term) {
        this._term.write(msg.data);
      }
    };

    this._exitHandler = (msg) => {
      if (msg.sessionId === sessionId && this._term) {
        this._term.write('\r\n\x1b[33m[Sessao finalizada com codigo ' + msg.exitCode + ']\x1b[0m\r\n');
      }
    };

    API.on('terminal:output', this._outputHandler);
    API.on('terminal:exit', this._exitHandler);

    // Attach to session via WebSocket
    API.attachSession(sessionId);

    // Handle window resize
    this._resizeHandler = () => {
      if (this._fitAddon) {
        this._fitAddon.fit();
        API.resizeTerminal(sessionId, this._term.cols, this._term.rows);
      }
    };
    window.addEventListener('resize', this._resizeHandler);

    // Add Chat toggle button
    this._addChatToggle(sessionId);

    // Show overlay
    document.getElementById('terminal-overlay').style.display = 'flex';
  },

  _addChatToggle(sessionId) {
    var existing = document.getElementById('terminal-chat-toggle');
    if (existing) existing.remove();

    var header = document.querySelector('.terminal-header');
    var stopBtn = document.getElementById('terminal-stop');
    if (!header || !stopBtn) return;

    var btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.id = 'terminal-chat-toggle';
    btn.textContent = 'Chat';
    btn.addEventListener('click', function() {
      // Switch to chat view for this session
      TerminalManager.close();
      ChatViewManager.open(sessionId, { streamJson: true });
      document.getElementById('terminal-overlay').style.display = 'flex';
    });
    header.insertBefore(btn, stopBtn);
  },

  close() {
    var chatToggle = document.getElementById('terminal-chat-toggle');
    if (chatToggle) chatToggle.remove();

    if (this._currentSessionId) {
      API.detachSession(this._currentSessionId);
    }

    if (this._outputHandler) {
      API.off('terminal:output', this._outputHandler);
      this._outputHandler = null;
    }

    if (this._exitHandler) {
      API.off('terminal:exit', this._exitHandler);
      this._exitHandler = null;
    }

    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }

    if (this._term) {
      this._term.dispose();
      this._term = null;
    }

    this._fitAddon = null;
    this._currentSessionId = null;

    document.getElementById('terminal-overlay').style.display = 'none';
    document.getElementById('terminal-stop').style.display = '';
  },

  // Open a read-only terminal to view historical output
  // cols/rows: original terminal dimensions for correct ANSI replay
  openReadOnly(title, output, { cols, rows } = {}) {
    this._currentSessionId = null;

    const container = document.getElementById('terminal-container');
    container.innerHTML = '';

    this._term = new Terminal({
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
      fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
      fontSize: 14,
      cursorBlink: false,
      disableStdin: true,
      allowProposedApi: true,
      scrollback: 10000,
    });

    this._fitAddon = new FitAddon.FitAddon();
    this._term.loadAddon(this._fitAddon);

    this._term.open(container);

    // Write the saved output in chunks so xterm.js can process ANSI sequences properly
    if (output) {
      const CHUNK = 4096;
      let offset = 0;
      const writeChunk = () => {
        if (offset >= output.length || !this._term) return;
        const end = Math.min(offset + CHUNK, output.length);
        this._term.write(output.slice(offset, end));
        offset = end;
        if (offset < output.length) {
          setTimeout(writeChunk, 5);
        }
      };
      writeChunk();
    } else {
      this._term.write('\x1b[33m[Nenhum output salvo para esta sessao]\x1b[0m\r\n');
    }

    // Fit to container (same as active terminal)
    setTimeout(() => { if (this._fitAddon) this._fitAddon.fit(); }, 100);

    this._resizeHandler = () => { if (this._fitAddon) this._fitAddon.fit(); };
    window.addEventListener('resize', this._resizeHandler);

    document.getElementById('terminal-title').textContent = title;
    document.getElementById('terminal-stop').style.display = 'none';
    document.getElementById('terminal-overlay').style.display = 'flex';
  },

  // Open a live terminal that first replays previous session output, then connects to new PTY
  openWithHistory(sessionId, previousOutput) {
    this._currentSessionId = sessionId;

    const container = document.getElementById('terminal-container');
    container.innerHTML = '';

    this._term = new Terminal({
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
      fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
    });

    this._fitAddon = new FitAddon.FitAddon();
    this._term.loadAddon(this._fitAddon);
    this._term.open(container);

    // Replay previous output in chunks (same approach as openReadOnly)
    const self = this;
    if (previousOutput && previousOutput.length > 0) {
      const CHUNK = 4096;
      let offset = 0;
      const writeChunk = () => {
        if (offset >= previousOutput.length || !self._term) return;
        const end = Math.min(offset + CHUNK, previousOutput.length);
        self._term.write(previousOutput.slice(offset, end));
        offset = end;
        if (offset < previousOutput.length) {
          setTimeout(writeChunk, 5);
        } else {
          // Separator after all output is written
          self._term.write('\r\n\x1b[36m── sessao retomada ──\x1b[0m\r\n\r\n');
        }
      };
      writeChunk();
    }

    // Fit after replay
    setTimeout(() => {
      if (this._fitAddon) {
        this._fitAddon.fit();
        API.resizeTerminal(sessionId, this._term.cols, this._term.rows);
      }
    }, 100);

    // Intercept Ctrl+C / Ctrl+V (same as open)
    this._term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'c') {
        const selection = this._term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
          this._term.clearSelection();
          return false;
        }
      }
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
        navigator.clipboard.readText().then(text => {
          if (text) API.sendInput(sessionId, text);
        }).catch(() => {});
        return false;
      }
      return true;
    });

    // Handle user input -> send to PTY
    this._term.onData((data) => {
      API.sendInput(sessionId, data);
    });

    // Handle terminal output from WebSocket
    this._outputHandler = (msg) => {
      if (msg.sessionId === sessionId && this._term) {
        this._term.write(msg.data);
      }
    };

    this._exitHandler = (msg) => {
      if (msg.sessionId === sessionId && this._term) {
        this._term.write('\r\n\x1b[33m[Sessao finalizada com codigo ' + msg.exitCode + ']\x1b[0m\r\n');
      }
    };

    API.on('terminal:output', this._outputHandler);
    API.on('terminal:exit', this._exitHandler);

    API.attachSession(sessionId);

    this._resizeHandler = () => {
      if (this._fitAddon) {
        this._fitAddon.fit();
        API.resizeTerminal(sessionId, this._term.cols, this._term.rows);
      }
    };
    window.addEventListener('resize', this._resizeHandler);

    this._addChatToggle(sessionId);

    document.getElementById('terminal-overlay').style.display = 'flex';
  },

  get currentSessionId() {
    return this._currentSessionId;
  },
};
