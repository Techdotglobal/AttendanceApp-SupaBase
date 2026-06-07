import { useEffect, useState } from 'react';
import { adminService } from '../services/adminService';
import { GlassCard } from '../../../shared/components/GlassCard';
import { PermissionGate, useAnyPermission } from '../../../shared/components/PermissionGate';
import { PERMISSIONS } from '../permissions';

export function AttendancePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canViewAttendance = useAnyPermission([PERMISSIONS.VIEW_ATTENDANCE, PERMISSIONS.MANUAL_ATTENDANCE]);

  const loadAttendance = async () => {
    if (!canViewAttendance) return;
    setLoading(true);
    setError('');
    try {
      const data = await adminService.getAttendance();
      setRows(data || []);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAttendance();
    if (!canViewAttendance) return undefined;
    const timer = setInterval(loadAttendance, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAttendance]);

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">Attendance</h1>
        <div className="flex gap-2">
          <PermissionGate permission={PERMISSIONS.MANUAL_ATTENDANCE}>
            <button
              type="button"
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white hover:bg-indigo-700 transition-all duration-200"
            >
              Manual Correction
            </button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.EXPORT_ATTENDANCE}>
            <button
              type="button"
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-slate-100 hover:bg-white/20 transition-all duration-200"
            >
              Export Attendance
            </button>
          </PermissionGate>
          {canViewAttendance && (
            <button
              type="button"
              onClick={loadAttendance}
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-slate-100 hover:bg-white/20 transition-all duration-200"
            >
              Refresh
            </button>
          )}
        </div>
      </div>

      <PermissionGate anyOf={[PERMISSIONS.VIEW_ATTENDANCE, PERMISSIONS.MANUAL_ATTENDANCE]}>
        {error && <GlassCard className="p-4 text-sm text-red-100">{error}</GlassCard>}
        <div className="space-y-2">
          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl border border-white/15 bg-white/10 skeleton" />
            ))}
          {!loading && rows.length === 0 && <GlassCard className="p-4 text-sm text-slate-300">No attendance records found.</GlassCard>}
          {!loading &&
            rows.slice(0, 100).map((r) => (
              <GlassCard key={r.id} className="p-3 text-slate-100">
                {r.username || 'Unknown user'} - {r.type || 'event'} - {r.timestamp ? new Date(r.timestamp).toLocaleString() : 'Unknown time'}
              </GlassCard>
            ))}
        </div>
      </PermissionGate>
    </div>
  );
}
