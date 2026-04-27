import { useEffect, useState } from 'react';
import { adminService } from '../services/adminService';

export function LeavesPage() {
  const [rows, setRows] = useState([]);
  const load = () => adminService.getLeaves().then(setRows);
  useEffect(() => { load(); }, []);
  const processLeave = async (id, status) => {
    await adminService.processLeave(id, { status });
    load();
  };
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Leaves</h1>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded border border-slate-800 p-3 flex justify-between">
            <span>{r.employee_id} - {r.leave_type} - {r.status}</span>
            {r.status === 'pending' && (
              <div className="space-x-2">
                <button className="rounded bg-green-700 px-2 py-1" onClick={() => processLeave(r.id, 'approved')}>Approve</button>
                <button className="rounded bg-red-700 px-2 py-1" onClick={() => processLeave(r.id, 'rejected')}>Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
