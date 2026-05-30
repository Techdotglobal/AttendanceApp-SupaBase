import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { adminService } from '../services/adminService';
import { useAuthStore } from '../../auth/store/authStore';
import { GlassCard } from '../../../shared/components/GlassCard';
import { GlassTable } from '../../../shared/components/GlassTable';
import { SlideOverPanel } from '../../../shared/components/SlideOverPanel';
import { PasswordInput } from '../../../shared/components/PasswordInput';

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-100">
      <td className="p-3"><div className="h-4 w-4 rounded bg-slate-200 animate-pulse" /></td>
      <td className="p-3"><div className="h-8 w-44 rounded bg-slate-200 animate-pulse" /></td>
      <td className="p-3"><div className="h-6 w-20 rounded bg-slate-200 animate-pulse" /></td>
      <td className="p-3"><div className="h-6 w-24 rounded bg-slate-200 animate-pulse" /></td>
      <td className="p-3"><div className="h-6 w-20 rounded bg-slate-200 animate-pulse" /></td>
      <td className="p-3"><div className="h-6 w-28 rounded bg-slate-200 animate-pulse" /></td>
      <td className="p-3"><div className="h-6 w-36 rounded bg-slate-200 animate-pulse" /></td>
    </tr>
  );
}

const roleStyles = {
  super_admin: 'bg-blue-50 text-blue-700 border-blue-100',
  manager: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  employee: 'bg-slate-100 text-slate-700 border-slate-200',
};

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

const isHrAdmin = (u) =>
  u?.role === 'manager' && String(u?.department || '').toLowerCase() === 'hr';

const canEditAnyProfile = (u) => u?.role === 'super_admin' || isHrAdmin(u);

const canChangeRoles = (u) => u?.role === 'super_admin' || isHrAdmin(u);

