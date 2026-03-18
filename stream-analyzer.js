// ─── Stream Analyzer ───
// Analyzes raw ANSI PTY output from Claude Code and emits structured action messages
// for the mobile Chat View. Desktop terminal remains unaffected.

// Characters to strip: box-drawing, block elements, braille spinners, decorative unicode
const DECORATIVE_RE = /[╭╮╰╯│┃┌┐└┘├┤┬┴┼╠╣╦╩╬═║─━┄┅┈┉╌╍╴╶╸╺▀▄█▌▐░▒▓▛▜▝▟▙▞▖▗▘▝▚▐▌⏵⎿⏏⏩⏪⏫⏬◆◇○●◐◑◒◓☐☑☒✢✻✶✽✦✧⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏…·•]/g;

// Pattern-based spinner detection.
// All Claude Code spinner words are gerunds (end in "-ing"): Thinking, Simmering, Cogitating, Swirling, etc.
// Instead of maintaining a word list, detect by pattern.

// Match a single gerund word: "Thinking", "* Simmering", "Swirling..."
const SINGLE_GERUND_RE = /^\s*\*?\s*([A-Z][a-z]*ing)\s*\.{0,3}\s*\*?\s*$/;

// Extract any gerund from text (for immediate detection)
const ANY_GERUND_RE = /\b([A-Z][a-z]{2,}ing)\b/;

// Check if a line is spinner garbage
// Detects: single gerund word, fragments of a gerund, or repeated gerund fragments from re-render
function isSpinnerGarbage(cleaned) {
  // Remove asterisks and extra spaces
  const stripped = cleaned.replace(/[*]/g, '').replace(/\s+/g, ' ').trim();
  if (!stripped) return true;

  // Single gerund word (with optional ... or *)
  if (SINGLE_GERUND_RE.test(cleaned)) return true;

  // Check if the line is just fragments of a gerund
  // Pattern: "C Cog Cogitgita Cogitating" or "Simm Simmeri Simmering"
  // Heuristic: if the line has a gerund word AND all other "words" are
  // short fragments (< 4 chars) or substrings of that gerund, it's garbage
  const gerundMatch = stripped.match(/\b([A-Za-z]{4,}ing)\b/i);
  if (gerundMatch) {
    const gerund = gerundMatch[1].toLowerCase();
    const words = stripped.toLowerCase().split(/\s+/);
    const allRelated = words.every(w =>
      w.length < 3 || gerund.includes(w) || w.includes(gerund) || w === gerund
    );
    if (allRelated) return true;
  }

  // Line with ONLY gerund words repeated (multiple different spinner words on one line)
  const words = stripped.split(/\s+/);
  if (words.length > 0 && words.every(w => /^[A-Za-z]*ing$/i.test(w) || w.length < 3 || w === '*')) {
    return true;
  }

  return false;
}

class StreamAnalyzer {
  constructor(sessionId, emitAction) {
    this.sessionId = sessionId;
    this.emitAction = emitAction;
    this.lineBuffer = '';
    this.state = 'idle';
    this.flushTimer = null;
    this.textAccumulator = '';
    this._textEmitTimer = null;
    this.seenHeader = false;
    this._live = false; // Start muted - becomes live after first quiet period
    this._liveTimer = null;
    this._startLiveTimer();
    this.firstPrompt = null;       // First user prompt text (set externally by pty-manager)
  }

  // After 500ms of no data, consider replay done and go live
  _startLiveTimer() {
    clearTimeout(this._liveTimer);
    this._liveTimer = setTimeout(() => {
      if (!this._live) {
        this._live = true;
        // Reset state - detect current state from last lines seen during replay
        this.state = 'idle';
        this.textAccumulator = '';
        this.lineBuffer = '';
        console.log(`[ANALYZER:${this.sessionId.substring(0,8)}] NOW LIVE`);
      }
    }, 500);
  }

