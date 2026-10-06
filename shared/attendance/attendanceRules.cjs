/*
 * Authoritative, dependency-free attendance calculation helpers.
 *
 * This module deliberately has no Supabase or service imports. Auth-service
 * owns persistence/finalization and every scheduler calls that service, while
 * these pure functions remain the single calculation implementation.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_RE = /^[1-7]$/;

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function dateOnly(value) {
  if (value instanceof Date) return asDate(value).toISOString().slice(0, 10);
  const text = String(value || '');
  const candidate = /^\d{4}-\d{2}-\d{2}/.test(text)
    ? `${text.slice(0, 10)}T12:00:00Z`
    : text;
  const date = asDate(candidate);
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = asDate(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseTime(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) throw new Error(`Invalid schedule time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`Invalid schedule time: ${value}`);
  return { hour, minute, second, minutes: hour * 60 + minute };
}

function validateTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch (_) {
    return 'UTC';
  }
}

function localParts(value, timezone) {
  const date = asDate(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: validateTimezone(timezone),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const output = {};
  for (const part of parts) if (part.type !== 'literal') output[part.type] = Number(part.value);
  return output;
}

function weekdayForDate(dateString) {
  const date = asDate(`${dateString}T12:00:00Z`);
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function timezoneOffsetMs(instant, timezone) {
  const p = localParts(instant, timezone);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return localAsUtc - asDate(instant).getTime();
}

/** Convert a local wall-clock date/time to a UTC instant. */
function zonedInstant(dateString, timeValue, timezone, dayOffset = 0) {
  const date = addDays(dateString, dayOffset);
  const time = parseTime(timeValue);
  const wanted = { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)), hour: time.hour, minute: time.minute, second: time.second };
  let candidate = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute, wanted.second);
  for (let i = 0; i < 4; i += 1) candidate = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute, wanted.second) - timezoneOffsetMs(candidate, timezone);

  // A spring-forward local time does not exist. Move forward to the first
  // representable instant rather than producing an invalid schedule.
  const actual = localParts(candidate, timezone);
  if (actual.year !== wanted.year || actual.month !== wanted.month || actual.day !== wanted.day || actual.hour !== wanted.hour || actual.minute !== wanted.minute) {
    const beforeOffset = timezoneOffsetMs(candidate, timezone);
    const afterOffset = timezoneOffsetMs(candidate + 3 * 60 * 60 * 1000, timezone);
    if (afterOffset > beforeOffset) return new Date(candidate + (afterOffset - beforeOffset));
    for (let minutes = 1; minutes <= 180; minutes += 1) {
      const shifted = new Date(candidate + minutes * 60 * 1000);
      const p = localParts(shifted, timezone);
      if (p.year === wanted.year && p.month === wanted.month && p.day === wanted.day && p.hour === wanted.hour && p.minute === wanted.minute) return shifted;
    }
  }
  return new Date(candidate);
}

function effectiveDate(rule, workDate) {
  const from = dateOnly(rule.effective_from || rule.effectiveFrom || '1900-01-01');
  const to = rule.effective_to || rule.effectiveTo;
  return from <= workDate && (!to || dateOnly(to) >= workDate);
}

function ruleScopeMatches(rule, user, companyId) {
  if (String(rule.company_id || rule.companyId) !== String(companyId)) return false;
  const scope = String(rule.scope_type || rule.scopeType || '').toUpperCase();
  if (scope === 'COMPANY') return true;
  if (scope === 'DEPARTMENT') return String(rule.department_id || '') === String(user.primary_department_id || user.department_id || '');
  if (scope === 'USER') return String(rule.user_uid || '') === String(user.uid || '');
  return false;
}

function resolveEffectiveRule(rules, user, companyId, workDate) {
  const date = dateOnly(workDate);
  const candidates = (rules || []).filter((rule) => effectiveDate(rule, date) && ruleScopeMatches(rule, user, companyId));
  const rank = { USER: 3, DEPARTMENT: 2, COMPANY: 1 };
  return candidates.sort((a, b) => (rank[String(b.scope_type || '').toUpperCase()] || 0) - (rank[String(a.scope_type || '').toUpperCase()] || 0))[0] || null;
}

function resolveScheduleWindow(rule, workDate) {
  if (!rule) return null;
  const startTime = parseTime(rule.scheduled_start || rule.scheduledStart);
  const endTime = parseTime(rule.scheduled_end || rule.scheduledEnd);
  const timezone = validateTimezone(rule.timezone || 'UTC');
  const endDayOffset = endTime.minutes <= startTime.minutes ? 1 : 0;
  const start = zonedInstant(dateOnly(workDate), rule.scheduled_start || rule.scheduledStart, timezone);
  const end = zonedInstant(dateOnly(workDate), rule.scheduled_end || rule.scheduledEnd, timezone, endDayOffset);
  return {
    timezone,
    start,
    end,
    scheduledDurationSeconds: Math.max(0, Math.round((end - start) / 1000)),
    overtimeDeadline: new Date(end.getTime() + Number(rule.overtime_window_minutes ?? rule.overtimeWindowMinutes ?? 0) * 60 * 1000),
    graceSeconds: Math.max(0, Number(rule.grace_minutes ?? rule.graceMinutes ?? 0) * 60),
  };
}

