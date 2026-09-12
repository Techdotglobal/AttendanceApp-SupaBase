import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { adminService } from '../services/adminService';
import { useAuthStore } from '../../auth/store/authStore';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  LayoutGrid,
  List,
  ListFilter,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UsersRound,
  X,
} from 'lucide-react';
import {
  GlassTable,
  TableActions,
  TableCell,
  TableIdentity,
  TablePagination,
  TableRow,
  TableSelectionBar,
} from '../../../shared/components/GlassTable';
import { SlideOverPanel } from '../../../shared/components/SlideOverPanel';
import { PasswordInput } from '../../../shared/components/PasswordInput';
import { Alert } from '../../../shared/components/ui/Alert';
import { Button } from '../../../shared/components/ui/Button';
import { EmptyStateBody } from '../../../shared/components/ui/EmptyState';
import { DROPDOWN_MOTION } from '../../../shared/components/ui/Menu';
import { Select } from '../../../shared/components/ui/Select';
import { Skeleton, SkeletonGroup } from '../../../shared/components/ui/Skeleton';
import { useSessionState } from '../../../shared/hooks/useSilentPoll';
import { useDismiss } from '../../../shared/lib/useDismiss';
import { cn } from '../../../shared/lib/cn';
import { DatePickerField } from './calendarPickers';
import { PageActions } from '../../../shared/components/pageChrome';
import { canAccessFeature, hasAnyPermission, hasPermission, PERMISSIONS } from '../permissions';
import { normalizeAttendanceType } from '../utils/analyticsCharts';
import { formatLeaveStatus, formatLeaveTypeLabel } from '../utils/leaveDisplay';

const EMPTY_CREATE_FORM = {
  username: '',
  email: '',
  password: '',
  name: '',
  role: 'employee',
  department: '',
  position: '',
  workMode: 'in_office',
  hireDate: '',
};

const WORK_MODE_LABELS = {
  in_office: 'In office',
  remote: 'Remote',
  hybrid: 'Hybrid',
  semi_remote: 'Hybrid',
  fully_remote: 'Remote',
};

const PROFILE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'leave', label: 'Leave' },
  { id: 'work_mode', label: 'Work mode' },
  { id: 'activity', label: 'Activity' },
];

const roleCanBeToggled = (targetRole) => targetRole === 'employee' || targetRole === 'manager';

const formatWorkMode = (value) => WORK_MODE_LABELS[String(value || 'in_office').toLowerCase()] || 'In office';

const normalizeWorkMode = (value) => {
  const key = String(value || 'in_office').toLowerCase();
  if (key === 'fully_remote' || key === 'remote') return 'remote';
  if (key === 'semi_remote' || key === 'hybrid') return 'hybrid';
  return 'in_office';
};

const getWorkModeBadgeStyle = (workMode) => {
  const mode = normalizeWorkMode(workMode);
  if (mode === 'remote') {
    return {
      mode,
      label: 'Remote',
      pie: '#64748b',
    };
  }
  if (mode === 'hybrid') {
    return {
      mode,
      label: 'Hybrid',
      pie: '#00a3ff',
    };
  }
  return {
    mode: 'in_office',
    label: 'In office',
    pie: '#0f172a',
  };
};

const formatRole = (value) =>
  String(value || 'employee')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const personKeys = (person) =>
  [person?.uid, person?.id, person?.username, person?.employee_uid, person?.employeeUid, person?.employee_username]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

const recordKey = (row) =>
  String(row?.user_uid || row?.uid || row?.username || row?.employee_uid || row?.employeeUid || '').toLowerCase();

const belongsToUser = (row, user) => {
  const keys = new Set(personKeys(user));
  return personKeys(row).some((key) => keys.has(key)) || (recordKey(row) && keys.has(recordKey(row)));
};

const clockTime = (isoValue) => {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const formatJoined = (isoValue) => {
  if (!isoValue) return '—';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const WEEKLY_CAP_HOURS = 40;
const UNASSIGNED_DEPT = 'Unassigned';
const DEPT_ACRONYMS = new Set(['hr', 'it', 'qa', 'ui', 'ux', 'ai', 'cs', 'pr']);

const toDepartmentLabel = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return UNASSIGNED_DEPT;
  return raw
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (DEPT_ACRONYMS.has(lower) || (word.length <= 3 && word === word.toUpperCase())) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
};
const AVATAR_TONES = [
  'bg-sky-50 text-sky-700',
  'bg-violet-50 text-violet-700',
  'bg-emerald-50 text-emerald-700',
  'bg-amber-50 text-amber-800',
  'bg-rose-50 text-rose-700',
  'bg-cyan-50 text-cyan-700',
];

const getInitials = (value = 'User') =>
  String(value)
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s._-]+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'U';

const avatarTone = (value) => {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash + text.charCodeAt(i) * (i + 1)) % AVATAR_TONES.length;
  return AVATAR_TONES[hash];
};

const startOfDay = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const startOfWeekMonday = (date = new Date()) => {
  const next = startOfDay(date);
  const day = next.getDay();
  next.setDate(next.getDate() + (day === 0 ? -6 : 1 - day));
  return next;
};

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const hoursFromDayEvents = (events, dayKey, now) => {
  const ordered = [...events].sort((a, b) => a.stamp - b.stamp);
  let open = null;
  let ms = 0;
  for (const event of ordered) {
    if (event.type === 'checkin' && !open) {
      open = event.stamp;
    } else if (event.type === 'checkout' && open) {
      ms += Math.max(0, event.stamp - open);
      open = null;
    }
  }
  if (open && dayKey === toDateKey(now)) {
    ms += Math.max(0, now.getTime() - open.getTime());
  }
  return ms / 3600000;
};

const hoursThisWeek = (attendanceRows, person, weekStart, now = new Date()) => {
  const byDay = new Map();
  for (const row of attendanceRows) {
    if (!row.timestamp || !belongsToUser(row, person)) continue;
    const stamp = new Date(row.timestamp);
    if (Number.isNaN(stamp.getTime()) || stamp < weekStart) continue;
    const type = normalizeAttendanceType(row.type);
    if (type !== 'checkin' && type !== 'checkout') continue;
    const dayKey = toDateKey(stamp);
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey).push({ type, stamp });
  }
  let hours = 0;
  for (const [dayKey, events] of byDay) {
    hours += hoursFromDayEvents(events, dayKey, now);
  }
  return hours;
};

