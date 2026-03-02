const cron = require('node-cron');
const { v4: uuid } = require('uuid');

let _storage = null;
let _ptyManager = null;
let _broadcast = () => {};

// Active jobs: scheduleId -> { task (cron.ScheduledTask | intervalId | timeoutId), type }
const activeJobs = new Map();

// Running sessions from schedules: scheduleId -> sessionId
const runningSessions = new Map();

function init(storage, ptyManager, broadcast) {
  _storage = storage;
  _ptyManager = ptyManager;
  _broadcast = broadcast;

  // Register all enabled schedules
  const schedules = _storage.getSchedules();
  let registered = 0;
  for (const schedule of schedules) {
    if (schedule.enabled) {
      registerJob(schedule);
      registered++;
    }
  }
  if (registered > 0) {
    console.log(`[SCHEDULER] Initialized ${registered} active schedule(s)`);
  }
}

function registerJob(schedule) {
  // Remove existing job if any
  unregisterJob(schedule.id);

  if (!schedule.enabled) return;

  if (schedule.type === 'cron') {
    if (!cron.validate(schedule.cron)) {
      console.error(`[SCHEDULER] Invalid cron expression for "${schedule.name}": ${schedule.cron}`);
      return;
    }
    const task = cron.schedule(schedule.cron, () => {
      executeSchedule(schedule.id);
    });
    activeJobs.set(schedule.id, { task, type: 'cron' });
    console.log(`[SCHEDULER] Registered cron job "${schedule.name}": ${schedule.cron}`);

  } else if (schedule.type === 'interval') {
    const ms = (schedule.intervalMinutes || 30) * 60 * 1000;
    const intervalId = setInterval(() => {
      executeSchedule(schedule.id);
    }, ms);
    activeJobs.set(schedule.id, { task: intervalId, type: 'interval' });
    console.log(`[SCHEDULER] Registered interval job "${schedule.name}": every ${schedule.intervalMinutes}min`);

  } else if (schedule.type === 'once') {
    const runAt = new Date(schedule.runAt);
    const delay = runAt.getTime() - Date.now();
    if (delay <= 0) {
      console.log(`[SCHEDULER] One-time job "${schedule.name}" already past, skipping`);
      return;
    }
    const timeoutId = setTimeout(() => {
      executeSchedule(schedule.id);
      // Disable after one-time execution
      _storage.updateSchedule(schedule.id, { enabled: false, updatedAt: new Date().toISOString() });
      unregisterJob(schedule.id);
    }, delay);
    activeJobs.set(schedule.id, { task: timeoutId, type: 'once' });
    console.log(`[SCHEDULER] Registered one-time job "${schedule.name}": ${schedule.runAt}`);
  }
}

function unregisterJob(scheduleId) {
  const job = activeJobs.get(scheduleId);
  if (!job) return;

  if (job.type === 'cron') {
    job.task.stop();
  } else if (job.type === 'interval') {
    clearInterval(job.task);
  } else if (job.type === 'once') {
    clearTimeout(job.task);
  }

  activeJobs.delete(scheduleId);
}

