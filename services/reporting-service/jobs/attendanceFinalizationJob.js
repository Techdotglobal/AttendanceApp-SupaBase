/**
 * Attendance finalization host. The reporting service only provides the
 * existing cron infrastructure; all calculation and persistence live in
 * auth-service/lib/attendanceFinalizer.js.
 *
 * Disabled by default. ATTENDANCE_FINALIZER_MODE=observe performs read-only
 * comparisons/logging. ATTENDANCE_FINALIZER_MODE=active is required before
 * automatic checkouts or summaries can be written.
 */
const { normalizeSecret, assertProductionSecret } = require('../../../shared/security/internalSecret.cjs');

assertProductionSecret(process.env, 'reporting-service');

let running = false;

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function candidateDates(now = new Date()) {
  return [...new Set([-1, 0, 1].map((offset) => dateOnly(addDays(now, offset))))];
}

async function callFinalizer(workDate, mode) {
  const base = (process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  const internalSecret = normalizeSecret(process.env.INTERNAL_API_SECRET);
  if (internalSecret) headers['x-internal-auth'] = internalSecret;
  const response = await fetch(`${base}/api/internal/attendance/finalize`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ work_date: workDate, mode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Attendance finalizer returned ${response.status}`);
  return payload;
}

async function runAttendanceFinalization(force = false) {
  if (running) return { skipped: true, reason: 'already_running' };
  const enabled = String(process.env.ATTENDANCE_FINALIZER_ENABLED || '').toLowerCase() === 'true';
  if (!enabled && !force) return { skipped: true, reason: 'disabled' };
  running = true;
  const mode = String(process.env.ATTENDANCE_FINALIZER_MODE || 'observe').toLowerCase() === 'active' ? 'active' : 'observe';
  const now = new Date();
  // Cover local dates on both sides of UTC midnight. The auth-service decides
  // whether a candidate is current, historical, or future for each rule
  // timezone before creating or updating a daily context.
  const dates = candidateDates(now);
  const results = [];
  try {
    for (const workDate of dates) {
      try {
        const result = await callFinalizer(workDate, mode);
        results.push(result);
        if (mode === 'observe') {
          const companyCount = Array.isArray(result.results) ? result.results.length : 0;
          console.log(`[attendance-finalizer] observe-only ${workDate}: evaluated ${companyCount} company batch(es)`);
        }
      } catch (error) {
        console.error(`[attendance-finalizer] ${workDate} failed:`, error.message);
      }
    }
    return { mode, results };
  } finally {
    running = false;
  }
}

function startAttendanceFinalizationJob() {
  // Load the scheduler dependency only when the service starts. This keeps
  // pure candidate-date tests independent of the reporting service install.
  const cron = require('node-cron');
  cron.schedule('*/5 * * * *', () => {
    runAttendanceFinalization(false).catch((error) => console.error('[attendance-finalizer] fatal:', error.message));
  }, { scheduled: true, timezone: 'UTC' });
  console.log('[attendance-finalizer] scheduler registered every 5 minutes (disabled unless ATTENDANCE_FINALIZER_ENABLED=true)');
}

module.exports = { startAttendanceFinalizationJob, runAttendanceFinalization, candidateDates };
