import { useEffect, useState } from 'react';
import { adminService } from '../services/adminService';
import { GlassCard } from '../../../shared/components/GlassCard';

const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatRelativeTime = (isoValue) => {
  if (!isoValue) return 'Unknown time';
  const deltaMs = Date.now() - new Date(isoValue).getTime();
  if (Number.isNaN(deltaMs) || deltaMs < 0) return 'Just now';
  const mins = Math.floor(deltaMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

function SkeletonCard() {
  return <div className="h-28 rounded-2xl border border-white/15 bg-white/10 skeleton" />;
}

function KPI({ label, value, trend, icon }) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-200">{label}</p>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-400/20 text-blue-100 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]">{icon}</span>
      </div>
      <p className="mt-4 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-xs text-slate-300">{trend}</p>
    </GlassCard>
  );
}

export function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [growthSeries, setGrowthSeries] = useState([]);
  const [activityItems, setActivityItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = async () => {
    setError('');
    setLoading(true);
    try {
      const [statsData, users, attendance, leaves] = await Promise.all([
        adminService.getStats(),
        adminService.getUsers(),
        adminService.getAttendance(),
        adminService.getLeaves(),
      ]);

      setStats(statsData);

      const monthBuckets = new Map();
      for (let i = 0; i < 12; i += 1) {
        const date = new Date();
        date.setMonth(date.getMonth() - (11 - i));
        const key = `${date.getFullYear()}-${date.getMonth()}`;
        monthBuckets.set(key, 0);
      }

      for (const user of users || []) {
        if (!user?.created_at) continue;
        const created = new Date(user.created_at);
        const key = `${created.getFullYear()}-${created.getMonth()}`;
        if (monthBuckets.has(key)) {
          monthBuckets.set(key, monthBuckets.get(key) + 1);
        }
      }
      setGrowthSeries(
        Array.from(monthBuckets.entries()).map(([key, value]) => {
          const [year, month] = key.split('-').map(Number);
          return { label: `${monthLabels[month]} ${String(year).slice(-2)}`, value };
        })
      );

      const activity = [];
      for (const leave of leaves || []) {
        const ts = leave.processed_at || leave.requested_at;
        if (!ts) continue;
        activity.push({
          ts,
          title: `Leave ${leave.status || 'update'} for ${leave.employee_id || 'employee'}`,
        });
      }
      for (const row of attendance || []) {
        if (!row.timestamp) continue;
        activity.push({
          ts: row.timestamp,
          title: `Attendance ${row.type || 'record'}: ${row.username || 'user'}`,
        });
      }
      for (const userRow of users || []) {
        const ts = userRow.updated_at || userRow.created_at;
        if (!ts) continue;
        activity.push({
          ts,
          title: `User ${userRow.name || userRow.username || 'account'} updated`,
        });
      }

      const recent = activity
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
        .slice(0, 6)
        .map((item) => ({ ...item, time: formatRelativeTime(item.ts) }));
      setActivityItems(recent);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
    const timer = setInterval(loadDashboard, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxGrowth = Math.max(...growthSeries.map((p) => p.value), 1);
  const growthPoints = growthSeries.length
    ? growthSeries.map((point, index) => {
        const x = index * (550 / Math.max(growthSeries.length - 1, 1)) + 24;
        const y = 220 - (point.value / maxGrowth) * 180;
        return `${x},${y}`;
      })
    : [];

  const growthRate = growthSeries.length > 1
    ? (((growthSeries[growthSeries.length - 1].value - growthSeries[growthSeries.length - 2].value) / Math.max(growthSeries[growthSeries.length - 2].value, 1)) * 100)
    : 0;

  const unresolvedActions = stats?.pendingLeaves ?? 0;

  return (
    <div className="space-y-6 animate-fade-up">
      <section className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-200">A quick snapshot of users, departments, and pending admin actions.</p>
        </div>
        <button
          type="button"
          onClick={loadDashboard}
          className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-slate-100 hover:bg-white/20 transition-all duration-200"
        >
          Refresh
        </button>
      </section>

      {error && (
        <GlassCard className="p-4">
          <p className="text-sm text-red-100">{error}</p>
        </GlassCard>
      )}

      <section className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <KPI
              label="Total Users"
              value={stats?.totalEmployees ?? 0}
              trend={`${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(1)}% vs last month`}
              icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
            />
            <KPI
              label="Active Users Today"
              value={stats?.activeUsers ?? 0}
              trend={`${stats?.activeUsers ?? 0} currently active`}
              icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12a9 9 0 1 1-9-9" /><path d="M21 3v9h-9" /></svg>}
            />
            <KPI
              label="Departments"
              value={stats?.totalDepartments ?? 0}
              trend="Synced with central department table"
              icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /></svg>}
            />
            <KPI
              label="Pending Actions"
              value={unresolvedActions}
              trend={`${unresolvedActions} leave request${unresolvedActions === 1 ? '' : 's'} awaiting review`}
              icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 6v6l3 3" /><circle cx="12" cy="12" r="9" /></svg>}
            />
          </>
        )}
      </section>

      <section className="grid xl:grid-cols-5 gap-6">
        <GlassCard className="xl:col-span-3 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-white">User Growth</h2>
              <p className="text-xs text-slate-300 mt-1">Monthly trend of active platform users</p>
            </div>
            <span className="text-xs text-slate-300">{growthSeries.length ? `${growthSeries.length} months` : 'No timeline data'}</span>
          </div>

          <div className="mt-5 h-64 rounded-lg border border-white/10 bg-slate-950/30 p-3">
            {loading ? (
              <div className="h-full w-full rounded-md skeleton" />
            ) : growthSeries.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-slate-300">No user growth data available.</div>
            ) : (
              <svg viewBox="0 0 600 240" className="h-full w-full">
                <polyline
                  fill="none"
                  stroke="#2563EB"
                  strokeWidth="3"
                  points={growthPoints.join(' ')}
                />
                {growthPoints.map((point, index) => {
                  const [cx, cy] = point.split(',');
                  return <circle key={index} cx={cx} cy={cy} r="4" fill="#3B82F6" />;
                })}
              </svg>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-slate-300">Growth Rate <span className="ml-1 font-semibold text-white">{`${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(1)}%`}</span></div>
            <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-slate-300">Active Users <span className="ml-1 font-semibold text-white">{stats?.activeUsers ?? 0}</span></div>
            <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-slate-300">Latest Month <span className="ml-1 font-semibold text-white">{growthSeries[growthSeries.length - 1]?.label || 'N/A'}</span></div>
          </div>
        </GlassCard>

        <div className="xl:col-span-2 space-y-6">
          <GlassCard className="p-5">
            <h2 className="text-sm font-medium text-white">Recent Activity</h2>
            <div className="mt-4 space-y-3">
              {loading && (
                <>
                  <div className="h-14 rounded-lg skeleton" />
                  <div className="h-14 rounded-lg skeleton" />
                  <div className="h-14 rounded-lg skeleton" />
                </>
              )}
              {!loading && activityItems.length === 0 && <p className="text-sm text-slate-300">No recent activity found.</p>}
              {!loading &&
                activityItems.map((item) => (
                  <div key={`${item.title}-${item.ts}`} className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <p className="text-sm text-slate-100">{item.title}</p>
                    <p className="text-xs text-slate-300 mt-1">{item.time}</p>
                  </div>
                ))}
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <h2 className="text-sm font-medium text-white">Quick Actions</h2>
            <div className="mt-4 grid grid-cols-1 gap-2">
              <button className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/20 transition-all duration-200 active:scale-[0.99]">Add User</button>
              <button className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/20 transition-all duration-200 active:scale-[0.99]">Export Data</button>
              <button className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/20 transition-all duration-200 active:scale-[0.99]">Create Department</button>
            </div>
          </GlassCard>
        </div>
      </section>
    </div>
  );
}
