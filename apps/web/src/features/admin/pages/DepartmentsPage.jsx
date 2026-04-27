import { useEffect, useMemo, useState } from 'react';
import { adminService } from '../services/adminService';
import { useAuthStore } from '../../auth/store/authStore';

export function DepartmentsPage() {
  const { user } = useAuthStore();
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [expandedIds, setExpandedIds] = useState({});
  const [renameState, setRenameState] = useState({ id: null, value: '' });

  const load = () => adminService.getDepartmentsOverview().then(setRows);

  useEffect(() => {
    load();
  }, []);

  const isSuperAdmin = user?.role === 'super_admin';
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
    await adminService.createDepartment({ name });
    setName('');
    await load();
  };

  const onRenameDepartment = async (id) => {
    const newName = renameState.value.trim();
    if (!newName) return;
    await adminService.renameDepartment(id, { name: newName });
    setRenameState({ id: null, value: '' });
    await load();
  };

  const onDeleteDepartment = async (id) => {
    await adminService.deleteDepartment(id);
    await load();
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Departments</h1>

      <div className="mb-4 flex flex-col md:flex-row gap-2">
        <input
          className="rounded bg-slate-800 p-2 md:w-72"
          placeholder="Search departments"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isSuperAdmin && (
          <>
            <input
              className="rounded bg-slate-800 p-2 md:w-72"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New department"
            />
            <button className="rounded bg-indigo-600 px-3 py-2" onClick={onCreateDepartment}>
              Create
            </button>
          </>
        )}
      </div>

      <div className="space-y-3">
        {filteredRows.map((d) => (
          <div key={d.id} className="rounded border border-slate-800 bg-slate-900">
            <button
              className="w-full p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-left"
              onClick={() => toggleExpand(d.id)}
            >
              <div>
                <p className="font-semibold">{d.name}</p>
                <p className="text-sm text-slate-400">
                  {d.employeeCount} active employee{d.employeeCount === 1 ? '' : 's'}
                </p>
              </div>
              <div className="text-sm text-slate-300">
                Manager: {d.manager?.name || d.manager?.username || 'Not assigned'}
              </div>
            </button>

            {expandedIds[d.id] && (
              <div className="border-t border-slate-800 p-4 space-y-3">
                {isSuperAdmin && (
                  <div className="flex flex-col md:flex-row gap-2">
                    <input
                      className="rounded bg-slate-800 p-2 md:w-72"
                      placeholder="Rename department"
                      value={renameState.id === d.id ? renameState.value : ''}
                      onChange={(e) => setRenameState({ id: d.id, value: e.target.value })}
                    />
                    <button className="rounded bg-indigo-700 px-3 py-2" onClick={() => onRenameDepartment(d.id)}>
                      Rename
                    </button>
                    <button className="rounded bg-red-700 px-3 py-2" onClick={() => onDeleteDepartment(d.id)}>
                      Delete
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  {d.employees.length === 0 && <p className="text-sm text-slate-400">No employees in this department.</p>}
                  {d.employees.map((emp) => (
                    <div key={emp.uid} className="rounded border border-slate-800 p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-1">
                      <div>
                        <p className="font-medium">{emp.name || emp.username}</p>
                        <p className="text-xs text-slate-400">{emp.username}</p>
                      </div>
                      <div className="text-sm text-slate-300">
                        {emp.role} {emp.position ? `- ${emp.position}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
