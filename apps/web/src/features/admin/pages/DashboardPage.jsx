import { useEffect, useState } from 'react';
import { adminService } from '../services/adminService';

export function DashboardPage() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    adminService.getStats().then(setStats).catch(() => setStats(null));
  }, []);
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Dashboard</h1>
      <div className="grid md:grid-cols-4 gap-4">
        {[
          ['Total Employees', stats?.totalEmployees ?? '-'],
          ['Total Departments', stats?.totalDepartments ?? '-'],
          ['Active Users', stats?.activeUsers ?? '-'],
          ['Pending Leaves', stats?.pendingLeaves ?? '-'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-900 border border-slate-800 p-4">
            <p className="text-slate-400 text-sm">{label}</p>
            <p className="text-2xl font-semibold mt-2">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
