import { useEffect, useState } from 'react';
import { adminService } from '../services/adminService';

export function AttendancePage() {
  const [rows, setRows] = useState([]);
  useEffect(() => { adminService.getAttendance().then(setRows); }, []);
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Attendance</h1>
      <div className="space-y-2">
        {rows.slice(0, 100).map((r) => (
          <div key={r.id} className="rounded border border-slate-800 p-3">
            {r.username} - {r.type} - {new Date(r.timestamp).toLocaleString()}
          </div>
        ))}
      </div>
    </div>
  );
}