async function executeSchedule(scheduleId) {
  // Re-read schedule from storage to get latest config
  const schedule = _storage.getSchedule(scheduleId);
  if (!schedule || !schedule.enabled) return;

  // Concurrency guard: check if previous session from this schedule is still running
  const prevSessionId = runningSessions.get(scheduleId);
  if (prevSessionId) {
    const activeSessions = _ptyManager.getActiveSessions();
    const stillRunning = activeSessions.some(s => s.id === prevSessionId);
    if (stillRunning) {
      const logEntry = {
        id: uuid(),
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        sessionId: null,
        targetType: schedule.targetType,
        targetName: resolveTargetName(schedule),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'skipped',
        error: 'Previous session still running',
        exitCode: null,
      };
      _storage.addScheduleLogEntry(logEntry);
      _broadcast({ type: 'schedule:skipped', scheduleId: schedule.id, scheduleName: schedule.name });
      console.log(`[SCHEDULER] Skipped "${schedule.name}": previous session still running`);
      return;
    }
  }

  try {
    const session = await launchTarget(schedule);

    const logEntry = {
      id: uuid(),
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      sessionId: session.id,
      targetType: schedule.targetType,
      targetName: resolveTargetName(schedule),
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: 'running',
      error: null,
      exitCode: null,
    };
    _storage.addScheduleLogEntry(logEntry);

    runningSessions.set(scheduleId, session.id);

    _storage.updateSchedule(scheduleId, {
      lastRun: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    _broadcast({
      type: 'schedule:started',
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      sessionId: session.id,
    });

    console.log(`[SCHEDULER] Launched "${schedule.name}" -> session ${session.id}`);

    // Watch for session completion
    watchSessionCompletion(scheduleId, session.id, logEntry.id);

  } catch (err) {
    const logEntry = {
      id: uuid(),
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      sessionId: null,
      targetType: schedule.targetType,
      targetName: resolveTargetName(schedule),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status: 'failed',
      error: err.message,
      exitCode: null,
    };
    _storage.addScheduleLogEntry(logEntry);

    _broadcast({
      type: 'schedule:completed',
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      sessionId: null,
      status: 'failed',
      error: err.message,
    });

    console.error(`[SCHEDULER] Failed to launch "${schedule.name}":`, err.message);
  }
}

async function launchTarget(schedule) {
  const config = schedule.targetConfig || {};
  const prompt = schedule.prompt || null;

  if (schedule.targetType === 'profile') {
    return await _ptyManager.launchSession(schedule.targetId, {
      streamJson: config.streamJson || false,
      prompt,
    });

  } else if (schedule.targetType === 'agent') {
    return _ptyManager.launchAgent({
      agentName: schedule.targetId,
      workingDirectory: config.workingDirectory,
      mode: config.mode,
      nodeMemory: config.nodeMemory,
      streamJson: config.streamJson || false,
      prompt,
    });

  } else if (schedule.targetType === 'apm') {
    return _ptyManager.launchDirect({
      prompt,
      workingDirectory: config.workingDirectory,
      mode: config.mode,
      nodeMemory: config.nodeMemory,
      name: `APM: ${schedule.targetId}`,
      streamJson: config.streamJson || false,
    });

  } else {
    throw new Error(`Unknown target type: ${schedule.targetType}`);
  }
}

function watchSessionCompletion(scheduleId, sessionId, logEntryId) {
  // Poll for session completion
  const pollInterval = setInterval(() => {
    const activeSessions = _ptyManager.getActiveSessions();
    const stillRunning = activeSessions.some(s => s.id === sessionId);

    if (!stillRunning) {
      clearInterval(pollInterval);
      runningSessions.delete(scheduleId);

      // Get session info from storage for exit status
      const sessionRecord = _storage.getSession(sessionId);
      const exitCode = sessionRecord ? sessionRecord.exitCode : null;
      const status = sessionRecord && sessionRecord.status === 'completed' ? 'completed' : 'failed';

      _storage.updateScheduleLogEntry(logEntryId, {
        completedAt: new Date().toISOString(),
        status,
        exitCode,
      });

      const schedule = _storage.getSchedule(scheduleId);
      _broadcast({
        type: 'schedule:completed',
        scheduleId,
        scheduleName: schedule ? schedule.name : 'Unknown',
        sessionId,
        status,
        exitCode,
      });

      console.log(`[SCHEDULER] Session ${sessionId} completed (status=${status}, exitCode=${exitCode})`);
    }
  }, 5000);

  // Safety: stop polling after 24h
  setTimeout(() => clearInterval(pollInterval), 24 * 60 * 60 * 1000);
}

function resolveTargetName(schedule) {
  if (schedule.targetType === 'profile') {
    const profile = _storage.getProfile(schedule.targetId);
    return profile ? profile.name : schedule.targetId;
  }
  return schedule.targetId;
}

function getStatus() {
  const jobs = [];
  for (const [scheduleId, job] of activeJobs) {
    const schedule = _storage.getSchedule(scheduleId);
    jobs.push({
      scheduleId,
      name: schedule ? schedule.name : 'Unknown',
      type: job.type,
      running: runningSessions.has(scheduleId),
    });
  }
  return { activeJobs: jobs.length, jobs };
}

function shutdown() {
  for (const [scheduleId] of activeJobs) {
    unregisterJob(scheduleId);
  }
  console.log('[SCHEDULER] All jobs stopped');
}

module.exports = {
  init,
  registerJob,
  unregisterJob,
  executeSchedule,
  shutdown,
  getStatus,
};
