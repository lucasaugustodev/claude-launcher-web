import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll } from '@/lib/db';
import type { OpenClawSession } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/tasks/[id]/terminal-session
 * Returns the active launcher session(s) for a task, so the UI can connect via WebSocket.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  // Find active sessions for this task
  const sessions = queryAll<OpenClawSession & { agent_name?: string; agent_avatar_emoji?: string }>(
    `SELECT s.*, a.name as agent_name, a.avatar_emoji as agent_avatar_emoji
     FROM openclaw_sessions s
     LEFT JOIN agents a ON s.agent_id = a.id
     WHERE s.task_id = ? AND s.status = 'active'
     ORDER BY s.created_at DESC`,
    [id]
  );

  // Also try finding by agent assignment if task_id wasn't set (legacy sessions)
  if (sessions.length === 0) {
    const task = queryOne<{ assigned_agent_id: string }>('SELECT assigned_agent_id FROM tasks WHERE id = ?', [id]);
    if (task?.assigned_agent_id) {
      const agentSession = queryOne<OpenClawSession & { agent_name?: string; agent_avatar_emoji?: string }>(
        `SELECT s.*, a.name as agent_name, a.avatar_emoji as agent_avatar_emoji
         FROM openclaw_sessions s
         LEFT JOIN agents a ON s.agent_id = a.id
         WHERE s.agent_id = ? AND s.status = 'active'
         ORDER BY s.created_at DESC LIMIT 1`,
        [task.assigned_agent_id]
      );
      if (agentSession) sessions.push(agentSession);
    }
  }

  if (sessions.length === 0) {
    return NextResponse.json({ active: false, sessions: [] });
  }

  const LAUNCHER_WS = (process.env.CLAUDE_LAUNCHER_URL || 'http://localhost:3002').replace(/^http/, 'ws') + '/ws';

  const result = sessions.map(s => {
    const launcherSessionId = s.openclaw_session_id.startsWith('launcher:')
      ? s.openclaw_session_id.replace('launcher:', '')
      : null;

    return {
      id: s.id,
      launcherSessionId,
      agentName: s.agent_name || 'Agent',
      agentEmoji: s.agent_avatar_emoji || '🤖',
      status: s.status,
      createdAt: s.created_at,
    };
  }).filter(s => s.launcherSessionId); // Only return sessions with launcher IDs

  return NextResponse.json({
    active: result.length > 0,
    sessions: result,
    launcherWsUrl: LAUNCHER_WS,
  });
}
