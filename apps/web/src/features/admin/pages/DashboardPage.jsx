import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminService } from '../services/adminService';
import { GlassCard } from '../../../shared/components/GlassCard';
import { useAuthStore } from '../../auth/store/authStore';
import { hasAnyPermission, hasPermission, PERMISSIONS } from '../permissions';
import { formatLeaveActivityTitle } from '../utils/leaveDisplay';

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

function KPI({ label, value, trend, icon, onClick, hint }) {
  const CardTag = onClick ? 'button' : 'div';
  return (
    <GlassCard
      hover={!onClick}
      className={`p-4 text-left w-full ${onClick ? 'cursor-pointer hover:bg-white/15 transition-all duration-200 active:scale-[0.99]' : ''}`}
    >
      <CardTag type={onClick ? 'button' : undefined} onClick={onClick} className="w-full text-left">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-200">{label}</p>
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-400/20 text-blue-100 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]">
            {icon}
          </span>
        </div>
        <p className="mt-4 text-3xl font-semibold text-white">{value}</p>
        <p className="mt-2 text-xs text-slate-300">{trend}</p>
        {onClick && hint && <p className="mt-2 text-[10px] text-blue-200/90">{hint}</p>}
      </CardTag>
    </GlassCard>
  );
}

const downloadUsersCsv = (users) => {
  const header = ['username', 'name', 'email', 'role', 'department', 'is_active'];
  const lines = [header.join(',')];
  for (const u of users || []) {
    const row = [
      u.username,
      u.name,
      u.email,
      u.role,
      u.department,
      u.is_active ? 'active' : 'inactive',
    ].map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`);
    lines.push(row.join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [stats, setStats] = useState(null);
  const [cachedUsers, setCachedUsers] = useState([]);
  const [growthSeries, setGrowthSeries] = useState([]);
  const [activityItems, setActivityItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = async () => {
    setError('');
    setLoading(true);
    try {
      const canViewUsers = hasAnyPermission(user, [
        PERMISSIONS.VIEW_EMPLOYEES,
        PERMISSIONS.CREATE_USER,
        PERMISSIONS.EDIT_USER,
        PERMISSIONS.DELETE_USER,
      ]);
      const canViewAttendance = hasAnyPermission(user, [
        PERMISSIONS.VIEW_ATTENDANCE,
        PERMISSIONS.MANUAL_ATTENDANCE,
      ]);
      const canViewLeaves = hasAnyPermission(user, [
        PERMISSIONS.VIEW_LEAVE_REQUESTS,
        PERMISSIONS.APPROVE_LEAVE,
        PERMISSIONS.REJECT_LEAVE,
      ]);
      const canViewStats = hasPermission(user, PERMISSIONS.VIEW_HR_DASHBOARD);

      const [statsData, users, attendance, leaves] = await Promise.all([
        canViewStats ? adminService.getStats() : Promise.resolve(null),
        canViewUsers ? adminService.getUsers() : Promise.resolve([]),
        canViewAttendance ? adminService.getAttendance() : Promise.resolve([]),
        canViewLeaves ? adminService.getLeaves() : Promise.resolve([]),
      ]);

      setStats(statsData || {
        totalEmployees: users?.length || 0,
        activeUsers: (users || []).filter((u) => u.is_active).length,
        totalDepartments: 0,
        pendingLeaves: (leaves || []).filter((leave) => leave.status === 'pending').length,
        attendanceRecords: attendance?.length || 0,
      });
      setCachedUsers(users || []);

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
          title: formatLeaveActivityTitle(leave),
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
  }, [user]);

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
  const canViewUsers = hasAnyPermission(user, [
    PERMISSIONS.VIEW_EMPLOYEES,
    PERMISSIONS.CREATE_USER,
    PERMISSIONS.EDIT_USER,
    PERMISSIONS.DELETE_USER,
  ]);
  const canCreateUsers = hasPermission(user, PERMISSIONS.CREATE_USER);
  const canExportReports = hasPermission(user, PERMISSIONS.EXPORT_REPORTS);
  const canManageDepartments = hasPermission(user, PERMISSIONS.MANAGE_DEPARTMENTS);
  const canViewAttendance = hasAnyPermission(user, [PERMISSIONS.VIEW_ATTENDANCE, PERMISSIONS.MANUAL_ATTENDANCE]);
  const canViewLeaves = hasAnyPermission(user, [
    PERMISSIONS.VIEW_LEAVE_REQUESTS,
    PERMISSIONS.APPROVE_LEAVE,
    PERMISSIONS.REJECT_LEAVE,
  ]);
  const canViewAnalytics = hasPermission(user, PERMISSIONS.VIEW_ANALYTICS);
  const canManageTickets = hasAnyPermission(user, [
    PERMISSIONS.VIEW_TICKETS,
    PERMISSIONS.MANAGE_TICKETS,
    PERMISSIONS.ASSIGN_TICKETS,
    PERMISSIONS.CLOSE_TICKETS,
  ]);
  const canManageGeofencing = hasPermission(user, PERMISSIONS.MANAGE_GEOFENCING);
  const canManageNotifications = hasPermission(user, PERMISSIONS.MANAGE_NOTIFICATIONS);
  const canViewActivity = hasAnyPermission(user, [
    PERMISSIONS.VIEW_HR_DASHBOARD,
    PERMISSIONS.VIEW_EMPLOYEES,
    PERMISSIONS.CREATE_USER,
    PERMISSIONS.EDIT_USER,
    PERMISSIONS.VIEW_LEAVE_REQUESTS,
    PERMISSIONS.APPROVE_LEAVE,
    PERMISSIONS.VIEW_ATTENDANCE,
    PERMISSIONS.MANUAL_ATTENDANCE,
  ]);
  const canUseCalendar = hasAnyPermission(user, [
    PERMISSIONS.CREATE_EVENTS,
    PERMISSIONS.EDIT_EVENTS,
    PERMISSIONS.DELETE_EVENTS,
  ]);

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
            {canViewUsers && (
            <KPI
              label="Total Users"
              value={stats?.totalEmployees ?? 0}
              trend={`${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(1)}% vs last month`}
              hint="View all users →"
              onClick={() => navigate('/users')}
              icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
            />
            )}
            {canViewUsers && (
            <KPI
              label="Active Users Today"
              value={stats?.activeUsers ?? 0}
              trend={`${stats?.activeUsers ?? 0} currently active`}
              hint="View active users →"
              onClick={() => navigate('/users', { state: { statusFilter: 'active' } })}
              icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12a9 9 0 1 1-9-9" /><path d="M21 3v9h-9" /></svg>}
            />
            )}
            {canManageDepartments && (
            <KPI
              label="Departments"
              value={stats?.totalDepartments ?? 0}
              trend="Synced with central department table"
              hint="Manage departments →"
              onClick={() => navigate('/departments', { state: { focusCreate: true } })}
              icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /></svg>}
            />
            )}
            {canViewLeaves && (
            <KPI
              label="Pending Actions"
              value={unresolvedActions}
              trend={`${unresolvedActions} leave request${unresolvedActions === 1 ? '' : 's'} awaiting review`}
              hint="Review leave requests →"
              onClick={() => navigate('/leaves')}
              icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 6v6l3 3" /><circle cx="12" cy="12" r="9" /></svg>}
            />
            )}
            {canViewAttendance && (
              <KPI
                label="Attendance"
                value={stats?.attendanceRecords ?? 0}
                trend="Attendance tools available"
                hint="Open attendance ->"
                onClick={() => navigate('/attendance')}
                icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 2v4M16 2v4M3 10h18" /><rect x="3" y="4" width="18" height="18" rx="2" /></svg>}
              />
            )}
            {canViewAnalytics && (
              <KPI
                label="Analytics"
                value="Open"
                trend="Analytics permission granted"
                hint="View analytics ->"
                onClick={() => navigate('/analytics')}
                icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-4 4" /></svg>}
              />
            )}
            {canManageTickets && (
              <KPI
                label="Ticket Dashboard"
                value="Open"
                trend="Ticket management permission granted"
                hint="Manage tickets ->"
                onClick={() => navigate('/tickets')}
                icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h5" /></svg>}
              />
            )}
            {canUseCalendar && (
              <KPI
                label="Calendar"
                value="Open"
                trend="Calendar permission granted"
                hint="Open calendar ->"
                onClick={() => navigate('/calendar')}
                icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 2v4M16 2v4M3 10h18" /><rect x="3" y="4" width="18" height="18" rx="2" /></svg>}
              />
            )}
            {canManageGeofencing && (
              <KPI
                label="Geofencing"
                value="Open"
                trend="Geofencing permission granted"
                hint="Manage geofencing ->"
                onClick={() => navigate('/sites')}
                icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>}
              />
            )}
            {canManageNotifications && (
              <KPI
                label="Notifications"
                value="Open"
                trend="Notification management permission granted"
                hint="Manage notifications ->"
                onClick={() => navigate('/notifications')}
                icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" /><path d="M9 17a3 3 0 0 0 6 0" /></svg>}
              />
            )}
            {canExportReports && (
              <KPI
                label="Reports"
                value="Open"
                trend="Export reports permission granted"
                hint="Open reports ->"
                onClick={() => navigate('/reports')}
                icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>}
              />
            )}
          </>
        )}
      </section>

      {(canViewUsers || canViewActivity) && (
      <section className="grid xl:grid-cols-5 gap-6">
        {canViewUsers && (
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
        )}

        <div className={`space-y-6 ${canViewUsers ? 'xl:col-span-2' : 'xl:col-span-5'}`}>
          {canViewActivity && (
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
          )}

          <GlassCard className="p-5">
            <h2 className="text-sm font-medium text-white">Quick Actions</h2>
            <div className="mt-4 grid grid-cols-1 gap-2">
              {canCreateUsers && (
                <button
                  type="button"
                  onClick={() => navigate('/users', { state: { openCreate: true } })}
                  className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/20 transition-all duration-200 active:scale-[0.99]"
                >
                  Add User
                </button>
              )}
              {canExportReports && canViewUsers && (
                <button
                  type="button"
                  onClick={() => {
                    if (cachedUsers.length) {
                      downloadUsersCsv(cachedUsers);
                    } else {
                      adminService.getUsers().then(downloadUsersCsv).catch((err) => {
                        setError(err?.message || 'Failed to export users');
                      });
                    }
                  }}
                  className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/20 transition-all duration-200 active:scale-[0.99]"
                >
                  Export Users (CSV)
                </button>
              )}
              {canManageDepartments && (
                <button
                  type="button"
                  onClick={() => navigate('/departments', { state: { focusCreate: true } })}
                  className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/20 transition-all duration-200 active:scale-[0.99]"
                >
                  Create Department
                </button>
              )}
              {!canCreateUsers && !(canExportReports && canViewUsers) && !canManageDepartments && (
                <p className="text-sm text-slate-300">No quick actions available.</p>
              )}
            </div>
          </GlassCard>
        </div>
      </section>
      )}
    </div>
  );
}
