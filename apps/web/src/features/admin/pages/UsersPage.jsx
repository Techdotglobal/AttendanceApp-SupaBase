import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { adminService } from '../services/adminService';
import { useAuthStore } from '../../auth/store/authStore';
import { Pencil, Search, ShieldCheck, UserCheck, UserMinus, UserPlus, Users } from 'lucide-react';
import {
  GlassTable,
  TableActions,
  TableCell,
  TableIdentity,
  TablePagination,
  TableRow,
  TableSelectionBar,
  TableToolbar,
} from '../../../shared/components/GlassTable';
import { SlideOverPanel } from '../../../shared/components/SlideOverPanel';
import { PasswordInput } from '../../../shared/components/PasswordInput';
import { Alert } from '../../../shared/components/ui/Alert';
import { RoleBadge, StatusBadge } from '../../../shared/components/ui/Badge';
import { Button } from '../../../shared/components/ui/Button';
import { PageHeader } from '../../../shared/components/ui/PageHeader';
import { hasPermission, PERMISSIONS } from '../permissions';

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

const WORK_MODE_OPTIONS = [
  { value: 'in_office', label: 'In office' },
  { value: 'fully_remote', label: 'Remote' },
  { value: 'semi_remote', label: 'Hybrid' },
];

const roleCanBeToggled = (targetRole) => targetRole === 'employee' || targetRole === 'manager';

const formatWorkMode = (value) => WORK_MODE_LABELS[String(value || 'in_office').toLowerCase()] || 'In office';

const normalizeWorkMode = (value) => {
  const key = String(value || 'in_office').trim().toLowerCase();
  if (key === 'fully_remote' || key === 'remote') return 'fully_remote';
  if (key === 'semi_remote' || key === 'hybrid') return 'semi_remote';
  return 'in_office';
};

