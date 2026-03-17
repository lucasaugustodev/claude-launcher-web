import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { checkLauncherStatus } from '@/lib/claude-launcher/client';

export const dynamic = 'force-dynamic';

const EXECUTOR_BACKEND = process.env.EXECUTOR_BACKEND || 'claude-launcher';

// GET /api/openclaw/status - Check execution backend connection status
export async function GET() {
  try {
    // If using claude-launcher backend, check that instead
    if (EXECUTOR_BACKEND === 'claude-launcher') {
      const status = await checkLauncherStatus();
      return NextResponse.json({
        connected: status.connected,
        backend: 'claude-launcher',
        sessions_count: status.sessions.length,
        sessions: status.sessions,
        launcher_url: process.env.CLAUDE_LAUNCHER_URL || 'http://localhost:3002',
        error: status.error,
      });
    }

    // Original OpenClaw check
    const client = getOpenClawClient();

    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch (err) {
        return NextResponse.json({
          connected: false,
          backend: 'openclaw',
          error: 'Failed to connect to OpenClaw Gateway',
          gateway_url: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
        });
      }
    }

    // Try to list sessions to verify connection
    try {
      const sessions = await client.listSessions();
      return NextResponse.json({
        connected: true,
        backend: 'openclaw',
        sessions_count: sessions.length,
        sessions: sessions,
        gateway_url: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
      });
    } catch (err) {
      return NextResponse.json({
        connected: true,
        backend: 'openclaw',
        error: 'Connected but failed to list sessions',
        gateway_url: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
      });
    }
  } catch (error) {
    console.error('Status check failed:', error);
    return NextResponse.json(
      {
        connected: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
