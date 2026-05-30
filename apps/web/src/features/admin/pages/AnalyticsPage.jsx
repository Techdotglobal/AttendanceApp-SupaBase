import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassCard } from '../../../shared/components/GlassCard';
import { adminService } from '../services/adminService';

function buildDistributionFromUsers(users, departments) {
  const deptByKey = new Map();
  for (const d of departments || []) {
    const name = d.name || d.id;
    deptByKey.set(String(name).toLowerCase().replace(/\s+/g, ' '), {
      id: d.id,
      name,
      employeeCount: 0,
      activeCount: 0,
    });
  }

  let unassigned = 0;
  for (const user of users || []) {
    const deptName = user.department?.trim();
    if (!deptName) {
      unassigned += 1;
      continue;
    }
    const key = deptName.toLowerCase().replace(/\s+/g, ' ');
    if (!deptByKey.has(key)) {
      deptByKey.set(key, { id: key, name: deptName, employeeCount: 0, activeCount: 0 });
    }
    const bucket = deptByKey.get(key);
    bucket.employeeCount += 1;
    if (user.is_active) bucket.activeCount += 1;
  }

  const rows = Array.from(deptByKey.values()).filter((d) => d.employeeCount > 0);
  rows.sort((a, b) => b.employeeCount - a.employeeCount);
  if (unassigned > 0) {
    rows.push({ id: 'unassigned', name: 'Unassigned', employeeCount: unassigned, activeCount: unassigned });
  }
  return rows;
}

function filterAttendanceLast7Days(attendance) {
  const start = new Date();
  start.setDate(start.getDate() - 7);
  start.setHours(0, 0, 0, 0);
  return (attendance || []).filter((row) => {
    const raw = row.timestamp || row.created_at || row.check_in_at;
    if (!raw) return false;
    return new Date(raw) >= start;
  });
}

export function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [distribution, setDistribution] = useState([]);
  const [insights, setInsights] = useState(null);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const analytics = await adminService.getAnalytics();
      if (analytics) {
        setDistribution(analytics.departmentDistribution || []);
        setInsights(analytics.insights || null);
        return;
      }

      const [usersData, attendanceData, deptOverview] = await Promise.all([
        adminService.getUsers(),
        adminService.getAttendance(),
        adminService.getDepartmentsOverview(),
      ]);
      const users = usersData || [];
      const last7 = filterAttendanceLast7Days(attendanceData);
      const activeUsers = users.filter((u) => u.is_active).length;
      const deptRows = buildDistributionFromUsers(users, deptOverview);

      if (deptRows.length === 0 && (deptOverview || []).length > 0) {
        const maxFromOverview = Math.max(...deptOverview.map((d) => d.employeeCount || 0), 0);
        if (maxFromOverview > 0) {
          setDistribution(
            deptOverview
              .filter((d) => (d.employeeCount || 0) > 0)
              .map((d) => ({
                id: d.id,
                name: d.name,
                employeeCount: d.employeeCount || 0,
                activeCount: d.employeeCount || 0,
              }))
          );
        } else {
          setDistribution(deptRows);
        }
      } else {
        setDistribution(deptRows);
      }

      setInsights({
        totalUsers: users.length,
        activeUsers,
        attendanceLast7Days: last7.length,
        avgAttendancePerActiveUser7d: activeUsers ? Math.round((last7.length / activeUsers) * 100) / 100 : 0,
        trackedDepartments: (deptOverview || []).length,
        unassignedUsers: deptRows.find((d) => d.id === 'unassigned')?.employeeCount || 0,
      });
    } catch (err) {
      setError(err?.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const departmentBars = useMemo(() => {
    if (!distribution.length) return [];
    const max = Math.max(...distribution.map((d) => d.employeeCount || 0), 1);
    return distribution.map((d) => ({
      label: d.name,
      value: d.employeeCount || 0,
      active: d.activeCount ?? d.employeeCount ?? 0,
      percent: Math.max(((d.employeeCount || 0) / max) * 100, (d.employeeCount || 0) > 0 ? 14 : 0),
    }));
  }, [distribution]);

  const insightRows = insights
    ? [
        { label: 'Total users', value: insights.totalUsers },
        { label: 'Total active users', value: insights.activeUsers },
        { label: 'Attendance records in last 7 days', value: insights.attendanceLast7Days },
        {
          label: 'Avg attendance events per active user (7d)',
          value: Number(insights.avgAttendancePerActiveUser7d ?? 0).toFixed(2),
        },
        { label: 'Tracked departments', value: insights.trackedDepartments },
        ...(insights.unassignedUsers > 0
          ? [{ label: 'Users without department', value: insights.unassignedUsers }]
          : []),
      ]
    : [];

  return (
    <div className="space-y-6 animate-fade-up">
      <section className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Analytics</h1>
          <p className="mt-1 text-sm text-slate-200">Department headcount and attendance activity for your company.</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-slate-100 hover:bg-white/20 transition-all duration-200 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </section>

      {error && (
        <GlassCard className="p-4">
          <p className="text-sm text-red-100">{error}</p>
        </GlassCard>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <GlassCard className="p-5">
          <h2 className="text-sm font-medium text-white mb-1">Department Size Distribution</h2>
          <p className="text-xs text-slate-400 mb-4">Headcount per department (all users assigned to each dept)</p>
          <div className="h-56 flex items-end gap-3 px-1">
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end gap-2">
                  <div className="w-full h-32 rounded-t-md skeleton" />
                  <div className="h-3 w-12 rounded skeleton" />
                </div>
              ))}
            {!loading && departmentBars.length === 0 && (
              <div className="w-full h-full grid place-items-center text-sm text-slate-300 text-center px-4">
                No department data yet. Assign users to departments on the Users page.
              </div>
            )}
            {!loading &&
              departmentBars.map((bar) => (
                <div key={bar.label} className="flex-1 flex flex-col items-center justify-end gap-2 min-w-0">
                  <span className="text-[11px] font-medium text-blue-100">{bar.value}</span>
                  <div
                    className="w-full max-w-[72px] rounded-t-md bg-gradient-to-t from-blue-600/80 to-blue-400/60 border border-blue-300/30 transition-all duration-500"
                    style={{ height: `${bar.percent}%`, minHeight: bar.value > 0 ? '1.5rem' : 0 }}
                    title={`${bar.label}: ${bar.value} users (${bar.active} active)`}
                  />
                  <span className="text-[10px] text-slate-300 text-center truncate w-full" title={bar.label}>
                    {bar.label}
                  </span>
                </div>
              ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-sm font-medium text-white mb-4">Insights</h2>
          {loading && (
            <ul className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="h-4 rounded skeleton w-3/4" />
              ))}
            </ul>
          )}
          {!loading && insightRows.length > 0 && (
            <ul className="space-y-3 text-sm text-slate-200">
              {insightRows.map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-4 border-b border-white/5 pb-2 last:border-0">
                  <span className="text-slate-300">{row.label}</span>
                  <span className="font-semibold text-white tabular-nums">{row.value}</span>
                </li>
              ))}
            </ul>
          )}
          {!loading && !insightRows.length && (
            <p className="text-sm text-slate-300">No insights available.</p>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