function pairAttendanceRecords(records) {
  const ordered = [...(records || [])]
    .filter((row) => row?.timestamp && !Number.isNaN(new Date(row.timestamp).getTime()))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp) || String(a.id || '').localeCompare(String(b.id || '')));
  const sessions = [];
  const invalid = [];
  let open = null;
  for (const row of ordered) {
    const type = String(row.type || '').toLowerCase().replace(/_/g, '');
    if (type === 'checkin') {
      if (open) invalid.push({ row, reason: 'duplicate_checkin' });
      open = row;
    } else if (type === 'checkout') {
      if (!open) {
        // A manual correction may arrive after the scheduler has added its
        // synthetic checkout. Keep both raw events, but make the correction
        // authoritative for the derived session.
        const previous = sessions[sessions.length - 1];
        const previousSource = checkoutSource(previous?.checkout);
        if (row.is_manual === true && previousSource === 'automatic_schedule'
          && previous?.checkin && new Date(row.timestamp) >= new Date(previous.checkin.timestamp)) {
          previous.checkout = row;
        } else {
          invalid.push({ row, reason: 'checkout_without_checkin' });
        }
      }
      else {
        sessions.push({ checkin: open, checkout: row });
        open = null;
      }
    } else invalid.push({ row, reason: 'unknown_type' });
  }
  if (open) sessions.push({ checkin: open, checkout: null });
  return { sessions, invalid };
}

function secondsBetween(a, b) {
  return Math.max(0, Math.round((asDate(b) - asDate(a)) / 1000));
}

function checkoutSource(row) {
  if (!row) return null;
  if (row.checkout_source) return row.checkout_source;
  if (row.auth_method === 'automatic_geofence') return 'automatic_geofence';
  return row.is_manual ? 'manual' : 'legacy';
}

function calculateDailySummary({ rule, workDate, records = [], holiday = null, leave = null, now = new Date(), syntheticCheckout = null, scheduleWindow = null }) {
  const date = dateOnly(workDate);
  if (!rule) return { work_date: date, status: 'NO_SCHEDULE', absence_eligible: false, invalid_events: [] };
  const window = scheduleWindow || resolveScheduleWindow(rule, date);
  const workingDays = (rule.working_days || rule.workingDays || [1, 2, 3, 4, 5]).map(Number);
  const isWorkingDay = workingDays.includes(weekdayForDate(date));
  const isHoliday = Boolean(holiday && holiday.is_working_day !== true);
  const paired = pairAttendanceRecords(records);
  const sessions = paired.sessions.map((session) => ({ ...session }));
  if (syntheticCheckout && sessions.length && !sessions[sessions.length - 1].checkout) sessions[sessions.length - 1] = { ...sessions[sessions.length - 1], checkout: syntheticCheckout };
  const completed = sessions.filter((s) => s.checkin && s.checkout && new Date(s.checkout.timestamp) >= new Date(s.checkin.timestamp));
  const checkin = sessions[0]?.checkin || null;
  const checkout = completed.length ? completed[completed.length - 1].checkout : null;
  const workedSeconds = completed.reduce((sum, s) => sum + secondsBetween(s.checkin.timestamp, s.checkout.timestamp), 0);
  const lateSeconds = checkin ? Math.max(0, Math.round((new Date(checkin.timestamp) - new Date(window.start)) / 1000) - window.graceSeconds) : 0;
  const regularSeconds = Math.min(workedSeconds, window.scheduledDurationSeconds);
  const overtimeEnabled = Boolean(rule.overtime_enabled ?? rule.overtimeEnabled);
  const overtimeWindowSeconds = Math.max(0, Number(rule.overtime_window_minutes ?? rule.overtimeWindowMinutes ?? 0) * 60);
  const overtimeSeconds = overtimeEnabled && checkout && checkoutSource(checkout) !== 'automatic_schedule'
    ? completed.reduce((sum, s) => {
      const start = Math.max(new Date(s.checkin.timestamp).getTime(), window.end.getTime());
      const finish = Math.min(new Date(s.checkout.timestamp).getTime(), window.end.getTime() + overtimeWindowSeconds * 1000);
      return sum + Math.max(0, Math.round((finish - start) / 1000));
    }, 0)
    : 0;
  const isOpen = Boolean(checkin && !checkout);
  const deadlinePassed = asDate(now) >= window.overtimeDeadline;
  let status;
  if (!checkin && holiday && !holiday.is_working_day) status = 'HOLIDAY';
  else if (!checkin && !isWorkingDay) status = 'WEEKLY_OFF';
  else if (!checkin && leave) status = 'ON_LEAVE';
  else if (!checkin && !deadlinePassed) status = 'OPEN';
  else if (isOpen && !deadlinePassed) status = 'OPEN';
  else if (checkout?.checkout_source === 'automatic_schedule') status = 'AUTO_CHECKED_OUT';
  else if (checkin && lateSeconds > 0) status = 'LATE';
  else if (checkin) status = isWorkingDay ? 'PRESENT' : 'PRESENT_NON_WORKING';
  else status = 'ABSENT';
  return {
    work_date: date,
    schedule: { ...window, rule_id: rule.id || null, version: rule.version || 1 },
    checkin,
    checkout,
    checkout_source: checkoutSource(checkout),
    sessions: completed,
    invalid_events: paired.invalid,
    late_seconds: lateSeconds,
    worked_seconds: workedSeconds,
    regular_seconds: regularSeconds,
    overtime_seconds: overtimeSeconds,
    status,
    holiday_id: holiday?.id || null,
    leave_request_id: leave?.id || null,
    absence_eligible: status === 'ABSENT',
    is_working_day: isWorkingDay && !isHoliday,
    open: isOpen,
  };
}

module.exports = {
  DAY_MS,
  WEEKDAY_RE,
  dateOnly,
  addDays,
  parseTime,
  validateTimezone,
  localParts,
  zonedInstant,
  weekdayForDate,
  resolveEffectiveRule,
  resolveScheduleWindow,
  pairAttendanceRecords,
  calculateDailySummary,
};