const formatLoggedHours = (hours) => {
  if (!Number.isFinite(hours) || hours <= 0) return '0';
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const capacityTone = (percent) => {
  if (percent > 100) return { bar: 'bg-red-500', hours: 'text-red-500', percent: 'text-red-500' };
  if (percent >= 95) return { bar: 'bg-emerald-500', hours: 'text-slate-500', percent: 'text-slate-400' };
  if (percent >= 75) return { bar: 'bg-[#00B0FF]', hours: 'text-slate-500', percent: 'text-slate-400' };
  return { bar: 'bg-amber-500', hours: 'text-slate-500', percent: 'text-slate-400' };
};

/** Column key -> comparable value. Keys mirror the table's column keys. */
const SORT_VALUES = {
  name: (row) => (row.name || row.username || '').toLowerCase(),
  role: (row) => (row.role || '').toLowerCase(),
  dept: (row) => (row.department || '').toLowerCase(),
  work: (row) => formatWorkMode(row.work_mode).toLowerCase(),
  status: (row) => (row.is_active ? 0 : 1),
  last: (row) => (row.updated_at ? new Date(row.updated_at).getTime() : 0),
};

const SORT_LABELS = {
  name: 'Name',
  dept: 'Department',
  role: 'Role',
  work: 'Work mode',
  attendance: 'Attendance',
  status: 'Status',
  last: 'Last active',
};

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function UsersPage() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState({});
  const [roleFilter, setRoleFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [workModeFilter, setWorkModeFilter] = useState('all');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [directoryView, setDirectoryView] = useSessionState('users:view', 'grid');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const searchRef = useRef(null);
  const [activeUser, setActiveUser] = useState(null);
  const [profileTab, setProfileTab] = useState('overview');
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [leaveRows, setLeaveRows] = useState([]);
  const [workModeRows, setWorkModeRows] = useState([]);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [createError, setCreateError] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [tenantDepartments, setTenantDepartments] = useState([]);
  const [editForm, setEditForm] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  const canCreate = hasPermission(user, PERMISSIONS.CREATE_USER);
  const canEditProfiles = hasPermission(user, PERMISSIONS.EDIT_USER);
  const canDelete = hasPermission(user, PERMISSIONS.DELETE_USER);
  const canActivate = hasPermission(user, PERMISSIONS.ACTIVATE_USER);
  const canDeactivate = hasPermission(user, PERMISSIONS.DEACTIVATE_USER);
  const canChangeRoles = hasPermission(user, PERMISSIONS.CHANGE_USER_ROLE);
  const canEditLeaveBalance = hasPermission(user, PERMISSIONS.EDIT_LEAVE_BALANCE);
  const canBulkDeactivate = canDeactivate || canDelete;
  const canViewAttendance = hasAnyPermission(user, [PERMISSIONS.VIEW_ATTENDANCE, PERMISSIONS.MANUAL_ATTENDANCE]);
  const canViewLeaves = hasAnyPermission(user, [
    PERMISSIONS.VIEW_LEAVE_REQUESTS,
    PERMISSIONS.APPROVE_LEAVE,
    PERMISSIONS.REJECT_LEAVE,
  ]);
  const canViewWorkModes = canAccessFeature(user, 'workModeRequests');

  const loadUsers = async () => {
    setError('');
    try {
      const [users, attendance, leaves, workModes] = await Promise.all([
        adminService.getUsers(),
        canViewAttendance ? adminService.getAttendance().catch(() => []) : Promise.resolve([]),
        canViewLeaves ? adminService.getLeaves().catch(() => []) : Promise.resolve([]),
        canViewWorkModes ? adminService.getWorkModeRequests().catch(() => []) : Promise.resolve([]),
      ]);
      setRows(users || []);
      setAttendanceRows(attendance || []);
      setLeaveRows(leaves || []);
      setWorkModeRows(workModes || []);
    } catch (err) {
      console.error('[UsersPage] Failed to load users:', err);
      setError(err?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const loadDepartments = async () => {
    try {
      const depts = await adminService.getDepartments();
      setTenantDepartments(depts || []);
    } catch (err) {
      console.warn('[UsersPage] Failed to load departments:', err?.message || err);
    }
  };

  useEffect(() => {
    loadUsers();
    loadDepartments();
  }, [canViewAttendance, canViewLeaves, canViewWorkModes]);

  const openCreate = () => {
    setCreateError('');
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateOpen(true);
  };

  useEffect(() => {
    if (location.state?.statusFilter) {
      setStatusFilter(location.state.statusFilter);
    }
    if (location.state?.openCreate && canCreate) {
      openCreate();
    }
    if (location.state?.openCreate || location.state?.statusFilter) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const submitCreate = async (e) => {
    e?.preventDefault?.();
    setCreateError('');

    const payload = {
      username: createForm.username.trim(),
      email: createForm.email.trim(),
      password: createForm.password,
      name: createForm.name.trim() || createForm.username.trim(),
      role: createForm.role,
      department: createForm.department || '',
      position: createForm.position.trim(),
      workMode: createForm.workMode || 'in_office',
      hireDate: createForm.hireDate || undefined,
    };

    if (!payload.username || !payload.email || !payload.password || !payload.role) {
      setCreateError('Username, email, password and role are required.');
      return;
    }
    if (payload.password.length < 8) {
      setCreateError('Password must be at least 8 characters.');
      return;
    }
    if (payload.role === 'super_admin') {
      setCreateError('Super admins are created only via company onboarding.');
      return;
    }

    setCreateSubmitting(true);
    try {
      await adminService.createUser(payload);
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE_FORM);
      await loadUsers();
    } catch (err) {
      console.error('[UsersPage] Create user failed:', err);
      setCreateError(err?.message || 'Failed to create user');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const toggleActive = async (u) => {
    const willDeactivate = Boolean(u.is_active);
    if (willDeactivate) {
      const confirmed = window.confirm(
        `Deactivate ${u.name || u.username}? They will immediately lose portal and mobile access. Their attendance, leave, and ticket history is preserved.`
      );
      if (!confirmed) return;
    }
    setError('');
    try {
      await adminService.updateUser(u.uid, { is_active: !u.is_active });
      setRows((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, is_active: !x.is_active, updated_at: new Date().toISOString() } : x)));
    } catch (err) {
      console.error('[UsersPage] Failed to toggle user status:', err);
      setError(err?.message || 'Failed to update user status');
    }
  };

  const changeRole = async (u) => {
    setError('');
    if (!canChangeRoles) {
      setError('Permission denied: change_user_role permission is required.');
      return;
    }
    if (!roleCanBeToggled(u.role)) {
      setError(
        u.role === 'super_admin'
          ? 'Super admin role cannot be changed here.'
          : `Role "${u.role}" cannot be toggled. Only employee ↔ manager is supported.`
      );
      return;
    }
    const nextRole = u.role === 'employee' ? 'manager' : 'employee';
    try {
      await adminService.updateUserRole(u.uid, nextRole, u.username);
      setError('');
      setRows((prev) =>
        prev.map((x) => (x.uid === u.uid ? { ...x, role: nextRole, updated_at: new Date().toISOString() } : x))
      );
      if (activeUser?.uid === u.uid) {
        setActiveUser((prev) => (prev ? { ...prev, role: nextRole } : prev));
      }
    } catch (err) {
      console.error('[UsersPage] Failed to change role:', err);
      setError(err?.message || 'Failed to update user role');
    }
  };

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const bySearch = `${row.name || ''} ${row.username || ''} ${row.email || ''} ${row.department || ''} ${row.role || ''} ${row.work_mode || ''}`.toLowerCase().includes(search.toLowerCase().trim());
      const byRole = roleFilter === 'all' || row.role === roleFilter;
      const byDepartment = departmentFilter === 'all' || row.department === departmentFilter;
      const byStatus = statusFilter === 'all' || (statusFilter === 'active' ? row.is_active : !row.is_active);
      const mode = String(row.work_mode || 'in_office').toLowerCase();
      const byWorkMode = workModeFilter === 'all' || mode === workModeFilter;
      return bySearch && byRole && byDepartment && byStatus && byWorkMode;
    });
  }, [rows, search, roleFilter, departmentFilter, statusFilter, workModeFilter]);

  const presentTodayKeys = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const keys = new Set();
    for (const row of attendanceRows) {
      if (!row.timestamp || normalizeAttendanceType(row.type) !== 'checkin') continue;
      const stamp = new Date(row.timestamp);
      if (Number.isNaN(stamp.getTime()) || stamp < startOfToday) continue;
      const key = recordKey(row);
      if (key) keys.add(key);
    }
    return keys;
  }, [attendanceRows]);

  const isPresentToday = (person) => personKeys(person).some((key) => presentTodayKeys.has(key));

  const weeklyHoursByUid = useMemo(() => {
    const weekStart = startOfWeekMonday(new Date());
    const now = new Date();
    const map = new Map();
    for (const person of rows) {
      map.set(person.uid, hoursThisWeek(attendanceRows, person, weekStart, now));
    }
    return map;
  }, [rows, attendanceRows]);

  const sortedRows = useMemo(() => {
    const direction = sortDir === 'asc' ? 1 : -1;
    const read =
      sortKey === 'attendance'
        ? (row) => (isPresentToday(row) ? 0 : 1)
        : SORT_VALUES[sortKey];
    if (!read) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const left = read(a);
      const right = read(b);
      if (left === right) return 0;
      return left > right ? direction : -direction;
    });
  }, [filteredRows, sortKey, sortDir, presentTodayKeys]);

  const groupedDirectory = useMemo(() => {
    const groups = new Map();
    for (const row of sortedRows) {
      const name = toDepartmentLabel(row.department);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }
    return [...groups.keys()]
      .sort((left, right) => {
        if (left === UNASSIGNED_DEPT) return 1;
        if (right === UNASSIGNED_DEPT) return -1;
        return left.localeCompare(right);
      })
      .map((name) => ({ name, members: groups.get(name) }));
  }, [sortedRows]);

  /* Paging is applied after sorting so page 1 always holds the top of the sort. */
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

  /* Narrowing the result set can strand the viewer on a page that no longer exists. */
  useEffect(() => {
    const pageCount = Math.max(Math.ceil(sortedRows.length / pageSize), 1);
    if (page > pageCount) setPage(pageCount);
  }, [sortedRows.length, pageSize, page]);

  const requestSort = (key) => {
    if (!SORT_VALUES[key] && key !== 'attendance') return;
    setSortDir((prev) => (sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
    setSortKey(key);
    setPage(1);
  };

  const departments = useMemo(() => {
    return ['all', ...Array.from(new Set(rows.map((r) => r.department).filter(Boolean))).sort()];
  }, [rows]);

  const workModes = useMemo(() => {
    return ['all', ...Array.from(new Set(rows.map((r) => String(r.work_mode || 'in_office').toLowerCase()))).sort()];
  }, [rows]);

  const directoryFilters = useMemo(() => {
    const chips = [];
    if (departmentFilter !== 'all') {
      chips.push({ key: 'department', label: toDepartmentLabel(departmentFilter), onClear: () => setDepartmentFilter('all') });
    }
    if (workModeFilter !== 'all') {
      chips.push({ key: 'work', label: formatWorkMode(workModeFilter), onClear: () => setWorkModeFilter('all') });
    }
    if (roleFilter !== 'all') {
      chips.push({ key: 'role', label: formatRole(roleFilter), onClear: () => setRoleFilter('all') });
    }
    return chips;
  }, [departmentFilter, workModeFilter, roleFilter]);

  const sortOptions = useMemo(
    () =>
      [
        { value: 'name', label: 'Name' },
        { value: 'dept', label: 'Department' },
        { value: 'role', label: 'Role' },
        { value: 'work', label: 'Work mode' },
        canViewAttendance && { value: 'attendance', label: 'Attendance' },
        { value: 'status', label: 'Status' },
        { value: 'last', label: 'Last active' },
      ].filter(Boolean),
    [canViewAttendance],
  );

  const applySortKey = (key) => {
    if (!SORT_VALUES[key] && key !== 'attendance') return;
    setSortKey(key);
    setPage(1);
    setSortOpen(false);
  };

  const clearDirectoryFilters = () => {
    setDepartmentFilter('all');
    setWorkModeFilter('all');
    setRoleFilter('all');
  };

  useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      if (createOpen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [createOpen]);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, departmentFilter, statusFilter, workModeFilter]);

  const selectedCount = Object.values(selected).filter(Boolean).length;
  /* Select-all covers the rows on screen, not the whole filtered set. */
  const allVisibleSelected = pagedRows.length > 0 && pagedRows.every((r) => selected[r.uid]);

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = { ...prev };
        for (const row of pagedRows) delete next[row.uid];
        return next;
      });
      return;
    }
    const next = {};
    for (const row of pagedRows) next[row.uid] = true;
    setSelected((prev) => ({ ...prev, ...next }));
  };

  const bulkDeactivate = async () => {
    if (!canBulkDeactivate) return;
    const target = filteredRows.filter((r) => selected[r.uid] && r.is_active);
    if (target.length === 0) return;
    const confirmed = window.confirm(
      `Deactivate ${target.length} selected user${target.length === 1 ? '' : 's'}? They will immediately lose portal and mobile access. Their history is preserved.`
    );
    if (!confirmed) return;
    setError('');
    try {
      for (const row of target) {
        // sequential for simplicity and easier server protection
        // eslint-disable-next-line no-await-in-loop
        await adminService.updateUser(row.uid, { is_active: false });
      }
      setRows((prev) => prev.map((row) => (selected[row.uid] ? { ...row, is_active: false } : row)));
      setSelected({});
    } catch (err) {
      console.error('[UsersPage] Failed to bulk deactivate users:', err);
      setError(err?.message || 'Failed to disable selected users');
    }
  };

  const closePanel = () => {
    setActiveUser(null);
    setEditForm(null);
    setEditError('');
    setEditLoading(false);
    setProfileTab('overview');
  };

  const openUserPanel = async (u) => {
    setActiveUser(u);
    setProfileTab('overview');
    setEditError('');
    if (!canEditProfiles) {
      setEditForm(null);
      try {
        const profile = await adminService.getUserProfile(u.uid);
        if (profile) setActiveUser((prev) => (prev?.uid === u.uid ? { ...prev, ...profile } : prev));
      } catch {
        /* Directory row is enough for a read-only view. */
      }
      return;
    }
    setEditLoading(true);
    try {
      const profile = await adminService.getUserProfile(u.uid);
      const lb = profile?.leave_balance || {};
      setEditForm({
        username: (profile?.username || u.username) ?? '',
        name: (profile?.name || u.name) ?? '',
        email: (profile?.email || u.email) ?? '',
        report_email: (profile?.report_email || u.report_email) ?? '',
        department: (profile?.department || u.department) ?? '',
        position: (profile?.position ?? u.position) ?? '',
        work_mode: (profile?.work_mode || u.work_mode) ?? 'in_office',
        hire_date: (profile?.hire_date || u.hire_date) ?? '',
        annual_leaves: lb.annual_leaves ?? 20,
        sick_leaves: lb.sick_leaves ?? 10,
        casual_leaves: lb.casual_leaves ?? 5,
      });
      if (profile) {
        setActiveUser((prev) => (prev?.uid === u.uid ? { ...prev, ...profile } : prev));
      }
    } catch (err) {
      console.error('[UsersPage] Failed to load profile for edit:', err);
      setEditError(err?.message || 'Failed to load profile');
      setEditForm({
        username: u.username || '',
        name: u.name || '',
        email: u.email || '',
        report_email: u.report_email ?? '',
        department: u.department || '',
        position: u.position || '',
        work_mode: u.work_mode || 'in_office',
        hire_date: u.hire_date || '',
        annual_leaves: 20,
        sick_leaves: 10,
        casual_leaves: 5,
      });
    } finally {
      setEditLoading(false);
    }
  };

  const saveProfile = async () => {
    if (!activeUser || !editForm) return;
    setEditSaving(true);
    setEditError('');
    try {
      const payload = {
        username: editForm.username.trim(),
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        report_email: editForm.report_email?.trim() || null,
        department: editForm.department || '',
        position: editForm.position?.trim() || '',
        work_mode: editForm.work_mode || 'in_office',
        hire_date: editForm.hire_date || null,
      };
      if (canEditLeaveBalance) {
        payload.annual_leaves = Number(editForm.annual_leaves);
        payload.sick_leaves = Number(editForm.sick_leaves);
        payload.casual_leaves = Number(editForm.casual_leaves);
      }
      const updated = await adminService.updateUserProfile(activeUser.uid, payload, {
        originalUsername: activeUser.username,
        originalEmail: activeUser.email,
      });
      const merged = {
        ...activeUser,
        ...updated,
        name: updated?.name ?? editForm.name,
        username: updated?.username ?? editForm.username,
        email: updated?.email ?? editForm.email,
        department: updated?.department ?? editForm.department,
      };
      setActiveUser(merged);
      setRows((prev) => prev.map((row) => (row.uid === activeUser.uid ? { ...row, ...merged } : row)));
      const usernameChanged =
        editForm.username.trim() !== String(activeUser.username || '').trim();
      setSaveSuccess(
        usernameChanged
          ? 'Username saved. The user must sign in with the new username (the old username will not work).'
          : 'Saved. If email changed, the user must sign in with the new email.'
      );
      closePanel();
    } catch (err) {
      console.error('[UsersPage] Save profile failed:', err);
      setEditError(err?.message || 'Failed to save profile');
    } finally {
      setEditSaving(false);
    }
  };

  /* Absolute timestamps are noise in a list; relative age is what people scan for. */
  const asLastActive = (row) => {
    if (!row.updated_at) return '—';
    const then = new Date(row.updated_at).getTime();
    const minutes = Math.round((Date.now() - then) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const directoryEmpty = !loading && rows.length === 0;

  const activeAttendance = useMemo(() => {
    if (!activeUser) return [];
    return attendanceRows
      .filter((row) => belongsToUser(row, activeUser))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 8);
  }, [activeUser, attendanceRows]);

  const activeLeaves = useMemo(() => {
    if (!activeUser) return [];
    return leaveRows
      .filter((row) => belongsToUser(row, activeUser))
      .sort((a, b) => new Date(b.requested_at || b.created_at || 0).getTime() - new Date(a.requested_at || a.created_at || 0).getTime())
      .slice(0, 6);
  }, [activeUser, leaveRows]);

  const activeWorkModes = useMemo(() => {
    if (!activeUser) return [];
    return workModeRows
      .filter((row) => belongsToUser(row, activeUser) || belongsToUser(row.employee || {}, activeUser))
      .sort((a, b) => new Date(b.requested_at || b.created_at || 0).getTime() - new Date(a.requested_at || a.created_at || 0).getTime())
      .slice(0, 6);
  }, [activeUser, workModeRows]);

  const tableColumns = [
    {
      key: 'check',
      label: (
        <input
          type="checkbox"
          checked={allVisibleSelected}
          onChange={toggleSelectAll}
          aria-label="Select all users on this page"
          className="ui-checkbox"
        />
      ),
      className: 'w-12',
    },
    { key: 'name', label: 'Employee', sortable: true },
    { key: 'dept', label: 'Department', sortable: true },
    { key: 'role', label: 'Role', sortable: true },
    { key: 'work', label: 'Work mode', sortable: true },
    canViewAttendance && { key: 'attendance', label: 'Attendance', sortable: true },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'actions', label: <span className="sr-only">Actions</span>, className: 'w-16' },
  ].filter(Boolean);

  const openRow = (event, person) => {
    if (event.target.closest('button, input, a, [data-row-action]')) return;
    openUserPanel(person);
  };

  return (
    <div className="users-directory admin-page gap-3 animate-fade-up">
      {canCreate && (
        <PageActions>
          <button
            type="button"
            onClick={openCreate}
            data-on-dark
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#00B0FF] px-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#0099E6]"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
            Add user
          </button>
        </PageActions>
      )}

      <div className="filter-action-bar">
        <div className="relative min-w-0 flex-1 lg:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            strokeWidth={2}
            aria-hidden
          />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users"
            aria-label="Search users"
            className="h-9 w-full rounded-xl border border-slate-200 bg-white py-0 pl-9 pr-16 text-sm font-medium text-slate-800 placeholder:font-normal placeholder:text-slate-400 focus:border-[#00B0FF] focus:outline-none focus:ring-2 focus:ring-[#00B0FF]/20"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:inline-flex">
              {IS_MAC ? '⌘K' : 'Ctrl K'}
            </kbd>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="ui-segment h-9 p-1" role="tablist" aria-label="Employee status">
            {[
              { id: 'all', label: 'All' },
              { id: 'active', label: 'Active' },
              { id: 'inactive', label: 'Inactive' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={statusFilter === item.id}
                onClick={() => setStatusFilter(item.id)}
                className={`ui-segment-item px-3.5 py-1 text-xs font-medium transition-all duration-200 ease-out ${
                  statusFilter === item.id ? 'ui-segment-item-active' : ''
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <ToolbarPopover
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
            width={280}
            renderTrigger={(triggerRef) => (
              <button
                ref={triggerRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={filterOpen}
                onClick={() => {
                  setSortOpen(false);
                  setFilterOpen((current) => !current);
                }}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-xl border bg-white px-2.5 text-sm font-medium text-slate-700 transition-colors',
                  directoryFilters.length || filterOpen
                    ? 'border-slate-300 bg-slate-50'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <ListFilter className="h-3.5 w-3.5 text-slate-500" strokeWidth={2} aria-hidden />
                Filter
                {directoryFilters.length > 0 && (
                  <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-md bg-slate-100 px-1.5 text-[11px] font-semibold tabular-nums text-slate-700">
                    {directoryFilters.length}
                  </span>
                )}
              </button>
            )}
          >
            <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">Filters</p>
              {directoryFilters.length > 0 && (
                <button
                  type="button"
                  onClick={clearDirectoryFilters}
                  className="text-xs font-medium text-slate-500 transition-colors hover:text-slate-800"
                >
                  Clear
                </button>
              )}
            </div>
            <FilterSection
              label="Department"
              value={departmentFilter}
              options={departments.map((dep) => ({ value: dep, label: dep === 'all' ? 'All departments' : toDepartmentLabel(dep) }))}
              onChange={setDepartmentFilter}
            />
            <FilterSection
              label="Work mode"
              value={workModeFilter}
              options={workModes.map((mode) => ({ value: mode, label: mode === 'all' ? 'All work modes' : formatWorkMode(mode) }))}
              onChange={setWorkModeFilter}
            />
            <FilterSection
              label="Role"
              value={roleFilter}
              options={[
                { value: 'all', label: 'All roles' },
                { value: 'super_admin', label: 'Super admin' },
                { value: 'manager', label: 'Manager' },
                { value: 'employee', label: 'Employee' },
              ]}
              onChange={setRoleFilter}
            />
          </ToolbarPopover>

          {directoryFilters.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onClear}
              className="inline-flex h-9 max-w-[10rem] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <span className="truncate">{chip.label}</span>
              <X className="h-3 w-3 text-slate-400" strokeWidth={2} aria-hidden />
            </button>
          ))}

          <div className={cn('inline-flex overflow-hidden rounded-xl border', sortOpen ? 'border-slate-300' : 'border-slate-200')}>
            <ToolbarPopover
              open={sortOpen}
              onClose={() => setSortOpen(false)}
              width={220}
              renderTrigger={(triggerRef) => (
                <button
                  ref={triggerRef}
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={sortOpen}
                  onClick={() => {
                    setFilterOpen(false);
                    setSortOpen((current) => !current);
                  }}
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 bg-white pl-2.5 pr-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50',
                    sortOpen && 'bg-slate-50',
                  )}
                >
                  Sort by: {SORT_LABELS[sortKey] || 'Name'}
                </button>
              )}
            >
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">
                Sort by
              </p>
              {sortOptions.map((option) => {
                const selected = option.value === sortKey;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => applySortKey(option.value)}
                    className={cn(
                      'ui-menu-item justify-between whitespace-nowrap',
                      selected && 'ui-menu-item-selected',
                    )}
                  >
                    <span>{option.label}</span>
                    {selected && <Check className="ml-auto h-4 w-4 shrink-0 text-[#00A3FF]" aria-hidden />}
                  </button>
                );
              })}
            </ToolbarPopover>
            <button
              type="button"
              aria-label={sortDir === 'asc' ? 'Sorted ascending. Switch to descending.' : 'Sorted descending. Switch to ascending.'}
              title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
              onClick={() => setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))}
              className="inline-flex h-9 w-8 items-center justify-center border-l border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
            >
              {sortDir === 'asc' ? (
                <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
              ) : (
                <ArrowDown className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
              )}
            </button>
          </div>

          <div className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white p-1" role="group" aria-label="Directory layout">
            <button
              type="button"
              aria-pressed={directoryView === 'grid'}
              aria-label="Card view"
              title="Card view"
              onClick={() => setDirectoryView('grid')}
              className={`inline-flex h-full w-8 items-center justify-center rounded-lg transition-colors ${
                directoryView === 'grid' ? 'bg-slate-100 text-slate-800' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <LayoutGrid className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              aria-pressed={directoryView === 'table'}
              aria-label="Table view"
              title="Table view"
              onClick={() => setDirectoryView('table')}
              className={`inline-flex h-full w-8 items-center justify-center rounded-lg transition-colors ${
                directoryView === 'table' ? 'bg-slate-100 text-slate-800' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <List className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          </div>

          <p className="ml-auto inline-flex h-9 items-center pl-1 text-xs tabular-nums text-slate-400">
            {filteredRows.length} {filteredRows.length === 1 ? 'result' : 'results'}
          </p>
        </div>
      </div>

      {error && <Alert type="error">{error}</Alert>}
      {saveSuccess && <Alert type="success">{saveSuccess}</Alert>}

      {directoryView === 'table' && (
        <TableSelectionBar count={selectedCount} onClear={() => setSelected({})}>
          <Button size="sm" variant="secondary" disabled={!canBulkDeactivate} onClick={bulkDeactivate}>
            <UserMinus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            Disable
          </Button>
        </TableSelectionBar>
      )}

      {directoryView === 'grid' ? (
        <UsersDirectoryGrid
          loading={loading}
          directoryEmpty={directoryEmpty}
          groups={groupedDirectory}
          filteredCount={filteredRows.length}
          canCreate={canCreate}
          canViewAttendance={canViewAttendance}
          weeklyHoursByUid={weeklyHoursByUid}
          onOpen={openUserPanel}
          onCreate={openCreate}
        />
      ) : (
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
      <GlassTable
        className="rounded-none border-0 shadow-none"
        loading={loading}
        skeletonRows={6}
        emptyIcon={UsersRound}
        emptyTitle={directoryEmpty ? 'No employees yet' : 'No matching employees'}
        emptyMessage={
          directoryEmpty
            ? 'Add the first person to start building your workforce directory. You can assign a role, department and work mode when they join.'
            : 'Try a different search or filter to find the employee you need.'
        }
        emptyAction={
          directoryEmpty && canCreate ? (
            <button
              type="button"
              onClick={openCreate}
              data-on-dark
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#00B0FF] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#0099E6]"
            >
              Add user
            </button>
          ) : null
        }
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={requestSort}
        columns={tableColumns}
      >
        {pagedRows.map((u) => (
          <TableRow
            key={u.uid}
            selected={Boolean(selected[u.uid])}
            onClick={(event) => openRow(event, u)}
          >
            <TableCell>
              <input
                type="checkbox"
                checked={Boolean(selected[u.uid])}
                onChange={() => setSelected((prev) => ({ ...prev, [u.uid]: !prev[u.uid] }))}
                aria-label={`Select ${u.name || u.username}`}
                className="ui-checkbox"
              />
            </TableCell>
            <TableCell>
              <TableIdentity
                size="sm"
                name={u.name || u.username}
                secondary={u.email || u.username}
                onClick={(event) => {
                  event.stopPropagation();
                  openUserPanel(u);
                }}
              />
            </TableCell>
            <TableCell className="max-w-[10rem] truncate text-sm text-slate-500">{u.department ? toDepartmentLabel(u.department) : '—'}</TableCell>
            <TableCell className="text-sm text-slate-600">{formatRole(u.role)}</TableCell>
            <TableCell>
              <WorkModeBadge workMode={u.work_mode} />
            </TableCell>
            {canViewAttendance && (
              <TableCell>
                <AttendanceMark present={isPresentToday(u)} active={u.is_active} />
              </TableCell>
            )}
            <TableCell>
              <QuietStatus active={u.is_active} />
            </TableCell>
            <TableCell>
              <span data-row-action>
                <TableActions
                  label={`Actions for ${u.name || u.username}`}
                  items={[
                    {
                      label: canEditProfiles ? 'Edit details' : 'View details',
                      icon: Pencil,
                      onClick: () => openUserPanel(u),
                    },
                    ((u.is_active && canDeactivate) || (!u.is_active && canActivate)) && {
                      label: u.is_active ? 'Disable access' : 'Enable access',
                      icon: u.is_active ? UserMinus : UserCheck,
                      tone: u.is_active ? 'danger' : undefined,
                      onClick: () => toggleActive(u),
                    },
                    canChangeRoles &&
                      roleCanBeToggled(u.role) && {
                        label: u.role === 'employee' ? 'Make manager' : 'Make employee',
                        icon: ShieldCheck,
                        onClick: () => changeRole(u),
                      },
                  ]}
                />
              </span>
            </TableCell>
          </TableRow>
        ))}
      </GlassTable>

        {!loading && filteredRows.length > 0 && (
          <TablePagination
            className="border-t border-slate-100 px-4 py-3"
            page={page}
            pageSize={pageSize}
            total={sortedRows.length}
            pageSizes={[10, 25, 50, 100]}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </div>
      )}

      <SlideOverPanel open={createOpen} onClose={() => (createSubmitting ? null : setCreateOpen(false))}>
        <form className="flex h-full min-h-0 flex-col" onSubmit={submitCreate}>
          <div className="p-5 border-b border-hairline flex items-center justify-between">
            <div>
              <p className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Create user</p>
              <p className="mt-1 text-[13px] text-ink-muted">
                New users are automatically assigned to your company.
              </p>
            </div>
            <button
              type="button"
              onClick={() => !createSubmitting && setCreateOpen(false)}
              className="ui-btn-ghost ui-btn-sm"
              disabled={createSubmitting}
            >
              Close
            </button>
          </div>

          <div className="space-y-4 p-5">
            {createError && <Alert type="error">{createError}</Alert>}

            <label className="block space-y-1">
              <span className="ui-label">Username *</span>
              <input
                required
                value={createForm.username}
                onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                autoCapitalize="off"
                className="ui-input"
                placeholder="jane.doe"
              />
            </label>

            <label className="block space-y-1">
              <span className="ui-label">Full name</span>
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                className="ui-input"
                placeholder="Jane Doe"
              />
            </label>

            <label className="block space-y-1">
              <span className="ui-label">Email *</span>
              <input
                required
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                className="ui-input"
                placeholder="jane@company.com"
              />
            </label>

            <label className="block space-y-1">
              <span className="ui-label">Temporary password * (min 8 chars)</span>
              <PasswordInput
                required
                minLength={8}
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="At least 8 characters"
              />
              <span className="ui-hint block">
                Stored in Supabase Auth. User signs in on mobile with this email + password.
              </span>
            </label>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Select
                label="Role"
                required
                value={createForm.role}
                onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}
              >
                <option value="employee">Employee</option>
                {canChangeRoles && <option value="manager">Manager</option>}
              </Select>

              <Select
                label="Department"
                value={createForm.department}
                onChange={(e) => setCreateForm((f) => ({ ...f, department: e.target.value }))}
              >
                <option value="">— None —</option>
                {tenantDepartments.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="ui-label">Position</span>
                <input
                  value={createForm.position}
                  onChange={(e) => setCreateForm((f) => ({ ...f, position: e.target.value }))}
                  className="ui-input"
                  placeholder="Software Engineer"
                />
              </label>

              <Select
                label="Work mode"
                value={createForm.workMode}
                onChange={(e) => setCreateForm((f) => ({ ...f, workMode: e.target.value }))}
              >
                <option value="in_office">In office</option>
                <option value="semi_remote">Hybrid</option>
                <option value="fully_remote">Remote</option>
              </Select>
            </div>

            <div>
              <span id="create-hire-date" className="ui-label">Hire date</span>
              <DatePickerField
                value={createForm.hireDate}
                onChange={(value) => setCreateForm((f) => ({ ...f, hireDate: value }))}
                labelledBy="create-hire-date"
              />
            </div>
          </div>

          <div className="mt-auto p-5 border-t border-hairline flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              disabled={createSubmitting}
              className="ui-btn-secondary ui-btn-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createSubmitting}
              className="ui-btn-primary"
            >
              {createSubmitting ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </SlideOverPanel>

      <SlideOverPanel open={Boolean(activeUser)} onClose={closePanel}>
          {activeUser && (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[17px] font-semibold tracking-tight text-slate-900">{activeUser.name || activeUser.username}</p>
                    <p className="mt-0.5 truncate text-sm text-slate-500">{activeUser.email || activeUser.username}</p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                      <span>{formatRole(activeUser.role)}</span>
                      <span aria-hidden>·</span>
                      <span>{activeUser.department || 'No department'}</span>
                      <span aria-hidden>·</span>
                      <QuietStatus active={activeUser.is_active} />
                    </p>
                  </div>
                  <button type="button" onClick={closePanel} className="ui-btn-ghost ui-btn-sm">Close</button>
                </div>
                <nav className="mt-4 flex gap-1 overflow-x-auto" aria-label="Employee sections">
                  {PROFILE_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setProfileTab(tab.id)}
                      className={`shrink-0 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ${
                        profileTab === tab.id
                          ? 'bg-slate-100 font-semibold text-slate-900'
                          : 'font-medium text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                {editError && <Alert type="error">{editError}</Alert>}

                {profileTab === 'overview' && (
                  <div className="space-y-4">
                    {canEditProfiles && editForm ? (
                      editLoading ? (
                        <p className="text-sm text-slate-500">Loading profile…</p>
                      ) : (
                        <div className="space-y-3">
                          <label className="block space-y-1">
                            <span className="ui-label">Full name</span>
                            <input
                              value={editForm.name}
                              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                              className="ui-input"
                              placeholder="Display name"
                            />
                          </label>
                          <label className="block space-y-1">
                            <span className="ui-label">Username</span>
                            <input
                              value={editForm.username}
                              onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))}
                              className="ui-input"
                            />
                          </label>
                          <label className="block space-y-1">
                            <span className="ui-label">Email</span>
                            <input
                              type="email"
                              value={editForm.email}
                              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                              className="ui-input"
                            />
                          </label>
                          {activeUser.role === 'super_admin' && (
                            <label className="block space-y-1">
                              <span className="ui-label">Report email <span className="font-normal text-slate-400">(optional)</span></span>
                              <input
                                type="email"
                                value={editForm.report_email || ''}
                                onChange={(e) => setEditForm((f) => ({ ...f, report_email: e.target.value }))}
                                placeholder="reports@company.com"
                                className="ui-input"
                              />
                            </label>
                          )}
                          <Select
                            label="Department"
                            value={editForm.department}
                            onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))}
                          >
                            <option value="">— None —</option>
                            {tenantDepartments.map((d) => (
                              <option key={d.id} value={d.name}>{d.name}</option>
                            ))}
                          </Select>
                          <label className="block space-y-1">
                            <span className="ui-label">Position</span>
                            <input
                              value={editForm.position}
                              onChange={(e) => setEditForm((f) => ({ ...f, position: e.target.value }))}
                              className="ui-input"
                              placeholder="Software Engineer"
                            />
                          </label>
                          <Select
                            label="Work mode"
                            value={editForm.work_mode}
                            onChange={(e) => setEditForm((f) => ({ ...f, work_mode: e.target.value }))}
                          >
                            <option value="in_office">In office</option>
                            <option value="semi_remote">Hybrid</option>
                            <option value="fully_remote">Remote</option>
                          </Select>
                          <div>
                            <span id="edit-hire-date" className="ui-label">Hire date</span>
                            <DatePickerField
                              value={editForm.hire_date}
                              onChange={(value) => setEditForm((f) => ({ ...f, hire_date: value }))}
                              labelledBy="edit-hire-date"
                            />
                          </div>
                        </div>
                      )
                    ) : (
                      <dl>
                        <ProfileField label="Name">{activeUser.name || '—'}</ProfileField>
                        <ProfileField label="Username">{activeUser.username}</ProfileField>
                        <ProfileField label="Email">{activeUser.email || '—'}</ProfileField>
                        <ProfileField label="Role">{formatRole(activeUser.role)}</ProfileField>
                        <ProfileField label="Department">{activeUser.department || '—'}</ProfileField>
                        <ProfileField label="Position">{activeUser.position || '—'}</ProfileField>
                        <ProfileField label="Work mode">{formatWorkMode(activeUser.work_mode)}</ProfileField>
                        <ProfileField label="Hire date">{activeUser.hire_date || '—'}</ProfileField>
                        <ProfileField label="Status">{activeUser.is_active ? 'Active' : 'Inactive'}</ProfileField>
                      </dl>
                    )}
                  </div>
                )}

                {profileTab === 'attendance' && (
                  <div>
                    {!canViewAttendance ? (
                      <p className="text-sm text-slate-500">Attendance records are not available for this account.</p>
                    ) : activeAttendance.length === 0 ? (
                      <p className="text-sm text-slate-500">No check-ins recorded yet for this employee.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {activeAttendance.map((row, index) => {
                          const type = normalizeAttendanceType(row.type);
                          return (
                            <li key={row.id || `${row.timestamp}-${index}`} className="flex items-baseline justify-between gap-3 py-2.5">
                              <span className="text-sm text-slate-700">
                                {type === 'checkout' ? 'Checked out' : row.is_manual ? 'Manual entry' : 'Checked in'}
                              </span>
                              <span className="shrink-0 text-xs tabular-nums text-slate-400">
                                {clockTime(row.timestamp) || asLastActive({ updated_at: row.timestamp })}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {canViewAttendance && (
                      <p className="mt-3 text-xs text-slate-400">
                        Today: {isPresentToday(activeUser) ? 'In' : activeUser.is_active ? 'Not in' : 'Inactive'}
                      </p>
                    )}
                  </div>
                )}

                {profileTab === 'leave' && (
                  <div className="space-y-4">
                    {canEditLeaveBalance && editForm && !editLoading ? (
                      <div className="grid grid-cols-3 gap-3">
                        <label className="block space-y-1">
                          <span className="ui-label">Annual</span>
                          <input
                            type="number"
                            min={0}
                            value={editForm.annual_leaves}
                            onChange={(e) => setEditForm((f) => ({ ...f, annual_leaves: e.target.value }))}
                            className="ui-input"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="ui-label">Sick</span>
                          <input
                            type="number"
                            min={0}
                            value={editForm.sick_leaves}
                            onChange={(e) => setEditForm((f) => ({ ...f, sick_leaves: e.target.value }))}
                            className="ui-input"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="ui-label">Casual</span>
                          <input
                            type="number"
                            min={0}
                            value={editForm.casual_leaves}
                            onChange={(e) => setEditForm((f) => ({ ...f, casual_leaves: e.target.value }))}
                            className="ui-input"
                          />
                        </label>
                      </div>
                    ) : activeUser.leave_balance ? (
                      <dl>
                        <ProfileField label="Annual">{activeUser.leave_balance.annual_leaves ?? '—'}</ProfileField>
                        <ProfileField label="Sick">{activeUser.leave_balance.sick_leaves ?? '—'}</ProfileField>
                        <ProfileField label="Casual">{activeUser.leave_balance.casual_leaves ?? '—'}</ProfileField>
                      </dl>
                    ) : (
                      <p className="text-sm text-slate-500">Leave balances are not loaded for this employee.</p>
                    )}
                    {canViewLeaves && (
                      activeLeaves.length === 0 ? (
                        <p className="text-sm text-slate-500">No leave requests on file.</p>
                      ) : (
                        <ul className="divide-y divide-slate-100">
                          {activeLeaves.map((leave) => (
                            <li key={leave.id} className="flex items-baseline justify-between gap-3 py-2.5">
                              <span className="text-sm text-slate-700">{formatLeaveTypeLabel(leave.leave_type)}</span>
                              <span className="text-xs text-slate-400">{formatLeaveStatus(leave.status)}</span>
                            </li>
                          ))}
                        </ul>
                      )
                    )}
                  </div>
                )}

                {profileTab === 'work_mode' && (
                  <div>
                    <dl>
                      <ProfileField label="Current">{formatWorkMode(activeUser.work_mode)}</ProfileField>
                    </dl>
                    {!canViewWorkModes ? null : activeWorkModes.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">No work mode requests for this employee.</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-slate-100">
                        {activeWorkModes.map((request) => (
                          <li key={request.id} className="flex items-baseline justify-between gap-3 py-2.5">
                            <span className="text-sm text-slate-700">
                              {formatWorkMode(request.current_work_mode)} → {formatWorkMode(request.requested_work_mode)}
                            </span>
                            <span className="text-xs text-slate-400">{formatLeaveStatus(request.status)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {profileTab === 'activity' && (
                  <dl>
                    <ProfileField label="Last updated">{asLastActive(activeUser)}</ProfileField>
                    <ProfileField label="Joined">{formatJoined(activeUser.created_at)}</ProfileField>
                    {activeLeaves[0] && (
                      <ProfileField label="Latest leave">
                        {formatLeaveTypeLabel(activeLeaves[0].leave_type)} · {formatLeaveStatus(activeLeaves[0].status)}
                      </ProfileField>
                    )}
                  </dl>
                )}
              </div>

              <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-200 px-5 py-4">
                {canEditProfiles && editForm && profileTab === 'overview' && (
                  <button
                    type="button"
                    onClick={saveProfile}
                    disabled={editSaving || editLoading}
                    className="ui-btn-primary ui-btn-sm"
                  >
                    {editSaving ? 'Saving…' : 'Save profile'}
                  </button>
                )}
                {canEditLeaveBalance && editForm && profileTab === 'leave' && (
                  <button
                    type="button"
                    onClick={saveProfile}
                    disabled={editSaving || editLoading}
                    className="ui-btn-primary ui-btn-sm"
                  >
                    {editSaving ? 'Saving…' : 'Save leave'}
                  </button>
                )}
                {canChangeRoles && roleCanBeToggled(activeUser.role) && (
                  <button
                    type="button"
                    onClick={() => changeRole(activeUser)}
                    className="ui-btn-secondary ui-btn-sm"
                  >
                    {activeUser.role === 'employee' ? 'Make manager' : 'Make employee'}
                  </button>
                )}
                {((activeUser.is_active && canDeactivate) || (!activeUser.is_active && canActivate)) && activeUser.role !== 'super_admin' && (
                  <button type="button" onClick={() => toggleActive(activeUser)} className="ui-btn-secondary ui-btn-sm">
                    {activeUser.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                )}
              </div>
            </div>
          )}
      </SlideOverPanel>
    </div>
  );
}

function QuietStatus({ active }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function AttendanceMark({ present, active }) {
  if (!active) {
    return <span className="text-sm text-slate-400">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
      <span className={`h-1.5 w-1.5 rounded-full ${present ? 'bg-[#00B0FF]' : 'bg-slate-300'}`} aria-hidden />
      {present ? 'In today' : 'Not in'}
    </span>
  );
}

function WorkModeBadge({ workMode }) {
  const style = getWorkModeBadgeStyle(workMode);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2 text-sm text-slate-600">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: style.pie }} aria-hidden />
      <span className="truncate">{style.label}</span>
    </span>
  );
}

function EmployeeCard({ person, hours, capHours, showCapacity, onOpen }) {
  const name = person.name || person.username || 'User';
  const title = person.position || formatRole(person.role);
  const percent = capHours > 0 ? Math.round((hours / capHours) * 100) : 0;
  const tone = capacityTone(percent);
  const fill = Math.min(Math.max(percent, 0), 100);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="user-card flex w-full min-w-0 flex-col gap-2 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2.5 text-left shadow-sm transition-shadow duration-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00B0FF]/30 sm:p-3"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase sm:h-9 sm:w-9 sm:text-xs ${avatarTone(name)}`}
          aria-hidden
        >
          {getInitials(name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight text-slate-900">{name}</span>
          <span className="mt-0.5 block truncate text-xs leading-tight text-slate-400">{title}</span>
        </span>
      </div>

      {showCapacity && (
        <div className="min-w-0">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] tabular-nums">
            <span className={`truncate ${tone.hours}`}>
              {formatLoggedHours(hours)}/{capHours}h
            </span>
            <span className={`shrink-0 ${tone.percent}`}>{percent}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${fill}%` }} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 items-center gap-1.5">
        <WorkModeBadge workMode={person.work_mode} />
      </div>
    </button>
  );
}

function DirectoryGridSkeleton() {
  return (
    <SkeletonGroup label="Loading directory" className="users-board flex flex-col gap-3">
      {[0, 1].map((section) => (
        <div key={section} className="min-h-0">
          <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Skeleton className="h-4 w-4 shrink-0" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-[4.5rem]" rounded="rounded-full" />
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-2xl border border-slate-200 bg-white p-2.5 sm:p-3">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="h-9 w-9 shrink-0" rounded="rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
                <Skeleton className="mt-2.5 h-1 w-full" rounded="rounded-full" />
                <div className="mt-2.5 flex items-center gap-2">
                  <Skeleton className="h-4 w-4 shrink-0" rounded="rounded-full" />
                  <Skeleton className="h-3 w-32 max-w-[70%]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}

function UsersDirectoryGrid({
  loading,
  directoryEmpty,
  groups,
  filteredCount,
  canCreate,
  canViewAttendance,
  weeklyHoursByUid,
  onOpen,
  onCreate,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());

  const toggleDepartment = (name) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (loading) return <DirectoryGridSkeleton />;

  if (filteredCount === 0) {
    return (
      <div className="flex items-center justify-center overflow-hidden rounded-2xl border border-slate-200/80 bg-white px-6 py-8">
        <EmptyStateBody
          icon={UsersRound}
          title={directoryEmpty ? 'No employees yet' : 'No matching employees'}
          description={
            directoryEmpty
              ? 'Add the first person to start building your workforce directory. You can assign a role, department and work mode when they join.'
              : 'Try a different search or filter to find the employee you need.'
          }
          action={
            directoryEmpty && canCreate ? (
              <button
                type="button"
                onClick={onCreate}
                data-on-dark
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#00B0FF] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#0099E6]"
              >
                Add user
              </button>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className="users-board flex flex-col gap-3">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.name);
        const count = group.members.length;
        return (
          <section key={group.name} className="users-dept flex min-h-0 flex-col">
            <header className="mb-3 border-b border-slate-100 pb-2">
              <button
                type="button"
                onClick={() => toggleDepartment(group.name)}
                aria-expanded={!isCollapsed}
                className="flex w-full min-w-0 items-center gap-2 text-left"
              >
                <ChevronDown
                  size={16}
                  strokeWidth={2}
                  className={`shrink-0 text-slate-400 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                  aria-hidden
                />
                <h2 className="users-dept-title min-w-0 truncate text-sm font-semibold text-slate-800">
                  {group.name}
                </h2>
                <span className="inline-flex shrink-0 items-center rounded-full border border-sky-200/60 bg-sky-50 px-2 py-0.5 text-xs font-medium tabular-nums text-sky-700">
                  {count} {count === 1 ? 'member' : 'members'}
                </span>
              </button>
            </header>
            {!isCollapsed && (
              <div className="grid min-h-0 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.members.map((person) => (
                  <EmployeeCard
                    key={person.uid}
                    person={person}
                    hours={weeklyHoursByUid.get(person.uid) || 0}
                    capHours={WEEKLY_CAP_HOURS}
                    showCapacity={canViewAttendance}
                    onOpen={() => onOpen(person)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ProfileField({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <dt className="shrink-0 text-xs font-medium text-slate-400">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-slate-800">{children || '—'}</dd>
    </div>
  );
}

function ToolbarPopover({ open, onClose, width = 260, children, renderTrigger }) {
  const reduceMotion = useReducedMotion();
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const rootRef = useDismiss(
    useCallback(() => onClose?.(), [onClose]),
    panelRef,
  );
  const [placement, setPlacement] = useState(null);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxWidth = Math.min(width, window.innerWidth - 16);
    let left = rect.left;
    if (left + maxWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - maxWidth - 8);
    }
    const estimated = 320;
    let top = rect.bottom + 6;
    if (top + estimated > window.innerHeight - 8) {
      top = Math.max(8, rect.top - Math.min(estimated, window.innerHeight * 0.55) - 6);
    }
    setPlacement({ top, left, width: maxWidth });
  }, [width]);

  useEffect(() => {
    if (!open) {
      setPlacement(null);
      return undefined;
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  return (
    <div ref={rootRef} className="inline-flex">
      {renderTrigger(triggerRef)}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && placement ? (
              <motion.div
                ref={panelRef}
                role="dialog"
                initial={reduceMotion ? false : DROPDOWN_MOTION.initial}
                animate={DROPDOWN_MOTION.animate}
                exit={reduceMotion ? undefined : DROPDOWN_MOTION.exit}
                transition={DROPDOWN_MOTION.transition}
                style={{
                  position: 'fixed',
                  top: placement.top,
                  left: placement.left,
                  width: placement.width,
                  minWidth: placement.width,
                  transformOrigin: 'top center',
                  zIndex: 80,
                }}
                className="ui-menu max-h-80 w-max overflow-y-auto overscroll-contain"
                data-lenis-prevent
              >
                {children}
              </motion.div>
            ) : null}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}

function FilterSection({ label, value, options, onChange }) {
  return (
    <div className="py-1">
      <p className="ui-menu-label">{label}</p>
      {options.map((option) => {
        const selected = String(option.value) === String(value);
        return (
          <button
            key={String(option.value)}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'ui-menu-item justify-between whitespace-nowrap',
              selected && 'ui-menu-item-selected',
            )}
          >
            <span className="whitespace-nowrap">{option.label}</span>
            {selected && <Check className="ml-auto h-4 w-4 shrink-0 text-[#00A3FF]" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
