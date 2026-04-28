import { useEffect, useMemo, useState } from 'react';
import { GlassCard } from '../../../shared/components/GlassCard';
import { adminService } from '../services/adminService';

export function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [departments, setDepartments] = useState([]);

  useEffect(() => {
    const load = async () => {
      setError('');
      setLoading(true);
      try {
        const [usersData, attendanceData, deptOverview] = await Promise.all([
          adminService.getUsers(),
          adminService.getAttendance(),
          adminService.getDepartmentsOverview(),
        ]);
        setUsers(usersData || []);
        setAttendance(attendanceData || []);
        setDepartments(deptOverview || []);
      } catch (err) {
        setError(err?.response?.data?.error || err?.message || 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const departmentBars = useMemo(() => {
    if (!departments.length) return [];
    const max = Math.max(...departments.map((d) => d.employeeCount || 0), 1);
    return departments
      .slice()
      .sort((a, b) => (b.employeeCount || 0) - (a.employeeCount || 0))
      .slice(0, 8)
      .map((d) => ({
        label: d.name,
        value: d.employeeCount || 0,
        percent: ((d.employeeCount || 0) / max) * 100,
      }));
  }, [departments]);

  const last7DaysAttendance = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    return attendance.filter((row) => row.timestamp && new Date(row.timestamp) >= start);
  }, [attendance]);

  const activeUsers = useMemo(() => users.filter((u) => u.is_active).length, [users]);
  const attendancePerActiveUser = activeUsers ? (last7DaysAttendance.length / activeUsers).toFixed(2) : '0.00';

  return (
    <div className="space-y-6 animate-fade-up">
      <h1 className="text-2xl font-semibold text-white">Analytics</h1>
      {error && (
        <GlassCard className="p-4">
          <p className="text-sm text-red-100">{error}</p>
        </GlassCard>
      )}
      <div className="grid lg:grid-cols-2 gap-6">
        <GlassCard className="p-5">
          <h2 className="text-sm font-medium text-white mb-4">Department Size Distribution</h2>
          <div className="h-56 flex items-end gap-2">
            {loading &&
              Array.from({ length: 6 }).map((_, i) => <div key={i} className="flex-1 rounded-t-md skeleton" />)}
            {!loading && departmentBars.length === 0 && (
              <div className="w-full h-full grid place-items-center text-sm text-slate-300">No department analytics available.</div>
            )}
            {!loading &&
              departmentBars.map((bar) => (
                <div key={bar.label} className="flex-1 flex flex-col items-center justify-end gap-2">
                  <div className="w-full rounded-t-md bg-blue-400/50" style={{ height: `${bar.percent}%` }} />
                  <span className="text-[10px] text-slate-300 text-center">{bar.label}</span>
                </div>
              ))}
          </div>
        </GlassCard>
        <GlassCard className="p-5">
          <h2 className="text-sm font-medium text-white mb-4">Insights</h2>
          <ul className="space-y-3 text-sm text-slate-200">
            <li>Total active users: {activeUsers}</li>
            <li>Attendance records in last 7 days: {last7DaysAttendance.length}</li>
            <li>Avg attendance events per active user (7d): {attendancePerActiveUser}</li>
            <li>Tracked departments: {departments.length}</li>
          </ul>
        </GlassCard>
      </div>
    </div>
  );
}
