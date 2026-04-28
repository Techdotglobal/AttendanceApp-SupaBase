import { useEffect, useMemo, useState } from 'react';
import { adminService } from '../services/adminService';
import { useAuthStore } from '../../auth/store/authStore';
import { GlassCard } from '../../../shared/components/GlassCard';
import { GlassTable } from '../../../shared/components/GlassTable';
import { SlideOverPanel } from '../../../shared/components/SlideOverPanel';

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

export function UsersPage() {
  const { user } = useAuthStore();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState({});
  const [roleFilter, setRoleFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeUser, setActiveUser] = useState(null);

  useEffect(() => {
    adminService
      .getUsers()
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  const toggleActive = async (u) => {
    await adminService.updateUser(u.uid, { is_active: !u.is_active });
    setRows((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, is_active: !x.is_active, updated_at: new Date().toISOString() } : x)));
  };

  const changeRole = async (u) => {
    const nextRole = u.role === 'employee' ? 'manager' : 'employee';
    await adminService.updateUser(u.uid, { role: nextRole });
    setRows((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, role: nextRole } : x)));
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
    for (const row of target) {
      // sequential for simplicity and easier server protection
      // eslint-disable-next-line no-await-in-loop
      await adminService.updateUser(row.uid, { is_active: false });
    }
    setRows((prev) => prev.map((row) => (selected[row.uid] ? { ...row, is_active: false } : row)));
    setSelected({});
  };

  const closePanel = () => setActiveUser(null);

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
      <div>
        <h1 className="text-2xl font-semibold text-white">User Management</h1>
        <p className="mt-1 text-sm text-slate-200">Manage users, roles, and department assignments.</p>
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
                    <button type="button" className="flex items-center gap-3" onClick={() => setActiveUser(u)}>
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
                      <button onClick={() => setActiveUser(u)} className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 hover:bg-white/20">Edit</button>
                      <button onClick={() => toggleActive(u)} className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 hover:bg-white/20">
                        {u.is_active ? 'Disable' : 'Enable'}
                      </button>
                      {user?.role === 'super_admin' && (
                        <button onClick={() => changeRole(u)} className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-slate-100 hover:bg-white/20">
                          Change Role
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
      </GlassTable>

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
                <section>
                  <p className="text-xs uppercase tracking-wide text-slate-300 mb-2">Profile</p>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-2 text-sm">
                    <p><span className="text-slate-300">Username:</span> <span className="text-slate-100">{activeUser.username}</span></p>
                    <p><span className="text-slate-300">Role:</span> <span className="text-slate-100">{activeUser.role}</span></p>
                    <p><span className="text-slate-300">Department:</span> <span className="text-slate-100">{activeUser.department || '-'}</span></p>
                    <p><span className="text-slate-300">Status:</span> <span className="text-slate-100">{activeUser.is_active ? 'Active' : 'Inactive'}</span></p>
                  </div>
                </section>

                <section>
                  <p className="text-xs uppercase tracking-wide text-slate-300 mb-2">Activity Summary</p>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-slate-200 space-y-2">
                    <p>Last active: {asLastActive(activeUser)}</p>
                    <p>Recent updates managed by admin workflow.</p>
                  </div>
                </section>
              </div>

              <div className="mt-auto p-5 border-t border-white/10 flex flex-wrap gap-2">
                {user?.role === 'super_admin' && (
                  <button onClick={() => changeRole(activeUser)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 transition-all duration-200 active:scale-[0.99]">
                    Promote / Change Role
                  </button>
                )}
                <button onClick={() => toggleActive(activeUser)} className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/20 transition-all duration-200 active:scale-[0.99]">
                  {activeUser.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/20 transition-all duration-200 active:scale-[0.99]">
                  Edit Profile
                </button>
              </div>
            </div>
          )}
      </SlideOverPanel>
    </div>
  );
}
