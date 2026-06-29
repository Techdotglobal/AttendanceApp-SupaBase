/**
 * Extended schedule config (frequency, last run) stored on disk.
 * Core day/autoSend settings remain in the companies table.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../data/schedule-config.json');
const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly'];

function ensureConfigFile() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({}, null, 2), 'utf8');
  }
}

function loadConfig() {
  ensureConfigFile();
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  ensureConfigFile();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function getExtendedSchedule(companyId) {
  const config = loadConfig();
  const entry = config[companyId] || {};
  const frequency = VALID_FREQUENCIES.includes(entry.frequency) ? entry.frequency : 'monthly';
  return {
    frequency,
    lastExecution: entry.lastExecution || null,
    lastStatus: entry.lastStatus || null,
    nextExecution: computeNextExecution(frequency, entry),
  };
}

function setExtendedSchedule(companyId, { frequency }) {
  const config = loadConfig();
  if (!config[companyId]) config[companyId] = {};
  if (frequency !== undefined) {
    if (!VALID_FREQUENCIES.includes(frequency)) {
      throw new Error('frequency must be daily, weekly, or monthly');
    }
    config[companyId].frequency = frequency;
  }
  saveConfig(config);
  return getExtendedSchedule(companyId);
}

function recordScheduleExecution(companyId, status) {
  const config = loadConfig();
  if (!config[companyId]) config[companyId] = {};
  config[companyId].lastExecution = new Date().toISOString();
  config[companyId].lastStatus = status;
  saveConfig(config);
}

function computeNextExecution(frequency, entry) {
  const now = new Date();
  const next = new Date(now);

  switch (frequency) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCHours(2, 0, 0, 0);
      break;
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + ((8 - next.getUTCDay()) % 7 || 7));
      next.setUTCHours(2, 0, 0, 0);
      break;
    case 'monthly':
    default:
      next.setUTCMonth(next.getUTCMonth() + 1, 1);
      next.setUTCHours(2, 0, 0, 0);
      break;
  }

  return next.toISOString();
}

module.exports = {
  getExtendedSchedule,
  setExtendedSchedule,
  recordScheduleExecution,
  VALID_FREQUENCIES,
};