const roleCanBeToggled = (targetRole) => targetRole === 'employee' || targetRole === 'manager';

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

  const canCreate = user?.role === 'super_admin' || user?.role === 'manager';
  const canEditProfiles = canEditAnyProfile(user);

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
    if (!canChangeRoles(user)) {
      setError('Only super admins and HR managers can change roles.');
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

  const departments = useMemo(() => {
    return ['all', ...Array.from(new Set(rows.map((r) => r.department).filter(Boolean))).sort()];
  }, [rows]);

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every((r) => selected[r.uid]);

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = { ...prev };
        for (const row of filteredRows) delete next[row.uid];
        return next;
      });
      return;
    }
    const next = {};
    for (const row of filteredRows) next[row.uid] = true;
    setSelected((prev) => ({ ...prev, ...next }));
  };

  const bulkDeactivate = async () => {
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
        department: (profile?.department || u.department) ?? '',
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
        department: u.department || '',
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
        department: editForm.department || '',
        annual_leaves: Number(editForm.annual_leaves),
        sick_leaves: Number(editForm.sick_leaves),
        casual_leaves: Number(editForm.casual_leaves),
      };
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

  const initials = (value) =>
    (value || 'U')
      .split(' ')
      .map((part) => part.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('');

  const asLastActive = (row) => {
    if (!row.updated_at) return 'N/A';
    return new Date(row.updated_at).toLocaleString();
  };

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">User Management</h1>
          <p className="mt-1 text-sm text-slate-200">Manage users, roles, and department assignments.</p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={openCreate}
            className="self-start md:self-auto rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 active:scale-[0.99] transition-all duration-200 shadow"
          >
            + Create user
          </button>
        )}
      </div>

      <GlassCard className="p-4">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users, roles..."
            className="w-full xl:max-w-sm rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300/30"
          />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="glass-select rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100">
            <option value="all">All roles</option>
            <option value="super_admin">Super Admin</option>
            <option value="manager">Manager</option>
            <option value="employee">Employee</option>
          </select>
          <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="glass-select rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100">
            {departments.map((dep) => (
              <option key={dep} value={dep}>{dep === 'all' ? 'All departments' : dep}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="glass-select rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100">
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            disabled={selectedCount === 0}
            onClick={bulkDeactivate}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/20 transition-all duration-200"
          >
            Disable selected ({selectedCount})
          </button>
        </div>
      </GlassCard>
      {error && <GlassCard className="p-4 text-sm text-red-100">{error}</GlassCard>}
      {saveSuccess && <GlassCard className="p-4 text-sm text-emerald-100">{saveSuccess}</GlassCard>}

      <GlassTable
        columns={[
          { key: 'check', label: <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} />, className: 'w-12' },
          { key: 'name', label: 'Name' },
          { key: 'role', label: 'Role' },
          { key: 'dept', label: 'Department' },
          { key: 'status', label: 'Status' },
          { key: 'last', label: 'Last Active' },
          { key: 'actions', label: 'Actions' },
        ]}
      >
            {loading && (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            )}

            {!loading && filteredRows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-10 text-center">
                  <p className="text-white font-medium">No users found</p>
                  <p className="mt-1 text-slate-300 text-sm">Try adjusting your search or filters.</p>
                </td>
              </tr>
            )}

            {!loading &&
              filteredRows.map((u) => (
                <tr key={u.uid} className="border-b border-white/10 hover:bg-white/10 transition-all duration-200">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[u.uid])}
                      onChange={() => setSelected((prev) => ({ ...prev, [u.uid]: !prev[u.uid] }))}
                    />
                  </td>
                  <td className="p-3">
                    <button type="button" className="flex items-center gap-3" onClick={() => openUserPanel(u)}>
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                        {initials(u.name || u.username)}
                      </span>
                      <span>
                        <span className="block text-slate-900 font-medium">{u.name || u.username}</span>
                        <span className="block text-xs text-slate-300">{u.email}</span>
                      </span>
                    </button>
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${roleStyles[u.role] || roleStyles.employee}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="p-3 text-slate-100">{u.department || '-'}</td>
                  <td className="p-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${u.is_active ? 'bg-emerald-400/20 text-emerald-100' : 'bg-slate-200/20 text-slate-300'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-slate-300">{asLastActive(u)}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openUserPanel(u)} className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 hover:bg-white/20">
                        {canEditProfiles ? 'Edit' : 'View'}
                      </button>
                      <button onClick={() => toggleActive(u)} className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 hover:bg-white/20">
                        {u.is_active ? 'Disable' : 'Enable'}
                      </button>
                      {canChangeRoles(user) && roleCanBeToggled(u.role) && (
                        <button
                          type="button"
                          onClick={() => changeRole(u)}
                          className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 hover:bg-white/20"
                          title={u.role === 'employee' ? 'Promote to manager' : 'Set to employee'}
                        >
                          {u.role === 'employee' ? 'Make manager' : 'Make employee'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
      </GlassTable>

      <SlideOverPanel open={createOpen} onClose={() => (createSubmitting ? null : setCreateOpen(false))}>
        <form className="h-full flex flex-col" onSubmit={submitCreate}>
          <div className="p-5 border-b border-white/10 flex items-center justify-between">
            <div>
              <p className="text-lg font-semibold text-white">Create user</p>
              <p className="text-xs text-slate-300">
                New users are automatically assigned to your company.
              </p>
            </div>
            <button
              type="button"
              onClick={() => !createSubmitting && setCreateOpen(false)}
              className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-sm text-slate-200 hover:bg-white/20"
              disabled={createSubmitting}
            >
              Close
            </button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto">
            {createError && (
              <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
                {createError}
              </div>
            )}

            <label className="block space-y-1">
              <span className="text-xs text-slate-300">Username *</span>
              <input
                required
                value={createForm.username}
                onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                autoCapitalize="off"
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-400"
                placeholder="jane.doe"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-slate-300">Full name</span>
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-400"
                placeholder="Jane Doe"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-slate-300">Email *</span>
              <input
                required
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-400"
                placeholder="jane@company.com"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-slate-300">Temporary password * (min 8 chars)</span>
              <PasswordInput
                required
                minLength={8}
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="At least 8 characters"
              />
              <span className="text-[10px] text-slate-400">
                Stored in Supabase Auth. User signs in on mobile with this email + password.
              </span>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs text-slate-300">Role *</span>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}
                  className="glass-select w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-slate-100"
                >
                  <option value="employee">Employee</option>
                  {user?.role === 'super_admin' && <option value="manager">Manager</option>}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-slate-300">Department</span>
                <select
                  value={createForm.department}
                  onChange={(e) => setCreateForm((f) => ({ ...f, department: e.target.value }))}
                  className="glass-select w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-slate-100"
                >
                  <option value="" className="bg-slate-100 text-slate-900">— None —</option>
                  {tenantDepartments.map((d) => (
                    <option key={d.id} value={d.name} className="bg-slate-100 text-slate-900">
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs text-slate-300">Position</span>
                <input
                  value={createForm.position}
                  onChange={(e) => setCreateForm((f) => ({ ...f, position: e.target.value }))}
                  className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-400"
                  placeholder="Software Engineer"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-slate-300">Work mode</span>
                <select
                  value={createForm.workMode}
                  onChange={(e) => setCreateForm((f) => ({ ...f, workMode: e.target.value }))}
                  className="glass-select w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-slate-100"
                >
                  <option value="in_office">In office</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-xs text-slate-300">Hire date</span>
              <input
                type="date"
                value={createForm.hireDate}
                onChange={(e) => setCreateForm((f) => ({ ...f, hireDate: e.target.value }))}
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-slate-100"
              />
            </label>
          </div>

          <div className="mt-auto p-5 border-t border-white/10 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              disabled={createSubmitting}
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/20"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createSubmitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 active:scale-[0.99] transition-all duration-200"
            >
              {createSubmitting ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </SlideOverPanel>

      <SlideOverPanel open={Boolean(activeUser)} onClose={closePanel}>
          {activeUser && (
            <div className="h-full flex flex-col">
              <div className="p-5 border-b border-white/10 flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-white">{activeUser.name || activeUser.username}</p>
                  <p className="text-xs text-slate-300">{activeUser.email}</p>
                </div>
                <button onClick={closePanel} className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-sm text-slate-200 hover:bg-white/20">Close</button>
              </div>

              <div className="p-5 space-y-5 overflow-y-auto">
                {editError && (
                  <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
                    {editError}
                  </div>
                )}

                <section>
                  <p className="text-xs uppercase tracking-wide text-slate-300 mb-2">Profile</p>
                  {canEditProfiles && editForm ? (
                    <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3 text-sm">
                      {editLoading ? (
                        <p className="text-slate-300">Loading profile…</p>
                      ) : (
                        <>
                          <label className="block space-y-1">
                            <span className="text-xs text-slate-300">Full name</span>
                            <input
                              value={editForm.name}
                              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                              className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-slate-100"
                              placeholder="Display name"
                            />
                          </label>
                          <label className="block space-y-1">
                            <span className="text-xs text-slate-300">Username</span>
                            <input
                              value={editForm.username}
                              onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))}
                              className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-slate-100"
                            />
                          </label>
                          <label className="block space-y-1">
                            <span className="text-xs text-slate-300">Email</span>
                            <input
                              type="email"
                              value={editForm.email}
                              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                              className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-slate-100"
                            />
                          </label>
                          <label className="block space-y-1">
                            <span className="text-xs text-slate-300">Department</span>
                            <select
                              value={editForm.department}
                              onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))}
                              className="glass-select w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100"
                            >
                              <option value="" className="bg-slate-100 text-slate-900">— None —</option>
                              {tenantDepartments.map((d) => (
                                <option key={d.id} value={d.name} className="bg-slate-100 text-slate-900">
                                  {d.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p className="text-xs text-slate-400">
                            Role: {activeUser.role} · Status: {activeUser.is_active ? 'Active' : 'Inactive'}
                          </p>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-2 text-sm">
                      <p><span className="text-slate-300">Name:</span> <span className="text-slate-100">{activeUser.name || '-'}</span></p>
                      <p><span className="text-slate-300">Username:</span> <span className="text-slate-100">{activeUser.username}</span></p>
                      <p><span className="text-slate-300">Role:</span> <span className="text-slate-100">{activeUser.role}</span></p>
                      <p><span className="text-slate-300">Department:</span> <span className="text-slate-100">{activeUser.department || '-'}</span></p>
                      <p><span className="text-slate-300">Status:</span> <span className="text-slate-100">{activeUser.is_active ? 'Active' : 'Inactive'}</span></p>
                    </div>
                  )}
                </section>

                {canEditProfiles && editForm && !editLoading && (
                  <section>
                    <p className="text-xs uppercase tracking-wide text-slate-300 mb-2">Leave allocation</p>
                    <div className="rounded-lg border border-white/10 bg-white/5 p-4 grid grid-cols-3 gap-3 text-sm">
                      <label className="block space-y-1">
                        <span className="text-xs text-slate-300">Annual</span>
                        <input
                          type="number"
                          min={0}
                          value={editForm.annual_leaves}
                          onChange={(e) => setEditForm((f) => ({ ...f, annual_leaves: e.target.value }))}
                          className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-2 text-slate-100"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs text-slate-300">Sick</span>
                        <input
                          type="number"
                          min={0}
                          value={editForm.sick_leaves}
                          onChange={(e) => setEditForm((f) => ({ ...f, sick_leaves: e.target.value }))}
                          className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-2 text-slate-100"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs text-slate-300">Casual</span>
                        <input
                          type="number"
                          min={0}
                          value={editForm.casual_leaves}
                          onChange={(e) => setEditForm((f) => ({ ...f, casual_leaves: e.target.value }))}
                          className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-2 text-slate-100"
                        />
                      </label>
                    </div>
                  </section>
                )}

                <section>
                  <p className="text-xs uppercase tracking-wide text-slate-300 mb-2">Activity</p>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                    <p>Last updated: {asLastActive(activeUser)}</p>
                  </div>
                </section>
              </div>

              <div className="mt-auto p-5 border-t border-white/10 flex flex-wrap gap-2">
                {canEditProfiles && editForm && (
                  <button
                    type="button"
                    onClick={saveProfile}
                    disabled={editSaving || editLoading}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-60 transition-all duration-200 active:scale-[0.99]"
                  >
                    {editSaving ? 'Saving…' : 'Save profile'}
                  </button>
                )}
                {canChangeRoles(user) && roleCanBeToggled(activeUser.role) && (
                  <button
                    type="button"
                    onClick={() => changeRole(activeUser)}
                    className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/20 transition-all duration-200 active:scale-[0.99]"
                  >
                    {activeUser.role === 'employee' ? 'Make manager' : 'Make employee'}
                  </button>
                )}
                {(user?.role === 'super_admin' || isHrAdmin(user)) && activeUser.role !== 'super_admin' && (
                  <button onClick={() => toggleActive(activeUser)} className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/20 transition-all duration-200 active:scale-[0.99]">
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
