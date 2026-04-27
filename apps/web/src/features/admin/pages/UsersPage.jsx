import { useEffect, useState } from 'react';
import { adminService } from '../services/adminService';
import { useAuthStore } from '../../auth/store/authStore';

export function UsersPage() {
  const { user } = useAuthStore();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    adminService.getUsers().then(setRows);
  }, []);
  const toggleActive = async (u) => {
    await adminService.updateUser(u.uid, { is_active: !u.is_active });
    setRows((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, is_active: !x.is_active } : x)));
  };
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Users</h1>
      <div className="overflow-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900"><tr><th className="p-3 text-left">Name</th><th>Role</th><th>Department</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.uid} className="border-t border-slate-800">
                <td className="p-3">{u.name || u.username}</td>
                <td>{u.role}</td>
                <td>{u.department}</td>
                <td>{u.is_active ? 'active' : 'inactive'}</td>
                <td className="p-2">
                  <button onClick={() => toggleActive(u)} className="rounded bg-slate-800 px-2 py-1">
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  {user?.role === 'super_admin' && (
                    <button onClick={() => adminService.updateUser(u.uid, { role: u.role === 'employee' ? 'manager' : 'employee' })} className="ml-2 rounded bg-indigo-700 px-2 py-1">
                      Toggle Role
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