/** Column key -> comparable value. Keys mirror the table's column keys. */
const SORT_VALUES = {
  name: (row) => (row.name || row.username || '').toLowerCase(),
  role: (row) => (row.role || '').toLowerCase(),
  dept: (row) => (row.department || '').toLowerCase(),
  status: (row) => (row.is_active ? 0 : 1),
  last: (row) => (row.updated_at ? new Date(row.updated_at).getTime() : 0),
};

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
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [activeUser, setActiveUser] = useState(null);
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

  const loadUsers = async () => {
    setError('');
    try {
      const users = await adminService.getUsers();
      setRows(users || []);
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
  }, []);

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
      workMode: normalizeWorkMode(createForm.workMode),
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
      const bySearch = `${row.name || ''} ${row.username || ''} ${row.department || ''}`.toLowerCase().includes(search.toLowerCase().trim());
      const byRole = roleFilter === 'all' || row.role === roleFilter;
      const byDepartment = departmentFilter === 'all' || row.department === departmentFilter;
      const byStatus = statusFilter === 'all' || (statusFilter === 'active' ? row.is_active : !row.is_active);
      return bySearch && byRole && byDepartment && byStatus;
    });
  }, [rows, search, roleFilter, departmentFilter, statusFilter]);

  const sortedRows = useMemo(() => {
    const read = SORT_VALUES[sortKey];
    if (!read) return filteredRows;
    const direction = sortDir === 'asc' ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const left = read(a);
      const right = read(b);
      if (left === right) return 0;
      return left > right ? direction : -direction;
    });
  }, [filteredRows, sortKey, sortDir]);

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
    if (!SORT_VALUES[key]) return;
    setSortDir((prev) => (sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
    setSortKey(key);
    setPage(1);
  };

  const departments = useMemo(() => {
    return ['all', ...Array.from(new Set(rows.map((r) => r.department).filter(Boolean))).sort()];
  }, [rows]);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, departmentFilter, statusFilter]);

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
  };

  const openUserPanel = async (u) => {
    setActiveUser(u);
    setEditError('');
    if (!canEditProfiles) {
      setEditForm(null);
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
        work_mode: normalizeWorkMode(profile?.work_mode || u.work_mode),
        annual_leaves: lb.annual_leaves ?? 20,
        sick_leaves: lb.sick_leaves ?? 10,
        casual_leaves: lb.casual_leaves ?? 5,
      });
      if (!profile) {
        setEditError('');
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
        work_mode: normalizeWorkMode(u.work_mode),
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
        work_mode: normalizeWorkMode(editForm.work_mode),
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
        work_mode: updated?.work_mode ?? normalizeWorkMode(editForm.work_mode),
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

  return (
    <div className="space-y-5 animate-fade-up">
      <PageHeader
        title="User Management"
        subtitle="Manage users, roles, and department assignments."
        actions={
          canCreate && (
            <Button onClick={openCreate}>
              <UserPlus className="h-4 w-4" strokeWidth={2} aria-hidden />
              Create user
            </Button>
          )
        }
      />

      <TableToolbar
        search={
          <>
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
              strokeWidth={2}
              aria-hidden
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users, roles..."
              aria-label="Search users"
              className="ui-input ui-input-icon"
            />
          </>
        }
        filters={
          <>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role" className="ui-select w-auto">
              <option value="all">All roles</option>
              <option value="super_admin">Super Admin</option>
              <option value="manager">Manager</option>
              <option value="employee">Employee</option>
            </select>
            <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} aria-label="Filter by department" className="ui-select w-auto">
              {departments.map((dep) => (
                <option key={dep} value={dep}>{dep === 'all' ? 'All departments' : dep}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" className="ui-select w-auto">
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </>
        }
        actions={
          <p className="text-caption font-medium tabular-nums text-ink-muted">
            {filteredRows.length} {filteredRows.length === 1 ? 'user' : 'users'}
          </p>
        }
      />

      {error && <Alert type="error">{error}</Alert>}
      {saveSuccess && <Alert type="success">{saveSuccess}</Alert>}

      <TableSelectionBar count={selectedCount} onClear={() => setSelected({})}>
        <Button size="sm" variant="secondary" disabled={!canBulkDeactivate} onClick={bulkDeactivate}>
          <UserMinus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          Disable
        </Button>
      </TableSelectionBar>

      <GlassTable
        loading={loading}
        skeletonRows={6}
        maxHeight="min(68vh, 42rem)"
        emptyIcon={Users}
        emptyTitle="No users found"
        emptyMessage="Try adjusting your search or filters to widen the results."
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={requestSort}
        columns={[
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
          { key: 'name', label: 'Name', sortable: true },
          { key: 'role', label: 'Role', sortable: true },
          { key: 'dept', label: 'Department', sortable: true },
          { key: 'status', label: 'Status', sortable: true },
          { key: 'last', label: 'Last active', sortable: true, className: 'w-32' },
          { key: 'actions', label: <span className="sr-only">Actions</span>, className: 'w-16' },
        ]}
      >
        {pagedRows.map((u) => (
          <TableRow key={u.uid} selected={Boolean(selected[u.uid])}>
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
                name={u.name || u.username}
                secondary={u.email}
                onClick={() => openUserPanel(u)}
              />
            </TableCell>
            <TableCell>
              <RoleBadge role={u.role} />
            </TableCell>
            <TableCell className="text-ink-muted">{u.department || '—'}</TableCell>
            <TableCell>
              <StatusBadge status={u.is_active ? 'active' : 'inactive'} />
            </TableCell>
            <TableCell className="whitespace-nowrap text-caption text-ink-muted">{asLastActive(u)}</TableCell>
            <TableCell>
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
            </TableCell>
          </TableRow>
        ))}
      </GlassTable>

      {!loading && filteredRows.length > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={sortedRows.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}

      <SlideOverPanel open={createOpen} onClose={() => (createSubmitting ? null : setCreateOpen(false))}>
        <form className="h-full flex flex-col" onSubmit={submitCreate}>
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

          <div className="p-5 space-y-4 overflow-y-auto">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="ui-label">Role *</span>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}
                  className="ui-select"
                >
                  <option value="employee">Employee</option>
                  {canChangeRoles && <option value="manager">Manager</option>}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="ui-label">Department</span>
                <select
                  value={createForm.department}
                  onChange={(e) => setCreateForm((f) => ({ ...f, department: e.target.value }))}
                  className="ui-select"
                >
                  <option value="">— None —</option>
                  {tenantDepartments.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
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

              <label className="block space-y-1">
                <span className="ui-label">Work mode</span>
                <select
                  value={createForm.workMode}
                  onChange={(e) => setCreateForm((f) => ({ ...f, workMode: e.target.value }))}
                  className="ui-select"
                >
                  {WORK_MODE_OPTIONS.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block space-y-1">
              <span className="ui-label">Hire date</span>
              <input
                type="date"
                value={createForm.hireDate}
                onChange={(e) => setCreateForm((f) => ({ ...f, hireDate: e.target.value }))}
                className="ui-input"
              />
            </label>
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
            <div className="h-full flex flex-col">
              <div className="p-5 border-b border-hairline flex items-center justify-between">
                <div>
                  <p className="text-[17px] font-semibold tracking-[-0.015em] text-ink">{activeUser.name || activeUser.username}</p>
                  <p className="mt-1 text-[13px] text-ink-muted">{activeUser.email}</p>
                </div>
                <button onClick={closePanel} className="ui-btn-ghost ui-btn-sm">Close</button>
              </div>

              <div className="p-5 space-y-5 overflow-y-auto">
                {editError && <Alert type="error">{editError}</Alert>}

                <section>
                  <p className="card-eyebrow mb-2 block">Profile</p>
                  {canEditProfiles && editForm ? (
                    <div className="rounded-xl border border-hairline bg-surface-subtle p-4 space-y-3 text-sm">
                      {editLoading ? (
                        <p className="text-ink-muted">Loading profile…</p>
                      ) : (
                        <>
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
                          {activeUser?.role === 'super_admin' && (
                            <label className="block space-y-1">
                              <span className="ui-label">Report email <span className="text-ink-muted">(optional — overrides login email for reports)</span></span>
                              <input
                                type="email"
                                value={editForm.report_email || ''}
                                onChange={(e) => setEditForm((f) => ({ ...f, report_email: e.target.value }))}
                                placeholder="reports@company.com"
                                className="ui-input"
                              />
                            </label>
                          )}
                          <label className="block space-y-1">
                            <span className="ui-label">Department</span>
                            <select
                              value={editForm.department}
                              onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))}
                              className="ui-select"
                            >
                              <option value="">— None —</option>
                              {tenantDepartments.map((d) => (
                                <option key={d.id} value={d.name}>
                                  {d.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block space-y-1">
                            <span className="ui-label">Work mode</span>
                            <select
                              value={editForm.work_mode}
                              onChange={(e) => setEditForm((f) => ({ ...f, work_mode: e.target.value }))}
                              className="ui-select"
                            >
                              {WORK_MODE_OPTIONS.map((mode) => (
                                <option key={mode.value} value={mode.value}>
                                  {mode.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p className="text-xs text-ink-muted">
                            Role: {activeUser.role} / Status: {activeUser.is_active ? 'Active' : 'Inactive'}
                          </p>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-hairline bg-surface-subtle p-4 space-y-2 text-sm">
                      <p><span className="text-ink-muted">Name:</span> <span className="text-ink">{activeUser.name || '-'}</span></p>
                      <p><span className="text-ink-muted">Username:</span> <span className="text-ink">{activeUser.username}</span></p>
                      <p><span className="text-ink-muted">Role:</span> <span className="text-ink">{activeUser.role}</span></p>
                      <p><span className="text-ink-muted">Department:</span> <span className="text-ink">{activeUser.department || '-'}</span></p>
                      <p><span className="text-ink-muted">Work mode:</span> <span className="text-ink">{formatWorkMode(activeUser.work_mode)}</span></p>
                      <p><span className="text-ink-muted">Status:</span> <span className="text-ink">{activeUser.is_active ? 'Active' : 'Inactive'}</span></p>
                    </div>
                  )}
                </section>

                {canEditLeaveBalance && editForm && !editLoading && (
                  <section>
                    <p className="card-eyebrow mb-2 block">Leave allocation</p>
                    <div className="rounded-xl border border-hairline bg-surface-subtle p-4 grid grid-cols-3 gap-3 text-sm">
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
                  </section>
                )}

                <section>
                  <p className="card-eyebrow mb-2 block">Activity</p>
                  <div className="rounded-xl border border-hairline bg-surface-subtle p-4 text-sm text-ink-muted">
                    <p>Last updated: {asLastActive(activeUser)}</p>
                  </div>
                </section>
              </div>

              <div className="mt-auto p-5 border-t border-hairline flex flex-wrap gap-2">
                {canEditProfiles && editForm && (
                  <button
                    type="button"
                    onClick={saveProfile}
                    disabled={editSaving || editLoading}
                    className="ui-btn-primary ui-btn-sm"
                  >
                    {editSaving ? 'Saving…' : 'Save profile'}
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
                  <button onClick={() => toggleActive(activeUser)} className="ui-btn-secondary ui-btn-sm">
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
