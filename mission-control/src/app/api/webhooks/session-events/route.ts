import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { handleStageTransition, handleStageFailure } from '@/lib/workflow-engine';
import type { Task, Agent, OpenClawSession } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/session-events
 *
 * Receives real-time events from claude-launcher-web during agent sessions.
 * Handles: tool_use (file writes = deliverables), result messages, session exit.
 *
 * Payload:
 * {
 *   "launcher_session_id": "uuid",
 *   "event_type": "tool_use" | "result" | "assistant_message" | "session_exit",
 *   "data": { ... event-specific data }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { launcher_session_id, event_type, data } = body;
    const now = new Date().toISOString();

    if (!launcher_session_id || !event_type) {
      return NextResponse.json(
        { error: 'Missing launcher_session_id or event_type' },
        { status: 400 }
      );
    }

    // Find the Mission Control session + agent + task for this launcher session
    // Strategy: try exact match, then LIKE match, then match via launcher profile name
    let session = queryOne<OpenClawSession>(
      `SELECT * FROM openclaw_sessions WHERE openclaw_session_id = ? AND status = ?`,
      [`launcher:${launcher_session_id}`, 'active']
    );

    if (!session) {
      session = queryOne<OpenClawSession>(
        `SELECT * FROM openclaw_sessions WHERE openclaw_session_id LIKE ? AND status = ?`,
        [`%${launcher_session_id}%`, 'active']
      );
    }

    // Fallback: find any active session with a launcher: prefix (the most recent one)
    if (!session) {
      session = queryOne<OpenClawSession>(
        `SELECT * FROM openclaw_sessions WHERE openclaw_session_id LIKE 'launcher:%' AND status = 'active' ORDER BY updated_at DESC LIMIT 1`
      );
    }

    if (!session) {
      return NextResponse.json({ ignored: true, reason: 'No matching MC session', launcher_session_id });
    }

    const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [session.agent_id]);

    // Find active task for this agent
    const task = queryOne<Task>(
      `SELECT * FROM tasks WHERE assigned_agent_id = ? AND status IN ('assigned', 'in_progress') ORDER BY updated_at DESC LIMIT 1`,
      [session.agent_id]
    );

    if (!task) {
      return NextResponse.json({ ignored: true, reason: 'No active task for agent' });
    }

    switch (event_type) {
      case 'tool_use': {
        // Claude Code used a tool (Write, Edit, Bash, etc.)
        const toolName = data?.tool_name || data?.name || 'unknown';
        const filePath = data?.file_path || data?.path || null;

        // File write/edit = deliverable
        if (filePath && (toolName === 'Write' || toolName === 'Edit' || toolName === 'write' || toolName === 'edit')) {
          const fileName = filePath.split(/[/\\]/).pop() || filePath;

          // Register deliverable (avoid duplicates)
          const existing = queryOne(
            `SELECT id FROM task_deliverables WHERE task_id = ? AND path = ?`,
            [task.id, filePath]
          );

          if (!existing) {
            run(
              `INSERT INTO task_deliverables (id, task_id, deliverable_type, title, path, description, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [uuidv4(), task.id, 'file', fileName, filePath, `Auto-detected from ${toolName} tool call`, now]
            );

            // Log activity
            run(
              `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [uuidv4(), task.id, session.agent_id, 'file_created', `Created file: ${fileName}`, now]
            );

            { const t = queryOne('SELECT * FROM tasks WHERE id = ?', [task.id]); if (t) broadcast({ type: 'task_updated', payload: t as import('@/lib/types').Task }); }
          }
        }

        // Log all tool uses as activities
        run(
          `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [uuidv4(), task.id, session.agent_id, 'updated', `Used tool: ${toolName}${filePath ? ` on ${filePath}` : ''}`, now]
        );

        return NextResponse.json({ processed: true, event_type: 'tool_use' });
      }

      case 'result': {
        // Claude Code produced a result/response
        const content = data?.content || data?.message || '';

        // Check for TASK_COMPLETE signal
        const completeMatch = content.match(/TASK_COMPLETE:\s*(.+)/i);
        if (completeMatch) {
          const summary = completeMatch[1].trim();

          // Log completion activity
          run(
            `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [uuidv4(), task.id, session.agent_id, 'completed', `Task completed: ${summary}`, now]
          );

          // Move task to testing
          run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['testing', now, task.id]);

          // Reset agent to standby
          run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', ['standby', now, session.agent_id]);

          // Log event
          run(
            `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [uuidv4(), 'task_completed', session.agent_id, task.id, `${agent?.name || 'Agent'} completed: ${summary}`, now]
          );

          { const t = queryOne('SELECT * FROM tasks WHERE id = ?', [task.id]); if (t) broadcast({ type: 'task_updated', payload: t as import('@/lib/types').Task }); }

          return NextResponse.json({ processed: true, event_type: 'task_complete', summary });
        }

        // Handle AGENT_STOPPED from Claude Code Stop hook
        // This fires when Claude finishes its response — reliable signal from native hook
        if (content === 'AGENT_STOPPED' && data?.source === 'hook') {
          // Check if task has deliverables (evidence of work done)
          const deliverableCount = queryOne<{ cnt: number }>(
            'SELECT COUNT(*) as cnt FROM task_deliverables WHERE task_id = ?',
            [task.id]
          );
          const hasDeliverables = (deliverableCount?.cnt || 0) > 0;

          if (hasDeliverables && task.status === 'in_progress') {
            // Builder finished with deliverables — advance to next stage
            const { handleStageTransition: advanceStage } = await import('@/lib/workflow-engine');
            run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['testing', now, task.id]);
            run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', ['standby', now, session.agent_id]);
            run(
              `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [uuidv4(), task.id, session.agent_id, 'completed', `Agent completed work (detected via Stop hook). ${deliverableCount?.cnt} deliverable(s) found.`, now]
            );
            { const t = queryOne('SELECT * FROM tasks WHERE id = ?', [task.id]); if (t) broadcast({ type: 'task_updated', payload: t as import('@/lib/types').Task }); }

            // Trigger workflow handoff
            try { await advanceStage(task.id, 'testing'); } catch (e) { console.error('[session-events] Stage advance error:', e); }

            return NextResponse.json({ processed: true, event_type: 'agent_stopped_advance', deliverables: deliverableCount?.cnt });
          }

          return NextResponse.json({ processed: true, event_type: 'agent_stopped' });
        }

        // Check for TEST_FAIL / VERIFY_FAIL
        const failMatch = content.match(/(?:TEST_FAIL|VERIFY_FAIL):\s*(.+)/i);
        if (failMatch) {
          const reason = failMatch[1].trim();
          try {
            handleStageFailure(task.id, task.status, reason);
          } catch {
            // Fallback: just log it
            run(
              `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [uuidv4(), task.id, session.agent_id, 'updated', `Stage failed: ${reason}`, now]
            );
          }
          return NextResponse.json({ processed: true, event_type: 'stage_fail', reason });
        }

        return NextResponse.json({ processed: true, event_type: 'result' });
      }

      case 'session_exit': {
        const exitCode = data?.exit_code ?? data?.exitCode ?? null;

        // Mark session as inactive
        run(
          `UPDATE openclaw_sessions SET status = 'completed', updated_at = ? WHERE id = ?`,
          [now, session.id]
        );

        // If task is still in_progress and session exited, log it
        if (task.status === 'in_progress') {
          run(
            `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [uuidv4(), task.id, session.agent_id, 'updated', `Agent session ended (exit code: ${exitCode})`, now]
          );

          // Reset agent to standby
          run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', ['standby', now, session.agent_id]);
        }

        { const t = queryOne('SELECT * FROM tasks WHERE id = ?', [task.id]); if (t) broadcast({ type: 'task_updated', payload: t as import('@/lib/types').Task }); }

        return NextResponse.json({ processed: true, event_type: 'session_exit', exit_code: exitCode });
      }

      default:
        return NextResponse.json({ ignored: true, reason: `Unknown event_type: ${event_type}` });
    }
  } catch (error) {
    console.error('[session-events webhook] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
