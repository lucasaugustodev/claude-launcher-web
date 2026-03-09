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

// ─── Gemini Sessions ───

function getGeminiSessions() {
  return readJSON('gemini-sessions.json', []);
}

function saveGeminiSessions(sessions) {
  writeJSON('gemini-sessions.json', sessions);
}

function getGeminiSession(id) {
  return getGeminiSessions().find(s => s.id === id) || null;
}

function addGeminiSession(session) {
  const sessions = getGeminiSessions();
  sessions.push(session);
  saveGeminiSessions(sessions);
  return session;
}

function updateGeminiSession(id, updates) {
  const sessions = getGeminiSessions();
  const idx = sessions.findIndex(s => s.id === id);
  if (idx === -1) return null;
  sessions[idx] = { ...sessions[idx], ...updates };
  saveGeminiSessions(sessions);
  return sessions[idx];
}

function clearGeminiHistory() {
  const sessions = getGeminiSessions().filter(s => s.status === 'running');
  saveGeminiSessions(sessions);
}

// ─── GWS Sessions ───

function getGwsSessions() {
  return readJSON('gws-sessions.json', []);
}

function saveGwsSessions(sessions) {
  writeJSON('gws-sessions.json', sessions);
}

function getGwsSession(id) {
  return getGwsSessions().find(s => s.id === id) || null;
}

function addGwsSession(session) {
  const sessions = getGwsSessions();
  sessions.push(session);
  saveGwsSessions(sessions);
  return session;
}

function updateGwsSession(id, updates) {
  const sessions = getGwsSessions();
  const idx = sessions.findIndex(s => s.id === id);
  if (idx === -1) return null;
  sessions[idx] = { ...sessions[idx], ...updates };
  saveGwsSessions(sessions);
  return sessions[idx];
}

function clearGwsHistory() {
  const sessions = getGwsSessions().filter(s => s.status === 'running');
  saveGwsSessions(sessions);
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

// ─── Skills ───

function getSkills() {
  return readJSON('skills.json', []);
}

function saveSkills(skills) {
  writeJSON('skills.json', skills);
}

function getSkill(id) {
  return getSkills().find(s => s.id === id) || null;
}

function addSkill(skill) {
  const skills = getSkills();
  skills.push(skill);
  saveSkills(skills);
  return skill;
}

function updateSkill(id, updates) {
  const skills = getSkills();
  const idx = skills.findIndex(s => s.id === id);
  if (idx === -1) return null;
  skills[idx] = { ...skills[idx], ...updates, id };
  saveSkills(skills);
  return skills[idx];
}

function deleteSkill(id) {
  const skills = getSkills().filter(s => s.id !== id);
  saveSkills(skills);
}

// ─── Workflows ───

function getWorkflows() {
  return readJSON('workflows.json', []);
}

function saveWorkflows(workflows) {
  writeJSON('workflows.json', workflows);
}

function getWorkflow(id) {
  return getWorkflows().find(w => w.id === id) || null;
}

function addWorkflow(workflow) {
  const workflows = getWorkflows();
  workflows.push(workflow);
  saveWorkflows(workflows);
  return workflow;
}

function updateWorkflow(id, updates) {
  const workflows = getWorkflows();
  const idx = workflows.findIndex(w => w.id === id);
  if (idx === -1) return null;
  workflows[idx] = { ...workflows[idx], ...updates, id };
  saveWorkflows(workflows);
  return workflows[idx];
}

function deleteWorkflow(id) {
  const workflows = getWorkflows().filter(w => w.id !== id);
  saveWorkflows(workflows);
}

module.exports = {
  getProfiles, saveProfiles, getProfile, addProfile, updateProfile, deleteProfile,
  getSessions, saveSessions, getSession, addSession, updateSession, clearHistory,
  getClineSessions, saveClineSessions, getClineSession, addClineSession, updateClineSession, clearClineHistory,
  getGeminiSessions, saveGeminiSessions, getGeminiSession, addGeminiSession, updateGeminiSession, clearGeminiHistory,
  getUsers, saveUsers, findUser, addUser, hasUsers,
  getGitHubConfig, saveGitHubConfig,
  getSchedules, getSchedule, addSchedule, updateSchedule, deleteSchedule, toggleSchedule,
  getScheduleLog, addScheduleLogEntry, updateScheduleLogEntry, clearScheduleLog, getScheduleLogBySchedule,
  getSkills, saveSkills, getSkill, addSkill, updateSkill, deleteSkill,
  getWorkflows, saveWorkflows, getWorkflow, addWorkflow, updateWorkflow, deleteWorkflow,
};
