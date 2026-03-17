/**
 * Claude Launcher Web Client
 *
 * HTTP client that talks to claude-launcher-web (port 3001) to spawn
 * and manage Claude Code sessions as the execution backend for Mission Control.
 *
 * Replaces OpenClaw Gateway for agent execution.
 */

const LAUNCHER_URL = process.env.CLAUDE_LAUNCHER_URL || 'http://localhost:3002';

export interface LauncherProfile {
  id: string;
  name: string;
  workingDirectory: string;
  mode?: string;
  initialPrompt?: string;
}

export interface LauncherSession {
  id: string;
  profileId: string;
  pid?: number;
  status: string;
  workingDirectory?: string;
  claudeSessionId?: string;
}

export interface LauncherStatus {
  connected: boolean;
  sessions: LauncherSession[];
  error?: string;
}

/**
 * Check if claude-launcher-web is running
 */
export async function checkLauncherStatus(): Promise<LauncherStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${LAUNCHER_URL}/api/auth/status`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { connected: false, sessions: [], error: `HTTP ${res.status}` };
    }

    // Also get active sessions
    let sessions: LauncherSession[] = [];
    try {
      const sessRes = await fetch(`${LAUNCHER_URL}/api/sessions`);
      if (sessRes.ok) {
        sessions = await sessRes.json();
      }
    } catch {
      // Sessions fetch is best-effort
    }

    return { connected: true, sessions };
  } catch (err) {
    return {
      connected: false,
      sessions: [],
      error: `Failed to connect to Claude Launcher at ${LAUNCHER_URL}`,
    };
  }
}

/**
 * Get or create a profile in claude-launcher-web for a Mission Control agent
 */
export async function ensureProfile(
  agentId: string,
  agentName: string,
  workingDirectory: string,
  soulMd?: string | null,
): Promise<LauncherProfile> {
  const profileName = `mc-${agentName.toLowerCase().replace(/\s+/g, '-')}`;

  // Check if profile already exists
  const listRes = await fetch(`${LAUNCHER_URL}/api/profiles`);
  if (listRes.ok) {
    const profiles: LauncherProfile[] = await listRes.json();
    const existing = profiles.find(p => p.name === profileName);
    if (existing) {
      return existing;
    }
  }

  // Create new profile
  const createRes = await fetch(`${LAUNCHER_URL}/api/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: profileName,
      workingDirectory,
      mode: 'bypass',
      description: `Mission Control agent: ${agentName} (${agentId})`,
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create launcher profile: ${await createRes.text()}`);
  }

  return createRes.json();
}

/**
 * Launch a Claude Code session via claude-launcher-web
 *
 * This spawns a new Claude Code process with the given prompt,
 * using stream-json mode for structured output.
 * Supports system prompt injection via --append-system-prompt flag.
 */
export async function launchSession(
  profileId: string,
  prompt: string,
  options: {
    streamJson?: boolean;
    workingDirectory?: string;
    systemPrompt?: string | null;
    appendSystemPrompt?: string | null;
  } = {},
): Promise<LauncherSession> {
  const body: Record<string, unknown> = {
    profileId,
    streamJson: options.streamJson ?? false,
    prompt,
  };
  if (options.systemPrompt) body.systemPrompt = options.systemPrompt;
  if (options.appendSystemPrompt) body.appendSystemPrompt = options.appendSystemPrompt;

  const res = await fetch(`${LAUNCHER_URL}/api/sessions/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to launch session: ${errorText}`);
  }

  return res.json();
}

/**
 * Stop a running session
 */
export async function stopSession(sessionId: string): Promise<void> {
  const res = await fetch(`${LAUNCHER_URL}/api/sessions/${sessionId}/stop`, {
    method: 'POST',
  });

  if (!res.ok) {
    throw new Error(`Failed to stop session: ${await res.text()}`);
  }
}

/**
 * Get active sessions from the launcher
 */
export async function getActiveSessions(): Promise<LauncherSession[]> {
  const res = await fetch(`${LAUNCHER_URL}/api/sessions`);
  if (!res.ok) return [];
  return res.json();
}

/**
 * Get the launcher base URL
 */
export function getLauncherUrl(): string {
  return LAUNCHER_URL;
}