  feed(rawData) {
    // Reset the live timer on each data chunk
    // During attach replay, data comes rapidly - timer never fires
    // After replay, 500ms gap triggers live mode
    this._startLiveTimer();

    // Strip ANSI escape sequences
    const stripped = this._stripAnsi(rawData);

    // If not live yet (replaying attach history), just scan for state but don't emit
    if (!this._live) {
      // Silently scan to detect header/version
      if (!this.seenHeader) {
        const vm = stripped.match(/Claude Code v([\d.]+)/);
        if (vm) this.seenHeader = true;
      }
      return;
    }

    // Immediate detection on raw stripped data (before line splitting)
    this._detectImmediate(stripped);

    // Accumulate into line buffer and process complete lines
    this.lineBuffer += stripped;

    // Process complete lines
    const parts = this.lineBuffer.split('\n');
    this.lineBuffer = parts.pop() || ''; // keep incomplete last line

    for (const line of parts) {
      this._processLine(line);
    }

    // Debounced flush of incomplete line buffer
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      if (this.lineBuffer.trim()) {
        this._processLine(this.lineBuffer);
        this.lineBuffer = '';
      }
      this._flushTextAccumulator();
    }, 150);
  }

  _stripAnsi(str) {
    return str
      .replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(parseInt(n, 10))) // Cursor forward N → N spaces
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')    // CSI sequences
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
      .replace(/\x1b[()][AB012]/g, '')             // Character set
      .replace(/\x1b[\x20-\x2F]*[\x40-\x7E]/g, '') // Other escape sequences
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // Control chars
      .replace(/\r/g, '');
  }

  _cleanLine(line) {
    // Remove decorative unicode, then collapse whitespace
    return line.replace(DECORATIVE_RE, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  _isJunkLine(cleaned) {
    if (!cleaned) return true;
    if (cleaned.length < 2) return true;
    // Pure separator lines
    if (/^[\s\-=_~.]+$/.test(cleaned)) return true;
    // Pure whitespace/decorative remnants
    if (/^[\s│|]+$/.test(cleaned)) return true;
    return false;
  }

  _detectImmediate(stripped) {
    // Thinking - detect any capitalized gerund ("* Swirling", "Thinking...", etc.)
    const gerundMatch = stripped.match(ANY_GERUND_RE);
    if (gerundMatch && this.state !== 'thinking') {
      // Only trigger if this looks like a spinner line (short, few words)
      // Don't trigger on full sentences that happen to contain a gerund
      const context = stripped.substring(Math.max(0, gerundMatch.index - 10), gerundMatch.index + gerundMatch[0].length + 10);
      const isIsolated = context.replace(/[*.\s]/g, '').length <= gerundMatch[1].length + 5;
      if (isIsolated) {
        this.state = 'thinking';
        this._flushTextAccumulator();
        this.emitAction({
          kind: 'thinking',
          status: gerundMatch[1],
          timestamp: Date.now(),
        });
      }
    }

    // Input prompt - detect on raw data since it often comes concatenated
    if (/ctrl\+g to edit/i.test(stripped) || /❯/.test(stripped)) {
      if (this.state !== 'input_wait' && this.state !== 'thinking') {
        this.state = 'input_wait';
        this._flushTextAccumulator();
        this.emitAction({
          kind: 'input_prompt',
          interruptable: false,
          timestamp: Date.now(),
        });
      }
    }

    // Tool approval
    const approvalMatch = stripped.match(/Allow\s+(\w+(?:\s*\([^)]*\))?)\s*[\?:]/i);
    if (approvalMatch && this.state !== 'tool_approval') {
      this.state = 'tool_approval';
      this._flushTextAccumulator();
      console.log(`[ANALYZER:${this.sessionId.substring(0,8)}] tool_approval: ${approvalMatch[1].trim()}`);
      this.emitAction({
        kind: 'tool_approval',
        toolName: approvalMatch[1].trim(),
        timestamp: Date.now(),
      });
    }
  }

  _processLine(rawLine) {
    const cleaned = this._cleanLine(rawLine);
    if (this._isJunkLine(cleaned)) return;
    console.log(`[ANALYZER:${this.sessionId.substring(0,8)}] LINE state=${this.state}: "${cleaned.substring(0, 120)}"`);

    // --- Session header ---
    const versionMatch = cleaned.match(/Claude Code v([\d.]+)/);
    if (versionMatch && !this.seenHeader) {
      this.seenHeader = true;
      const modelMatch = cleaned.match(/Opus[\s\d.]+|Sonnet[\s\d.]+|Haiku[\s\d.]+/i);
      this.emitAction({
        kind: 'session_info',
        version: versionMatch[1],
        model: modelMatch ? modelMatch[0].trim() : null,
        timestamp: Date.now(),
      });
      return;
    }

    // --- Bypass mode ---
    if (/bypass permissions on/i.test(cleaned)) {
      this.emitAction({
        kind: 'session_info',
        bypassMode: true,
        timestamp: Date.now(),
      });
      return;
    }

    // --- Thinking / spinner garbage ---
    if (isSpinnerGarbage(cleaned)) {
      if (this.state !== 'thinking') {
        // Extract the spinner word for display
        const wordMatch = cleaned.match(/\b([A-Za-z]{4,})\b/);
        const label = wordMatch ? wordMatch[1] : 'Thinking';
        this.state = 'thinking';
        this._flushTextAccumulator();
        this.emitAction({
          kind: 'thinking',
          status: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase(),
          timestamp: Date.now(),
        });
      }
      return;
    }

    // --- Tool execution ---
    const toolMatch = cleaned.match(/(?:^|\s)(Bash|Read|Write|Edit|Glob|Grep|WebFetch|WebSearch|Agent|Skill|NotebookEdit|TodoRead|TodoWrite|mcp\S*)\s*[:(.]/i);
    if (toolMatch && /^[\s]*(?:Bash|Read|Write|Edit|Glob|Grep|Web|Agent|Skill|Notebook|Todo|mcp)/i.test(cleaned)) {
      this.state = 'tool_exec';
      this._flushTextAccumulator();
      this.emitAction({
        kind: 'tool_execution',
        toolName: toolMatch[1],
        snippet: cleaned.substring(0, 300),
        timestamp: Date.now(),
      });
      return;
    }

    // --- Agent activity ---
    const agentMatch = cleaned.match(/Running\s+(\d+)\s+(\w+)\s+agents?/i);
    if (agentMatch) {
      this.emitAction({
        kind: 'agent_activity',
        count: parseInt(agentMatch[1]),
        agentType: agentMatch[2],
        timestamp: Date.now(),
      });
      return;
    }

    // --- Input prompt detection ---
    // Claude Code shows "ctrl+g to edit" or the ❯ prompt character when waiting for input
    if (/ctrl\+g to edit/i.test(cleaned) || /❯/.test(rawLine)) {
      if (this.state !== 'input_wait') {
        this.state = 'input_wait';
        this._flushTextAccumulator();
        console.log(`[ANALYZER:${this.sessionId.substring(0,8)}] input_prompt detected`);
        this.emitAction({
          kind: 'input_prompt',
          interruptable: false,
          timestamp: Date.now(),
        });
      }
      return;
    }

    // --- esc to interrupt (thinking state indicator) ---
    if (/esc to interrupt/i.test(cleaned)) {
      if (this.state !== 'thinking') {
        this.state = 'thinking';
        this._flushTextAccumulator();
        this.emitAction({
          kind: 'thinking',
          status: 'Processing',
          timestamp: Date.now(),
        });
      }
      return;
    }

    // --- Skip known UI chrome lines ---
    if (/^Welcome back/i.test(cleaned)) return;
    if (/^Tips for getting started/i.test(cleaned)) return;
    if (/^Run \/init/i.test(cleaned)) return;
    if (/^Recent activity/i.test(cleaned)) return;
    if (/^No recent activity/i.test(cleaned)) return;
    if (/shift\+tab to cycle/i.test(cleaned)) return;
    if (/\+tab to cycle/i.test(cleaned)) return;
    // Skip lines with "bypass permissions on" (status bar fragment)
    if (/bypass permissions on/i.test(cleaned)) return;
    // Skip lines with "running stop/start hooks" (sub-status)
    if (/running (?:stop|start) hooks/i.test(cleaned)) return;
    if (/^Claude Max/i.test(cleaned)) return;
    if (/claude-code\/getting-started/i.test(cleaned)) return;
    if (/has switched from npm to native/i.test(cleaned)) return;
    if (/^SessionStart/i.test(cleaned)) return;
    if (/^View Observations Live/i.test(cleaned)) return;
    if (/tokens of past research/i.test(cleaned)) return;
    if (/claude-mem skill/i.test(cleaned)) return;
    if (/^Opus[\s\d.]+|^Sonnet[\s\d.]+|^Haiku[\s\d.]+/i.test(cleaned)) return;
    // Skip lines that are just observation IDs/metadata from hooks
    if (/^#\d+\s/.test(cleaned) || /^#S\d+\s/.test(cleaned)) return;
    if (/tokens to read/i.test(cleaned)) return;
    if (/tokens spent on/i.test(cleaned)) return;
    if (/Context (?:Index|Economics)/i.test(cleaned)) return;
    if (/reduction from reuse/i.test(cleaned)) return;

    // --- Default: accumulate as response text ---
    if (this.state === 'thinking') {
      this.state = 'responding';
      this._removeThinkingIndicator();
    }

    this.textAccumulator += cleaned + '\n';

    // Debounced text emit
    clearTimeout(this._textEmitTimer);
    this._textEmitTimer = setTimeout(() => this._flushTextAccumulator(), 400);
  }

  _removeThinkingIndicator() {
    // State change only; the frontend handles removing the UI indicator
  }

  _flushTextAccumulator() {
    clearTimeout(this._textEmitTimer);
    const text = this.textAccumulator.trim();
    if (text && text.length > 1) {
      console.log(`[ANALYZER:${this.sessionId.substring(0,8)}] response_text (${text.length} chars): ${text.substring(0, 80)}`);
      this.emitAction({
        kind: 'response_text',
        text: text,
        timestamp: Date.now(),
      });
    }
    this.textAccumulator = '';
  }

  destroy() {
    clearTimeout(this.flushTimer);
    clearTimeout(this._textEmitTimer);
    clearTimeout(this._liveTimer);
    this._flushTextAccumulator();
  }
}

module.exports = { StreamAnalyzer };
