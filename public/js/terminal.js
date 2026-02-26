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

    // Show overlay
    document.getElementById('terminal-overlay').style.display = 'flex';
  },

  close() {
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
  openReadOnly(title, output) {
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
    });

    this._fitAddon = new FitAddon.FitAddon();
    this._term.loadAddon(this._fitAddon);
    this._term.open(container);

    setTimeout(() => {
      this._fitAddon.fit();
    }, 100);

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

    this._resizeHandler = () => {
      if (this._fitAddon) this._fitAddon.fit();
    };
    window.addEventListener('resize', this._resizeHandler);

    document.getElementById('terminal-title').textContent = title;
    document.getElementById('terminal-stop').style.display = 'none';
    document.getElementById('terminal-overlay').style.display = 'flex';
  },

  get currentSessionId() {
    return this._currentSessionId;
  },
};
