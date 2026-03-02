const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(filename, defaultValue = []) {
  ensureDir();
  const fp = path.join(DATA_DIR, filename);
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function writeJSON(filename, data) {
  ensureDir();
  const fp = path.join(DATA_DIR, filename);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Profiles ───

function getProfiles() {
  return readJSON('profiles.json', []);
}

function saveProfiles(profiles) {
  writeJSON('profiles.json', profiles);
}

function getProfile(id) {
  return getProfiles().find(p => p.id === id) || null;
}

function addProfile(profile) {
  const profiles = getProfiles();
  profiles.push(profile);
  saveProfiles(profiles);
  return profile;
}

function updateProfile(id, updates) {
  const profiles = getProfiles();
  const idx = profiles.findIndex(p => p.id === id);
  if (idx === -1) return null;
  profiles[idx] = { ...profiles[idx], ...updates, id };
  saveProfiles(profiles);
  return profiles[idx];
}

function deleteProfile(id) {
  const profiles = getProfiles().filter(p => p.id !== id);
  saveProfiles(profiles);
}

// ─── Sessions ───

function getSessions() {
  return readJSON('sessions.json', []);
}

function saveSessions(sessions) {
  writeJSON('sessions.json', sessions);
}

function getSession(id) {
  return getSessions().find(s => s.id === id) || null;
}

function addSession(session) {
  const sessions = getSessions();
  sessions.push(session);
  saveSessions(sessions);
  return session;
}

function updateSession(id, updates) {
  const sessions = getSessions();
  const idx = sessions.findIndex(s => s.id === id);
  if (idx === -1) return null;
  sessions[idx] = { ...sessions[idx], ...updates };
  saveSessions(sessions);
  return sessions[idx];
}

function clearHistory() {
  const sessions = getSessions().filter(s => s.status === 'running');
  saveSessions(sessions);
}

// ─── Cline Sessions ───

function getClineSessions() {
  return readJSON('cline-sessions.json', []);
}

function saveClineSessions(sessions) {
  writeJSON('cline-sessions.json', sessions);
}

function getClineSession(id) {
  return getClineSessions().find(s => s.id === id) || null;
}

function addClineSession(session) {
  const sessions = getClineSessions();
  sessions.push(session);
  saveClineSessions(sessions);
  return session;
}

function updateClineSession(id, updates) {
  const sessions = getClineSessions();
  const idx = sessions.findIndex(s => s.id === id);
  if (idx === -1) return null;
  sessions[idx] = { ...sessions[idx], ...updates };
  saveClineSessions(sessions);
  return sessions[idx];
}

function clearClineHistory() {
  const sessions = getClineSessions().filter(s => s.status === 'running');
  saveClineSessions(sessions);
}

// ─── Users ───

function getUsers() {
  return readJSON('users.json', []);
}

function saveUsers(users) {
  writeJSON('users.json', users);
}

function findUser(username) {
  return getUsers().find(u => u.username === username) || null;
}

function addUser(user) {
  const users = getUsers();
  users.push(user);
  saveUsers(users);
  return user;
}

function hasUsers() {
  return getUsers().length > 0;
}

// ─── GitHub Config ───

function getGitHubConfig() {
  return readJSON('github-config.json', null);
}

function saveGitHubConfig(config) {
  writeJSON('github-config.json', config);
}

// ─── Schedules ───

function getSchedules() {
  return readJSON('schedules.json', []);
}

function getSchedule(id) {
  return getSchedules().find(s => s.id === id) || null;
}

function addSchedule(schedule) {
  const schedules = getSchedules();
  schedules.push(schedule);
  writeJSON('schedules.json', schedules);
  return schedule;
}

function updateSchedule(id, updates) {
  const schedules = getSchedules();
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) return null;
  schedules[idx] = { ...schedules[idx], ...updates, id };
  writeJSON('schedules.json', schedules);
  return schedules[idx];
}

function deleteSchedule(id) {
  const schedules = getSchedules().filter(s => s.id !== id);
  writeJSON('schedules.json', schedules);
}

function toggleSchedule(id) {
  const schedules = getSchedules();
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) return null;
  schedules[idx].enabled = !schedules[idx].enabled;
  schedules[idx].updatedAt = new Date().toISOString();
  writeJSON('schedules.json', schedules);
  return schedules[idx];
}

// ─── Schedule Log ───

const SCHEDULE_LOG_CAP = 500;

function getScheduleLog(limit = 100) {
  const log = readJSON('schedule-log.json', []);
  // Most recent first
  log.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  return log.slice(0, limit);
}

function addScheduleLogEntry(entry) {
  const log = readJSON('schedule-log.json', []);
  log.push(entry);
  // Cap at SCHEDULE_LOG_CAP, remove oldest
  if (log.length > SCHEDULE_LOG_CAP) {
    log.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    log.length = SCHEDULE_LOG_CAP;
  }
  writeJSON('schedule-log.json', log);
  return entry;
}

function updateScheduleLogEntry(id, updates) {
  const log = readJSON('schedule-log.json', []);
  const idx = log.findIndex(e => e.id === id);
  if (idx === -1) return null;
  log[idx] = { ...log[idx], ...updates };
  writeJSON('schedule-log.json', log);
  return log[idx];
}

function clearScheduleLog() {
  writeJSON('schedule-log.json', []);
}

function getScheduleLogBySchedule(scheduleId) {
  const log = readJSON('schedule-log.json', []);
  return log.filter(e => e.scheduleId === scheduleId)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

module.exports = {
  getProfiles, saveProfiles, getProfile, addProfile, updateProfile, deleteProfile,
  getSessions, saveSessions, getSession, addSession, updateSession, clearHistory,
  getClineSessions, saveClineSessions, getClineSession, addClineSession, updateClineSession, clearClineHistory,
  getUsers, saveUsers, findUser, addUser, hasUsers,
  getGitHubConfig, saveGitHubConfig,
  getSchedules, getSchedule, addSchedule, updateSchedule, deleteSchedule, toggleSchedule,
  getScheduleLog, addScheduleLogEntry, updateScheduleLogEntry, clearScheduleLog, getScheduleLogBySchedule,
};
