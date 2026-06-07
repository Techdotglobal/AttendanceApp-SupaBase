import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { adminService } from '../services/adminService';
import { useAuthStore } from '../../auth/store/authStore';
import { GlassCard } from '../../../shared/components/GlassCard';
import { PermissionGate } from '../../../shared/components/PermissionGate';
import { hasPermission, PERMISSIONS } from '../permissions';

export function DepartmentsPage() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const createInputRef = useRef(null);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [expandedIds, setExpandedIds] = useState({});
  const [renameState, setRenameState] = useState({ id: null, value: '' });
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const departmentRows = await adminService.getDepartmentsOverview();
      setRows(departmentRows || []);
    } catch (err) {
      console.error('[DepartmentsPage] Failed to load departments:', err);
      setError(err?.message || 'Failed to load departments');
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (location.state?.focusCreate) {
      createInputRef.current?.focus();
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const canManageDepartments = hasPermission(user, PERMISSIONS.MANAGE_DEPARTMENTS);
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((d) => d.name.toLowerCase().includes(q));
  }, [rows, search]);

  const toggleExpand = (id) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const onCreateDepartment = async () => {
    if (!name.trim()) return;
    setError('');
    try {
      await adminService.createDepartment({ name });
      setName('');
      await load();
    } catch (err) {
      console.error('[DepartmentsPage] Failed to create department:', err);
      setError(err?.message || 'Failed to create department');
    }
  };

  const onRenameDepartment = async (id) => {
    const newName = renameState.value.trim();
    if (!newName) return;
    setError('');
    try {
      await adminService.renameDepartment(id, { name: newName });
      setRenameState({ id: null, value: '' });
      await load();
    } catch (err) {
      console.error('[DepartmentsPage] Failed to rename department:', err);
      setError(err?.message || 'Failed to rename department');
    }
  };

  const onDeleteDepartment = async (id) => {
    setError('');
    try {
      await adminService.deleteDepartment(id);
      await load();
    } catch (err) {
      console.error('[DepartmentsPage] Failed to delete department:', err);
      setError(err?.message || 'Failed to delete department');
    }
  };

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <h1 className="text-2xl font-semibold text-white">Departments</h1>
        <p className="mt-1 text-sm text-slate-200">View department structure, managers, and member lists.</p>
      </div>

      <div className="mb-4 flex flex-col md:flex-row gap-2">
        <input
          className="rounded-lg border border-white/20 bg-white/10 p-2.5 md:w-72 text-sm text-slate-100 placeholder:text-slate-300"
          placeholder="Search departments"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canManageDepartments && (
          <>
            <input
              ref={createInputRef}
              className="rounded-lg border border-white/20 bg-white/10 p-2.5 md:w-72 text-sm text-slate-100 placeholder:text-slate-300"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New department"
            />
            <PermissionGate permission={PERMISSIONS.MANAGE_DEPARTMENTS}>
              <button className="rounded-lg bg-blue-600 text-white px-3 py-2 text-sm hover:bg-blue-700 transition-all duration-200 active:scale-[0.99]" onClick={onCreateDepartment}>
                Create
              </button>
            </PermissionGate>
          </>
        )}
      </div>
      {error && <GlassCard className="p-4 text-sm text-red-100">{error}</GlassCard>}

      <div className="space-y-3">
        {filteredRows.map((d) => (
          <GlassCard key={d.id} className="overflow-hidden">
            <button
              className="w-full p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-left"
              onClick={() => toggleExpand(d.id)}
            >
              <div>
                <p className="font-semibold text-white">{d.name}</p>
                <p className="text-sm text-slate-300">
                  {d.employeeCount} active employee{d.employeeCount === 1 ? '' : 's'}
                </p>
              </div>
              <div className="text-sm text-slate-200">
                Manager: {d.manager?.name || d.manager?.username || 'Not assigned'}
              </div>
            </button>

            {expandedIds[d.id] && (
              <div className="border-t border-white/10 p-4 space-y-3">
                {canManageDepartments && (
                  <PermissionGate permission={PERMISSIONS.MANAGE_DEPARTMENTS}>
                  <div className="flex flex-col md:flex-row gap-2">
                    <input
                      className="rounded-lg border border-white/20 bg-white/10 p-2.5 md:w-72 text-sm text-slate-100 placeholder:text-slate-300"
                      placeholder="Rename department"
                      value={renameState.id === d.id ? renameState.value : ''}
                      onChange={(e) => setRenameState({ id: d.id, value: e.target.value })}
                    />
                    <button className="rounded-lg bg-blue-600 text-white px-3 py-2 text-sm hover:bg-blue-700 transition-all duration-200 active:scale-[0.99]" onClick={() => onRenameDepartment(d.id)}>
                      Rename
                    </button>
                    <button className="rounded-lg border border-red-200/40 bg-red-500/15 text-red-100 px-3 py-2 text-sm hover:bg-red-500/25 transition-all duration-200 active:scale-[0.99]" onClick={() => onDeleteDepartment(d.id)}>
                      Delete
                    </button>
                  </div>
                  </PermissionGate>
                )}

                <div className="space-y-2">
                  {d.employees.length === 0 && <p className="text-sm text-slate-300">No employees in this department.</p>}
                  {d.employees.map((emp) => (
                    <div key={emp.uid} className="rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-1">
                      <div>
                        <p className="font-medium text-white">{emp.name || emp.username}</p>
                        <p className="text-xs text-slate-300">{emp.username}</p>
                      </div>
                      <div className="text-sm text-slate-200">
                        {emp.role} {emp.position ? `- ${emp.position}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
