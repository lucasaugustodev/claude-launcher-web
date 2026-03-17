import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import type { Agent } from '@/lib/types';

export const dynamic = 'force-dynamic';

const LAUNCHER_URL = process.env.CLAUDE_LAUNCHER_URL || 'http://localhost:3002';

/**
 * GET /api/agents/import-launcher
 * List available launcher profiles that can be imported as MC agents
 */
export async function GET() {
  try {
    const res = await fetch(`${LAUNCHER_URL}/api/profiles`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch launcher profiles' }, { status: 502 });
    }

    const profiles = await res.json();

    // Mark which ones are already linked to MC agents
    const existingLinks = queryAll<{ launcher_profile_id: string; id: string; name: string }>(
      `SELECT launcher_profile_id, id, name FROM agents WHERE launcher_profile_id IS NOT NULL`
    );
    const linkMap = new Map(existingLinks.map(l => [l.launcher_profile_id, { id: l.id, name: l.name }]));

    const enriched = profiles.map((p: { id: string; name: string; workingDirectory?: string; mode?: string; initialPrompt?: string }) => ({
      ...p,
      linked: linkMap.has(p.id),
      linkedAgent: linkMap.get(p.id) || null,
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    return NextResponse.json(
      { error: `Launcher not reachable: ${(err as Error).message}` },
      { status: 503 }
    );
  }
}

/**
 * POST /api/agents/import-launcher
 * Import a launcher profile as an MC agent, or link an existing agent to a launcher profile.
 *
 * Body:
 * {
 *   "launcher_profile_id": "uuid",
 *   "agent_id"?: "uuid",          // If provided, link to existing agent instead of creating new
 *   "name"?: "Agent Name",
 *   "role"?: "builder",
 *   "workspace_id"?: "default",
 *   "soul_md"?: "System prompt...",
 *   "avatar_emoji"?: "🤖"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { launcher_profile_id, agent_id, name, role, workspace_id, soul_md, avatar_emoji } = body;

    if (!launcher_profile_id) {
      return NextResponse.json({ error: 'launcher_profile_id is required' }, { status: 400 });
    }

    // Fetch the launcher profile to verify it exists
    const profileRes = await fetch(`${LAUNCHER_URL}/api/profiles`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!profileRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch launcher profiles' }, { status: 502 });
    }
    const profiles = await profileRes.json();
    const profile = profiles.find((p: { id: string }) => p.id === launcher_profile_id);
    if (!profile) {
      return NextResponse.json({ error: 'Launcher profile not found' }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (agent_id) {
      // Link existing agent to launcher profile
      const existing = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [agent_id]);
      if (!existing) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      }

      run(
        `UPDATE agents SET launcher_profile_id = ?, updated_at = ? WHERE id = ?`,
        [launcher_profile_id, now, agent_id]
      );

      const updated = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [agent_id]);
      if (updated) broadcast({ type: 'agent_updated', payload: updated as unknown as import('@/lib/types').Task });
      return NextResponse.json(updated);
    }

    // Create new agent from launcher profile
    const agentName = name || profile.name.replace(/^mc-/, '').replace(/-/g, ' ');
    const agentRole = role || 'builder';
    const id = uuidv4();

    run(
      `INSERT INTO agents (id, name, role, description, avatar_emoji, is_master, workspace_id, soul_md, launcher_profile_id, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'launcher', ?, ?)`,
      [
        id,
        agentName,
        agentRole,
        `Imported from Claude Launcher profile: ${profile.name}`,
        avatar_emoji || '🤖',
        workspace_id || 'default',
        soul_md || null,
        launcher_profile_id,
        now,
        now,
      ]
    );

    run(
      `INSERT INTO events (id, type, agent_id, message, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), 'agent_joined', id, `${agentName} imported from launcher profile "${profile.name}"`, now]
    );

    const agent = queryOne<Agent>('SELECT * FROM agents WHERE id = ?', [id]);
    if (agent) broadcast({ type: 'agent_updated', payload: agent as unknown as import('@/lib/types').Task });
    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    console.error('Failed to import launcher profile:', error);
    return NextResponse.json({ error: 'Failed to import' }, { status: 500 });
  }
}
