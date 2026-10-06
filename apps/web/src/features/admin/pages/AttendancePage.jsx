import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck2, CalendarOff, Clock, LogIn, UserCheck, UserX } from 'lucide-react';
import { adminService } from '../services/adminService';
import { SlideOverPanel } from '../../../shared/components/SlideOverPanel';
import {
  GlassTable,
  TableActions,
  TableCell,
  TableIdentity,
  TablePagination,
  TableRow,
} from '../../../shared/components/GlassTable';
import { Alert } from '../../../shared/components/ui/Alert';
import { Select } from '../../../shared/components/ui/Select';
import { DatePickerField } from './calendarPickers';
import { KpiMetricCard, KpiMetricGrid } from '../../../shared/components/ui/KpiMetricCard';
import { useAnyPermission, usePermission } from '../../../shared/components/PermissionGate';
import { PageActions } from '../../../shared/components/pageChrome';
import { PERMISSIONS } from '../permissions';
import { useSilentPoll } from '../../../shared/hooks/useSilentPoll';
import { normalizeAttendanceType } from '../utils/analyticsCharts';
import { useAuthStore } from '../../auth/store/authStore';

const LATE_CUTOFF_MINUTES = 9 * 60 + 15;
const PERIODS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

const WORK_MODE_LABELS = {
  in_office: 'In office',
  remote: 'Remote',
  hybrid: 'Hybrid',
  semi_remote: 'Hybrid',
  fully_remote: 'Remote',
};

const STATUS_META = {
  present: { label: 'Present', dot: 'bg-emerald-500', text: 'text-slate-700' },
  late: { label: 'Late', dot: 'bg-amber-500', text: 'text-slate-700' },
  working: { label: 'Working', dot: 'bg-[#00B0FF]', text: 'text-slate-700' },
  on_leave: { label: 'On leave', dot: 'bg-sky-500', text: 'text-slate-700' },
  absent: { label: 'Absent', dot: 'bg-rose-400', text: 'text-slate-600' },
};

