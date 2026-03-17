'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { RefreshCw, Monitor } from 'lucide-react';
import 'xterm/css/xterm.css';

interface TerminalSession {
  id: string;
  launcherSessionId: string;
  agentName: string;
  agentEmoji: string;
  status: string;
  createdAt: string;
}

interface TerminalTabProps {
  taskId: string;
}

export function TerminalTab({ taskId }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import('xterm').Terminal | null>(null);
  const fitRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSession, setActiveSession] = useState<TerminalSession | null>(null);
  const [launcherWsUrl, setLauncherWsUrl] = useState<string>('');
  const [status, setStatus] = useState<'loading' | 'no-session' | 'connecting' | 'connected' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const loadSessions = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch(`/api/tasks/${taskId}/terminal-session`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setSessions(data.sessions || []);
      setLauncherWsUrl(data.launcherWsUrl || '');
      if (data.sessions?.length > 0) {
        setActiveSession(data.sessions[0]);
        setStatus('connecting');
      } else {
        setStatus('no-session');
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg((err as Error).message);
    }
  }, [taskId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Connect xterm when activeSession changes and container is mounted
  useEffect(() => {
    if (!activeSession || !launcherWsUrl) return;

    // Wait for containerRef to be available (next frame after render)
    const timer = setTimeout(() => {
      if (!containerRef.current) return;

      let cancelled = false;
      let cleanupResize: (() => void) | null = null;

      const initTerminal = async () => {
        const { Terminal } = await import('xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        if (cancelled || !containerRef.current) return;

        // Clean up previous
        if (termRef.current) termRef.current.dispose();
        if (wsRef.current) wsRef.current.close();
        containerRef.current.innerHTML = '';

        const term = new Terminal({
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
          },
          fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
          fontSize: 13,
          cursorBlink: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);

        termRef.current = term;
        fitRef.current = fitAddon;

        setTimeout(() => {
          if (!cancelled && fitRef.current) fitRef.current.fit();
        }, 100);

        // Connect WebSocket to launcher
        setStatus('connecting');
        const ws = new WebSocket(launcherWsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          setStatus('connected');
          ws.send(JSON.stringify({
            type: 'attach',
            sessionId: activeSession.launcherSessionId,
          }));
        };

        ws.onmessage = (event) => {
          if (cancelled) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.sessionId !== activeSession.launcherSessionId) return;

            if (msg.type === 'output' && termRef.current) {
              termRef.current.write(msg.data);
            } else if (msg.type === 'exit') {
              if (termRef.current) {
                termRef.current.write(`\r\n\x1b[33m[Session ended (code: ${msg.exitCode || 0})]\x1b[0m\r\n`);
              }
            }
          } catch {
            // ignore parse errors
          }
        };

        ws.onerror = () => {
          if (!cancelled) {
            setStatus('error');
            setErrorMsg('WebSocket connection failed. Is the launcher running?');
          }
        };

        ws.onclose = () => {
          if (!cancelled) {
            // Only show error if we were previously connected
          }
        };

        // Handle terminal input -> send to launcher
        term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'input',
              sessionId: activeSession.launcherSessionId,
              data,
            }));
          }
        });

        // Handle Ctrl+C (copy) and Ctrl+V (paste)
        term.attachCustomKeyEventHandler((e) => {
          if (e.type === 'keydown' && e.ctrlKey && e.key === 'c') {
            const selection = term.getSelection();
            if (selection) {
              navigator.clipboard.writeText(selection).catch(() => {});
              term.clearSelection();
              return false;
            }
          }
          if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
            navigator.clipboard.readText().then((text) => {
              if (text && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'input',
                  sessionId: activeSession.launcherSessionId,
                  data: text,
                }));
              }
            }).catch(() => {});
            return false;
          }
          return true;
        });

        // Handle resize
        const handleResize = () => {
          if (fitRef.current && termRef.current && ws.readyState === WebSocket.OPEN) {
            fitRef.current.fit();
            ws.send(JSON.stringify({
              type: 'resize',
              sessionId: activeSession.launcherSessionId,
              cols: termRef.current.cols,
              rows: termRef.current.rows,
            }));
          }
        };
        window.addEventListener('resize', handleResize);
        cleanupResize = () => window.removeEventListener('resize', handleResize);
      };

      initTerminal();

      return () => {
        cancelled = true;
        if (cleanupResize) cleanupResize();
        if (wsRef.current) {
          try {
            wsRef.current.send(JSON.stringify({
              type: 'detach',
              sessionId: activeSession.launcherSessionId,
            }));
          } catch {}
          wsRef.current.close();
          wsRef.current = null;
        }
        if (termRef.current) {
          termRef.current.dispose();
          termRef.current = null;
        }
        fitRef.current = null;
      };
    }, 50); // Small delay to let React mount the container

    return () => {
      clearTimeout(timer);
      if (wsRef.current) {
        try {
          wsRef.current.send(JSON.stringify({
            type: 'detach',
            sessionId: activeSession.launcherSessionId,
          }));
        } catch {}
        wsRef.current.close();
        wsRef.current = null;
      }
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
      fitRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, launcherWsUrl]);

  const showTerminal = status === 'connecting' || status === 'connected' || status === 'error';

  return (
    <div className="flex flex-col h-full" style={{ minHeight: '400px' }}>
      {/* Loading overlay */}
      {status === 'loading' && (
        <div className="flex items-center justify-center py-12 text-mc-text-secondary">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          Loading terminal sessions...
        </div>
      )}

      {/* No session */}
      {status === 'no-session' && (
        <div className="flex flex-col items-center justify-center py-12 text-mc-text-secondary">
          <Monitor className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">No active agent session for this task</p>
          <button
            onClick={loadSessions}
            className="mt-3 text-xs text-mc-accent hover:underline"
          >
            Refresh
          </button>
        </div>
      )}

      {/* Terminal view */}
      {showTerminal && (
        <>
          {/* Session selector (if multiple) */}
          {sessions.length > 1 && (
            <div className="flex gap-2 mb-2 flex-shrink-0">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSession(s)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs transition-colors ${
                    activeSession?.id === s.id
                      ? 'bg-mc-accent text-mc-bg font-medium'
                      : 'bg-mc-bg text-mc-text-secondary hover:bg-mc-bg-tertiary'
                  }`}
                >
                  <span>{s.agentEmoji}</span>
                  <span>{s.agentName}</span>
                </button>
              ))}
            </div>
          )}

          {/* Status bar */}
          <div className="flex items-center gap-2 mb-2 flex-shrink-0">
            <span className={`w-2 h-2 rounded-full ${
              status === 'connected' ? 'bg-green-500' :
              status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
              'bg-red-500'
            }`} />
            <span className="text-xs text-mc-text-secondary">
              {activeSession && (
                <>
                  <span>{activeSession.agentEmoji} {activeSession.agentName}</span>
                  <span className="mx-1">-</span>
                </>
              )}
              {status === 'connected' ? 'Connected' :
               status === 'connecting' ? 'Connecting...' :
               status === 'error' ? errorMsg : ''}
            </span>
            {status === 'error' && (
              <button
                onClick={loadSessions}
                className="text-xs text-mc-accent hover:underline ml-auto"
              >
                Retry
              </button>
            )}
          </div>

          {/* Terminal container */}
          <div
            ref={containerRef}
            className="flex-1 rounded-lg overflow-hidden border border-mc-border"
            style={{ minHeight: '350px', background: '#1e1e2e' }}
          />
        </>
      )}
    </div>
  );
}