function toDateInput(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateInput(value) {
  const next = value ? new Date(`${value}T12:00:00`) : new Date();
  return Number.isNaN(next.getTime()) ? new Date() : next;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfWeek(date) {
  const next = startOfDay(date);
  const day = next.getDay();
  next.setDate(next.getDate() - (day === 0 ? 6 : day - 1));
  return next;
}

function periodBounds(view, selectedDate) {
  const day = startOfDay(selectedDate);
  if (view === 'week') {
    const start = startOfWeek(day);
    const end = endOfDay(new Date(start));
    end.setDate(start.getDate() + 6);
    return { start, end };
  }
  if (view === 'month') {
    const start = new Date(day.getFullYear(), day.getMonth(), 1);
    const end = endOfDay(new Date(day.getFullYear(), day.getMonth() + 1, 0));
    return { start, end };
  }
  return { start: day, end: endOfDay(day) };
}

function formatPeriodLabel(view, start, end) {
  if (view === 'month') {
    return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  if (view === 'week') {
    const sameMonth = start.getMonth() === end.getMonth();
    const from = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const to = end.toLocaleDateString(undefined, {
      month: sameMonth ? undefined : 'short',
      day: 'numeric',
    });
    return `${from} – ${to}`;
  }
  return start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatHours(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalMins = Math.round(ms / 60000);
  const hours = Math.floor(totalMins / 60);
  const minutes = totalMins % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatWorkMode(value) {
  return WORK_MODE_LABELS[String(value || 'in_office').toLowerCase()] || 'In office';
}

function workModeDotColor(value) {
  const mode = String(value || 'in_office').toLowerCase();
  if (mode === 'remote' || mode === 'fully_remote') return '#64748b';
  if (mode === 'hybrid' || mode === 'semi_remote') return '#00a3ff';
  return '#0f172a';
}

function personKeys(person) {
  return [
    person?.uid,
    person?.id,
    person?.username,
    person?.user_uid,
    person?.employee_uid,
    person?.employeeUid,
    person?.employee_username,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function recordKey(row) {
  return String(row?.user_uid || row?.uid || row?.username || row?.employee_uid || row?.employeeUid || '').toLowerCase();
}

function isRemoteMode(value) {
  const mode = String(value || '').toLowerCase();
  return mode === 'remote' || mode === 'fully_remote';
}

const STATUS_RANK = { working: 0, late: 1, absent: 2, on_leave: 3, present: 4 };

function isLateCheckin(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return date.getHours() * 60 + date.getMinutes() > LATE_CUTOFF_MINUTES;
}

function coversDate(leave, start, end) {
  if (String(leave.status || '').toLowerCase() !== 'approved') return false;
  const from = leave.start_date ? startOfDay(new Date(leave.start_date)) : null;
  const to = leave.end_date ? endOfDay(new Date(leave.end_date)) : null;
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;
  return from <= end && to >= start;
}

function downloadAttendanceCsv(rows) {
  const header = ['username', 'employee_name', 'type', 'timestamp', 'auth_method', 'is_manual', 'latitude', 'longitude', 'address'];
  const lines = [header.join(',')];
  for (const row of rows || []) {
    const loc = row.location || {};
    const values = [
      row.username,
      row.employee_name || row.employeeName || '',
      row.type,
      row.timestamp,
      row.auth_method || row.authMethod || '',
      row.is_manual ? 'yes' : 'no',
      loc.latitude ?? '',
      loc.longitude ?? '',
      loc.address ?? '',
    ].map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`);
    lines.push(values.join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatEventStamp(iso, withDate) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (!withDate) return time;
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day} · ${time}`;
}

function sessionFromEvents(events) {
  const ordered = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const checkin = ordered.find((row) => normalizeAttendanceType(row.type) === 'checkin');
  const checkout = [...ordered]
    .reverse()
    .find(
      (row) =>
        normalizeAttendanceType(row.type) === 'checkout' &&
        (!checkin || new Date(row.timestamp) >= new Date(checkin.timestamp))
    );
  const open = Boolean(checkin && !checkout);
  const hoursMs =
    checkin && checkout
      ? Math.max(0, new Date(checkout.timestamp) - new Date(checkin.timestamp))
      : open && toDateInput(new Date(checkin.timestamp)) === toDateInput(new Date())
        ? Math.max(0, Date.now() - new Date(checkin.timestamp))
        : null;
  let status = 'absent';
  if (checkin) {
    if (open) status = 'working';
    else if (isLateCheckin(checkin.timestamp)) status = 'late';
    else status = 'present';
  }
  return {
    checkin,
    checkout,
    hoursMs,
    open,
    late: Boolean(checkin && isLateCheckin(checkin.timestamp)),
    status,
    events: ordered,
  };
}

function eachDay(start, end) {
  const days = [];
  const cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor <= last) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function aggregatePeriod(events, start, end, todayInRange) {
  const todayKey = toDateInput(new Date());
  let hoursMs = 0;
  let checkin = null;
  let checkout = null;
  let late = false;
  let open = false;
  let anyPresent = false;
  const all = [];

  for (const day of eachDay(start, end)) {
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);
    const dayEvents = events.filter((row) => {
      const stamp = new Date(row.timestamp);
      return stamp >= dayStart && stamp <= dayEnd;
    });
    if (!dayEvents.length) continue;
    anyPresent = true;
    const daySession = sessionFromEvents(dayEvents);
    all.push(...daySession.events);
    if (daySession.hoursMs) hoursMs += daySession.hoursMs;
    if (daySession.checkin && (!checkin || new Date(daySession.checkin.timestamp) < new Date(checkin.timestamp))) {
      checkin = daySession.checkin;
    }
    if (daySession.checkout) checkout = daySession.checkout;
    if (daySession.late) late = true;
    if (daySession.open && todayInRange && toDateInput(day) === todayKey) open = true;
  }

  let status = 'absent';
  if (open) status = 'working';
  else if (late) status = 'late';
  else if (anyPresent) status = 'present';

  return {
    checkin,
    checkout,
    hoursMs: hoursMs || null,
    open,
    late,
    status,
    events: all.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
  };
}

export function AttendancePage() {
  const user = useAuthStore((state) => state.user);
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [absenceOutcomes, setAbsenceOutcomes] = useState([]);
  const [summaryRows, setSummaryRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({
    username: '',
    type: 'checkin',
    timestamp: toLocalInputValue(new Date().toISOString()),
    locationNote: '',
  });
  const [dateInput, setDateInput] = useState(toDateInput(new Date()));
  const [period, setPeriod] = useState('day');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [workModeFilter, setWorkModeFilter] = useState('all');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [activeSession, setActiveSession] = useState(null);
  const [outcomeDetail, setOutcomeDetail] = useState(null);
  const [outcomeLoading, setOutcomeLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const hasAttendancePermission = useAnyPermission([PERMISSIONS.VIEW_ATTENDANCE, PERMISSIONS.MANUAL_ATTENDANCE]);
  const canViewAttendance = user?.role === 'employee' || hasAttendancePermission;
  const canManual = usePermission(PERMISSIONS.MANUAL_ATTENDANCE);
  const canReconcile = canManual || usePermission(PERMISSIONS.EDIT_LEAVE_BALANCE);
  const canExport = usePermission(PERMISSIONS.EXPORT_ATTENDANCE);
  const hasLeavePermission = useAnyPermission([
    PERMISSIONS.VIEW_LEAVE_REQUESTS,
    PERMISSIONS.APPROVE_LEAVE,
    PERMISSIONS.REJECT_LEAVE,
  ]);
  const canViewLeaves = user?.role === 'employee' || hasLeavePermission;

  const loadAttendance = useCallback(
    async (silent = false) => {
      if (!canViewAttendance) return;
      if (!silent) setLoading(true);
      setError('');
      try {
        const data = await adminService.getAttendance();
        setRows(data || []);
      } catch (err) {
        if (!silent) setError(err?.response?.data?.error || err?.message || 'Failed to load attendance');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [canViewAttendance]
  );

  const loadDirectory = useCallback(async () => {
    try {
      const [userRows, leaveRows, outcomeRows, finalizedRows] = await Promise.all([
        user?.role === 'employee' ? Promise.resolve([user]) : adminService.getUsers().catch(() => []),
        canViewLeaves ? adminService.getLeaves().catch(() => []) : Promise.resolve([]),
        adminService.getAttendanceAbsenceOutcomes().catch(() => []),
        adminService.getAttendanceSummaries().catch(() => []),
      ]);
      setUsers(userRows || []);
      setLeaves(leaveRows || []);
      setAbsenceOutcomes(outcomeRows || []);
      setSummaryRows(finalizedRows || []);
    } catch {
      setUsers([]);
      setLeaves([]);
      setAbsenceOutcomes([]);
    }
  }, [canViewLeaves, user?.role, user?.uid]);

  useEffect(() => {
    loadAttendance();
    loadDirectory();
  }, [canViewAttendance, loadAttendance, loadDirectory]);

  useSilentPoll(loadAttendance, 30000, [canViewAttendance]);

  const selectedDate = useMemo(() => parseDateInput(dateInput), [dateInput]);
  const bounds = useMemo(() => periodBounds(period, selectedDate), [period, selectedDate]);
  const isTodayInRange = useMemo(() => {
    const now = Date.now();
    return now >= bounds.start.getTime() && now <= bounds.end.getTime();
  }, [bounds]);

  const usersByKey = useMemo(() => {
    const map = new Map();
    for (const row of users) {
      for (const key of personKeys(row)) map.set(key, row);
    }
    return map;
  }, [users]);

  const resolveUser = useCallback(
    (row) => {
      for (const key of personKeys(row)) {
        const hit = usersByKey.get(key);
        if (hit) return hit;
      }
      const fallback = recordKey(row);
      return fallback ? usersByKey.get(fallback) : null;
    },
    [usersByKey]
  );

  const sessions = useMemo(() => {
    const eventsInRange = rows.filter((row) => {
      if (!row.timestamp) return false;
      const stamp = new Date(row.timestamp);
      return !Number.isNaN(stamp.getTime()) && stamp >= bounds.start && stamp <= bounds.end;
    });

    const eventsByPerson = new Map();
    for (const event of eventsInRange) {
      const key = recordKey(event) || `anon-${event.id || event.timestamp}`;
      if (!eventsByPerson.has(key)) eventsByPerson.set(key, []);
      eventsByPerson.get(key).push(event);
    }

    const people = new Map();
    const seen = new Set();
    for (const user of users) {
      if (user.is_active === false) continue;
      const keys = personKeys(user);
      if (keys.some((key) => seen.has(key))) continue;
      keys.forEach((key) => seen.add(key));
      people.set(keys[0] || user.uid, user);
    }
    for (const [key, events] of eventsByPerson) {
      if (seen.has(key)) continue;
      seen.add(key);
      people.set(key, resolveUser(events[0]) || events[0]);
    }

    const list = [];
    for (const person of people.values()) {
      const keys = new Set(personKeys(person));
      const events = eventsInRange.filter((event) => keys.has(recordKey(event)));
      const session =
        period === 'day'
          ? sessionFromEvents(events)
          : aggregatePeriod(events, bounds.start, bounds.end, isTodayInRange);
      const profile = resolveUser(person) || person;
      const personUid = profile.uid || profile.user_uid || person.uid;
      const outcome = (absenceOutcomes || []).find((row) =>
        String(row.user_uid) === String(personUid) && String(row.work_date).slice(0, 10) === toDateInput(bounds.start)
      );
      const finalizedSummary = (summaryRows || []).find((row) => String(row.user_uid) === String(personUid) && String(row.work_date).slice(0, 10) === toDateInput(bounds.start));
      const onLeave = leaves.some((leave) => {
        const leaveKeys = personKeys(leave);
        const samePerson =
          leaveKeys.some((key) => keys.has(key)) || (recordKey(leave) && keys.has(recordKey(leave)));
        return samePerson && coversDate(leave, bounds.start, bounds.end);
      });

      let status = session.status;
      if (onLeave && !session.checkin) status = 'on_leave';
      else if (session.open) status = 'working';
      else if (session.late) status = 'late';
      else if (session.checkin) status = 'present';
      else if (profile.is_active === false) continue;
      else status = 'absent';

      let checkin = session.checkin;
      let checkout = session.checkout;
      let open = session.open;
      if (period !== 'day' && isTodayInRange) {
        const todayKey = toDateInput(new Date());
        const todayEvents = events.filter((event) => toDateInput(new Date(event.timestamp)) === todayKey);
        if (todayEvents.length) {
          const todaySession = sessionFromEvents(todayEvents);
          checkin = todaySession.checkin;
          checkout = todaySession.checkout;
          open = todaySession.open;
        }
      }

      const location =
        checkin?.location?.address ||
        checkout?.location?.address ||
        session.events.find((event) => event.location?.address)?.location?.address ||
        '';

      list.push({
        ...session,
        checkin,
        checkout,
        open,
        id: profile.uid || profile.username || recordKey(person),
        person: profile,
        name: profile.name || profile.employee_name || profile.username || 'Employee',
        username: profile.username || '',
        email: profile.email || '',
        department: profile.department || '—',
        workMode: profile.work_mode || 'in_office',
        onLeave,
        absenceOutcome: outcome || null,
        finalizedSummary: finalizedSummary || null,
        location,
        status,
      });
    }

    return list.sort((a, b) => {
      const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
      return rank || a.name.localeCompare(b.name);
    });
  }, [rows, users, leaves, absenceOutcomes, summaryRows, bounds, period, resolveUser, isTodayInRange]);

  const departments = useMemo(
    () => ['all', ...Array.from(new Set(sessions.map((row) => row.department).filter((value) => value && value !== '—'))).sort()],
    [sessions]
  );

  const workModes = useMemo(
    () => ['all', ...Array.from(new Set(sessions.map((row) => String(row.workMode || 'in_office').toLowerCase()))).sort()],
    [sessions]
  );

  const filteredSessions = useMemo(() => {
    const query = employeeQuery.trim().toLowerCase();
    return sessions.filter((row) => {
      const byEmployee =
        !query ||
        row.name.toLowerCase().includes(query) ||
        row.username.toLowerCase().includes(query) ||
        String(row.email || '').toLowerCase().includes(query);
      const byDepartment = departmentFilter === 'all' || row.department === departmentFilter;
      const byStatus = statusFilter === 'all' || row.status === statusFilter;
      const byWorkMode = workModeFilter === 'all' || String(row.workMode || 'in_office').toLowerCase() === workModeFilter;
      return byEmployee && byDepartment && byStatus && byWorkMode;
    });
  }, [sessions, employeeQuery, departmentFilter, statusFilter, workModeFilter]);

  const summary = useMemo(() => {
    const counts = { present: 0, late: 0, absent: 0, on_leave: 0, working: 0 };
    for (const row of sessions) {
      if (counts[row.status] != null) counts[row.status] += 1;
    }
    return counts;
  }, [sessions]);

  useEffect(() => {
    setPage(1);
  }, [dateInput, period, departmentFilter, statusFilter, workModeFilter, employeeQuery]);

  const pagedSessions = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredSessions.slice(start, start + pageSize);
  }, [filteredSessions, page, pageSize]);

  useEffect(() => {
    const pageCount = Math.max(Math.ceil(filteredSessions.length / pageSize), 1);
    if (page > pageCount) setPage(pageCount);
  }, [filteredSessions.length, pageSize, page]);

  const eventsForExport = useMemo(() => {
    const allowed = new Set(filteredSessions.flatMap((row) => personKeys(row.person)));
    return rows.filter((row) => {
      if (!row.timestamp) return false;
      const stamp = new Date(row.timestamp);
      if (stamp < bounds.start || stamp > bounds.end) return false;
      return allowed.has(recordKey(row));
    });
  }, [rows, filteredSessions, bounds]);

  const handleExport = async () => {
    setActionLoading(true);
    setNotice(null);
    try {
      const data = eventsForExport.length ? eventsForExport : rows;
      const inPeriod = data.filter((row) => {
        if (!row.timestamp) return false;
        const stamp = new Date(row.timestamp);
        return stamp >= bounds.start && stamp <= bounds.end;
      });
      if (!inPeriod.length) {
        setNotice({ type: 'info', message: 'No attendance records available to export for this period.' });
        return;
      }
      downloadAttendanceCsv(inPeriod);
      setNotice({ type: 'success', message: `Exported ${inPeriod.length} attendance record(s) to CSV.` });
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Export failed.' });
    } finally {
      setActionLoading(false);
    }
  };

  const openOutcomeDetail = async (outcome) => {
    if (!outcome?.id) return;
    setOutcomeLoading(true);
    try {
      setOutcomeDetail(await adminService.getAttendanceAbsenceOutcome(outcome.id));
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Failed to load absence outcome history.' });
    } finally {
      setOutcomeLoading(false);
    }
  };

  const reconcileOutcome = async () => {
    if (!outcomeDetail?.outcome?.id) return;
    const reason = window.prompt('Reason for reconciliation', 'Manual attendance or leave correction');
    if (!reason) return;
    setOutcomeLoading(true);
    try {
      await adminService.reconcileAttendanceAbsenceOutcome(outcomeDetail.outcome.id, reason);
      setNotice({ type: 'success', message: 'Absence outcome reconciled.' });
      setOutcomeDetail(null);
      await loadDirectory();
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Failed to reconcile absence outcome.' });
    } finally {
      setOutcomeLoading(false);
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualForm.username) {
      setNotice({ type: 'error', message: 'Select an employee for the manual correction.' });
      return;
    }
    setActionLoading(true);
    setNotice(null);
    try {
      const payload = {
        username: manualForm.username,
        type: manualForm.type,
        timestamp: manualForm.timestamp ? new Date(manualForm.timestamp).toISOString() : new Date().toISOString(),
        location: manualForm.locationNote
          ? { address: manualForm.locationNote, latitude: null, longitude: null }
          : null,
      };
      await adminService.createManualAttendance(payload);
      setNotice({ type: 'success', message: 'Manual attendance record saved successfully.' });
      setShowManual(false);
      setManualForm({
        username: '',
        type: 'checkin',
        timestamp: toLocalInputValue(new Date().toISOString()),
        locationNote: '',
      });
      await loadAttendance();
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Failed to save manual correction.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (record) => {
    if (!window.confirm(`Delete ${record.type} record for ${record.username || 'this employee'}?`)) return;
    setActionLoading(true);
    setNotice(null);
    try {
      await adminService.deleteAttendance(record.id);
      setNotice({ type: 'success', message: 'Attendance record deleted.' });
      await loadAttendance();
      setActiveSession((current) => {
        if (!current) return current;
        const remaining = current.events.filter((event) => event.id !== record.id);
        return remaining.length ? { ...current, events: remaining } : null;
      });
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Failed to delete record.' });
    } finally {
      setActionLoading(false);
    }
  };

  const jumpToToday = () => {
    setPeriod('day');
    setDateInput(toDateInput(new Date()));
  };

  const toggleStatus = (status) => {
    setStatusFilter((current) => (current === status ? 'all' : status));
  };

  const openRow = (event, session) => {
    if (event.target.closest('button, input, a, [data-row-action]')) return;
    setActiveSession(session);
  };

  useEffect(() => {
    if (!activeSession?.id) return;
    setActiveSession((current) => {
      if (!current) return current;
      const next = sessions.find((row) => row.id === current.id);
      return next || null;
    });
  }, [sessions]);

  const directoryEmpty = !loading && sessions.length === 0;
  const remoteCount = sessions.filter((row) => isRemoteMode(row.workMode)).length;

  return (
    <div className="attendance-directory admin-page gap-4 animate-fade-up">
      <PageActions>
        <DatePickerField
          size="toolbar"
          value={dateInput}
          onChange={setDateInput}
          allowClear={false}
          aria-label="Attendance date"
        />
        <button
          type="button"
          onClick={jumpToToday}
          className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition-colors hover:border-[#00B0FF]/50 hover:text-[#00B0FF]"
        >
          Today
        </button>
        <div className="ui-segment" role="tablist" aria-label="Attendance period">
          {PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={period === item.id}
              onClick={() => setPeriod(item.id)}
              className={`ui-segment-item ${period === item.id ? 'ui-segment-item-active' : ''}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {canManual && (
          <button type="button" onClick={() => setShowManual(true)} disabled={actionLoading} className="ui-btn-primary ui-btn-sm">
            Manual Correction
          </button>
        )}
        {canExport && (
          <button
            type="button"
            onClick={handleExport}
            disabled={actionLoading || loading}
            className="ui-btn-secondary ui-btn-sm"
          >
            {actionLoading ? 'Exporting…' : 'Export Attendance'}
          </button>
        )}
      </PageActions>

      {notice && (
        <Alert type={notice.type} onDismiss={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {canViewAttendance ? (
        <div className="flex flex-col gap-4">
        {error && <Alert type="error">{error}</Alert>}

        <div>
          <p className="mb-1 text-xs text-slate-400">{formatPeriodLabel(period, bounds.start, bounds.end)}</p>
          <KpiMetricGrid>
            <KpiMetricCard
              label="Present"
              subtitle="Scheduled shift"
              value={loading ? '—' : summary.present}
              icon={UserCheck}
              tone="success"
              active={statusFilter === 'present'}
              onClick={() => toggleStatus('present')}
            />
            <KpiMetricCard
              label="Late"
              subtitle="Shift delayed"
              value={loading ? '—' : summary.late}
              icon={Clock}
              tone="warning"
              actionable={summary.late > 0}
              active={statusFilter === 'late'}
              onClick={() => toggleStatus('late')}
            />
            <KpiMetricCard
              label="Absent"
              subtitle="No check-in recorded"
              value={loading ? '—' : summary.absent}
              icon={UserX}
              tone="warning"
              actionable={summary.absent > 0}
              active={statusFilter === 'absent'}
              onClick={() => toggleStatus('absent')}
            />
            <KpiMetricCard
              label="On leave"
              subtitle="Approved off-time"
              value={loading ? '—' : summary.on_leave}
              icon={CalendarOff}
              active={statusFilter === 'on_leave'}
              onClick={() => toggleStatus('on_leave')}
            />
            <KpiMetricCard
              label="Working"
              subtitle="Currently checked in"
              value={loading ? '—' : summary.working}
              icon={LogIn}
              tone="success"
              active={statusFilter === 'working'}
              onClick={() => toggleStatus('working')}
            />
          </KpiMetricGrid>
        </div>

        <div className="filter-action-bar border-b border-slate-200 pb-3">
          <input
            value={employeeQuery}
            onChange={(e) => setEmployeeQuery(e.target.value)}
            placeholder="Search employee"
            aria-label="Search employee"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#00B0FF] focus:outline-none focus:ring-2 focus:ring-[#00B0FF]/20 lg:max-w-xs"
          />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} aria-label="Filter by department" size="sm" className="w-auto min-w-[9.5rem]">
              {departments.map((dep) => (
                <option key={dep} value={dep}>
                  {dep === 'all' ? 'All departments' : dep}
                </option>
              ))}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" size="sm" className="w-auto min-w-[8.5rem]">
              <option value="all">All status</option>
              <option value="present">Present</option>
              <option value="late">Late</option>
              <option value="absent">Absent</option>
              <option value="on_leave">On leave</option>
              <option value="working">Working</option>
            </Select>
            <Select value={workModeFilter} onChange={(e) => setWorkModeFilter(e.target.value)} aria-label="Filter by work mode" size="sm" className="w-auto min-w-[8.5rem]">
              {workModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode === 'all' ? 'All work modes' : formatWorkMode(mode)}
                </option>
              ))}
            </Select>
            <p className="pl-1 text-xs tabular-nums text-slate-400">
              {filteredSessions.length} {filteredSessions.length === 1 ? 'person' : 'people'}
              {workModeFilter === 'all' && remoteCount > 0 ? ` · ${remoteCount} remote` : ''}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
          <GlassTable
            className="rounded-none border-0 shadow-none"
            loading={loading}
            skeletonRows={8}
            emptyIcon={CalendarCheck2}
            emptyTitle={error ? 'Could not load attendance' : directoryEmpty ? 'No attendance to show' : 'No matching people'}
            emptyMessage={
              error
                ? 'Refresh the page or try again in a moment.'
                : directoryEmpty
                  ? 'Check-ins appear here as the team clocks in. Use Today to return to the current roster.'
                  : 'Try a different date, status or department filter.'
            }
            columns={[
              { key: 'employee', label: 'Employee' },
              { key: 'department', label: 'Department' },
              { key: 'checkin', label: 'Check-in' },
              { key: 'checkout', label: 'Check-out' },
              { key: 'hours', label: 'Working hours' },
              { key: 'mode', label: 'Work mode' },
              { key: 'status', label: 'Status' },
              { key: 'actions', label: <span className="sr-only">Actions</span>, className: 'w-16' },
            ]}
          >
            {pagedSessions.map((session) => (
              <TableRow key={session.id} onClick={(event) => openRow(event, session)}>
                <TableCell>
                  <TableIdentity
                    size="sm"
                    name={session.name}
                    secondary={session.email || session.username}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveSession(session);
                    }}
                  />
                </TableCell>
                <TableCell className="text-sm text-slate-500">{session.department}</TableCell>
                <TableCell className="text-sm tabular-nums text-slate-800">
                  {formatEventStamp(session.checkin?.timestamp, period !== 'day')}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-slate-800">
                  {session.open ? (
                    <span className="text-amber-700/90">Open</span>
                  ) : (
                    formatEventStamp(session.checkout?.timestamp, period !== 'day')
                  )}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-slate-700">{formatHours(session.hoursMs)}</TableCell>
                <TableCell>
                  <WorkModeMark workMode={session.workMode} />
                </TableCell>
                <TableCell>
                  <div>
                    <StatusMark status={session.status} />
                    {session.absenceOutcome && (
                      <button type="button" className="mt-1 text-left text-[11px] text-slate-400 underline" onClick={(event) => { event.stopPropagation(); openOutcomeDetail(session.absenceOutcome); }}>
                        {session.absenceOutcome.status === 'DEDUCTED' || session.absenceOutcome.status === 'PARTIALLY_DEDUCTED'
                          ? `${session.absenceOutcome.deducted_days} day(s) deducted`
                          : session.absenceOutcome.status.replace(/_/g, ' ').toLowerCase()}
                      </button>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <span data-row-action>
                    <TableActions
                      label={`Actions for ${session.name}`}
                      items={[
                        { label: 'View details', onClick: () => setActiveSession(session) },
                      ]}
                    />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </GlassTable>
          {!loading && filteredSessions.length > 0 && (
            <TablePagination
              className="border-t border-slate-100 px-4 py-3"
              page={page}
              pageSize={pageSize}
              total={filteredSessions.length}
              pageSizes={[10, 25, 50, 100]}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          )}
        </div>
        </div>
      ) : null}

      <SlideOverPanel open={showManual} onClose={() => (actionLoading ? null : setShowManual(false))}>
        <form className="flex h-full flex-col" onSubmit={handleManualSubmit}>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <p className="text-[17px] font-semibold tracking-tight text-slate-900">Manual Correction</p>
              <p className="mt-1 text-sm text-slate-500">Add a check-in or check-out on behalf of an employee.</p>
            </div>
            <button type="button" onClick={() => !actionLoading && setShowManual(false)} className="ui-btn-ghost ui-btn-sm" disabled={actionLoading}>
              Close
            </button>
          </div>
          <div className="space-y-4 p-5">
            <label className="block space-y-1">
              <span className="ui-label">Employee</span>
              <Select
                value={manualForm.username}
                onChange={(e) => setManualForm((f) => ({ ...f, username: e.target.value }))}
                required
              >
                <option value="">Select employee</option>
                {users.map((u) => (
                  <option key={u.uid || u.username} value={u.username}>
                    {u.name || u.username} ({u.username})
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="ui-label">Type</span>
              <Select value={manualForm.type} onChange={(e) => setManualForm((f) => ({ ...f, type: e.target.value }))}>
                <option value="checkin">Check-in</option>
                <option value="checkout">Check-out</option>
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="ui-label">Date & time</span>
              <input
                type="datetime-local"
                value={manualForm.timestamp}
                onChange={(e) => setManualForm((f) => ({ ...f, timestamp: e.target.value }))}
                className="ui-input"
                required
              />
            </label>
            <label className="block space-y-1">
              <span className="ui-label">Location note (optional)</span>
              <input
                type="text"
                value={manualForm.locationNote}
                onChange={(e) => setManualForm((f) => ({ ...f, locationNote: e.target.value }))}
                placeholder="e.g. Office HQ — corrected by manager"
                className="ui-input"
              />
            </label>
          </div>
          <div className="mt-auto flex justify-end gap-2 border-t border-slate-200 p-5">
            <button type="button" onClick={() => setShowManual(false)} className="ui-btn-secondary ui-btn-sm" disabled={actionLoading}>
              Cancel
            </button>
            <button type="submit" disabled={actionLoading} className="ui-btn-primary ui-btn-sm">
              {actionLoading ? 'Saving…' : 'Save correction'}
            </button>
          </div>
        </form>
      </SlideOverPanel>

      <SlideOverPanel open={Boolean(activeSession)} onClose={() => setActiveSession(null)}>
        {activeSession && (
          <div className="flex h-full flex-col">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[17px] font-semibold tracking-tight text-slate-900">{activeSession.name}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {activeSession.department}
                    <span className="text-slate-300"> · </span>
                    {formatWorkMode(activeSession.workMode)}
                  </p>
                </div>
                <button type="button" onClick={() => setActiveSession(null)} className="ui-btn-ghost ui-btn-sm">
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              <dl>
                {activeSession.absenceOutcome && <DetailField label="Absence outcome"><button type="button" className="text-sky-600 underline" onClick={() => openOutcomeDetail(activeSession.absenceOutcome)}>View deduction history</button></DetailField>}
                {activeSession.finalizedSummary && <DetailField label="Finalized summary">{activeSession.finalizedSummary.status} · {Math.round(Number(activeSession.finalizedSummary.regular_seconds || 0) / 3600 * 100) / 100} regular hours · {Math.round(Number(activeSession.finalizedSummary.overtime_seconds || 0) / 3600 * 100) / 100} overtime hours</DetailField>}
                <DetailField label="Status"><StatusMark status={activeSession.status} /></DetailField>
                <DetailField label="Check-in">{formatEventStamp(activeSession.checkin?.timestamp, period !== 'day')}</DetailField>
                <DetailField label="Check-out">
                  {activeSession.open ? 'Still working' : formatEventStamp(activeSession.checkout?.timestamp, period !== 'day')}
                </DetailField>
                <DetailField label="Working hours">{formatHours(activeSession.hoursMs)}</DetailField>
                <DetailField label="Work mode"><WorkModeMark workMode={activeSession.workMode} /></DetailField>
                <DetailField label="Location">{activeSession.location || '—'}</DetailField>
              </dl>

              <p className="mt-6 text-xs font-medium uppercase tracking-[0.06em] text-slate-400">Events</p>
              {activeSession.events.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No check-in or check-out events in this period.</p>
              ) : (
                <ul className="mt-1 divide-y divide-slate-100">
                  {activeSession.events.map((event) => (
                    <li key={event.id || event.timestamp} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-800">
                          {normalizeAttendanceType(event.type) === 'checkout' ? 'Checked out' : 'Checked in'}
                          {event.is_manual ? ' · manual' : ''}
                        </span>
                        {event.location?.address && (
                          <span className="block truncate text-xs text-slate-400">{event.location.address}</span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs tabular-nums text-slate-500">{formatEventStamp(event.timestamp, period !== 'day')}</span>
                        {canManual && (
                          <button
                            type="button"
                            onClick={() => handleDelete(event)}
                            disabled={actionLoading}
                            className="text-xs font-medium text-rose-500 transition-colors hover:text-rose-600"
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SlideOverPanel>
      <SlideOverPanel open={Boolean(outcomeDetail)} onClose={() => setOutcomeDetail(null)}>
        {outcomeDetail?.outcome && <div className="flex h-full flex-col"><div className="border-b border-slate-200 px-5 py-4"><p className="text-[17px] font-semibold text-slate-900">Absence outcome</p><p className="mt-1 text-sm text-slate-500">{outcomeDetail.outcome.work_date} · {outcomeDetail.outcome.status}</p></div><div className="space-y-3 overflow-y-auto px-5 py-4"><DetailField label="Reason">{outcomeDetail.outcome.reason}</DetailField><DetailField label="Requested days">{outcomeDetail.outcome.requested_days} day(s)</DetailField><DetailField label="Deducted days">{outcomeDetail.outcome.deducted_days} day(s)</DetailField><DetailField label="Unpaid remainder">{outcomeDetail.outcome.unpaid_days} day(s)</DetailField><DetailField label="Reconciliation status">{outcomeDetail.outcome.status}</DetailField><p className="pt-4 text-xs font-medium uppercase tracking-wide text-slate-400">Stored policy snapshot</p><pre className="max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{JSON.stringify(outcomeDetail.outcome.policy_snapshot || {}, null, 2)}</pre><p className="pt-4 text-xs font-medium uppercase tracking-wide text-slate-400">Ledger history</p>{(outcomeDetail.ledger || []).map((entry) => <div key={entry.id} className="flex justify-between border-b border-slate-100 py-2 text-sm"><span>{entry.transaction_type || entry.reason}</span><span>{entry.amount}</span></div>)}{canReconcile && outcomeDetail.outcome.status !== 'RECONCILED' && outcomeDetail.outcome.status !== 'REVERSED' && <button type="button" className="ui-btn-primary ui-btn-sm mt-4" disabled={outcomeLoading} onClick={reconcileOutcome}>{outcomeLoading ? 'Reconciling…' : 'Reconcile outcome'}</button>}</div></div>}
      </SlideOverPanel>
    </div>
  );
}

function WorkModeMark({ workMode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: workModeDotColor(workMode) }}
        aria-hidden
      />
      {formatWorkMode(workMode)}
    </span>
  );
}

function StatusMark({ status }) {
  const meta = STATUS_META[status] || STATUS_META.absent;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${meta.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
      {meta.label}
    </span>
  );
}

function DetailField({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <dt className="shrink-0 text-xs font-medium text-slate-400">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-slate-800">{children || '—'}</dd>
    </div>
  );
}
