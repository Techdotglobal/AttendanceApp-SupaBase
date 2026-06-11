import { useEffect, useState } from 'react';
import { adminService } from '../services/adminService';
import { GlassCard } from '../../../shared/components/GlassCard';
import { PermissionGate, usePermission } from '../../../shared/components/PermissionGate';
import { PERMISSIONS } from '../permissions';
import {
  formatEmployeeDisplay,
  formatLeaveStatus,
  formatLeaveTypeLabel,
} from '../utils/leaveDisplay';

export function LeavesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await adminService.getLeaves();
      setRows(data || []);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load leaves');
    } finally {
      setLoading(false);
    }
  };
  const canApprove = usePermission(PERMISSIONS.APPROVE_LEAVE);
  const canReject = usePermission(PERMISSIONS.REJECT_LEAVE);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processLeave = async (id, status) => {
    try {
      await adminService.processLeave(id, { status });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to process leave');
    }
  };

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">Leaves</h1>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-slate-100 hover:bg-white/20 transition-all duration-200"
        >
          Refresh
        </button>
      </div>
      {error && <GlassCard className="p-4 text-sm text-red-100">{error}</GlassCard>}
      <div className="space-y-2">
        {loading &&
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl border border-white/15 bg-white/10 skeleton" />
          ))}
        {!loading && rows.length === 0 && <GlassCard className="p-4 text-sm text-slate-300">No leave requests found.</GlassCard>}
        {!loading &&
          rows.map((r) => (
            <GlassCard key={r.id} className="p-3 flex justify-between items-center gap-3">
              <div className="min-w-0">
                <p className="text-slate-100 font-medium truncate">{formatEmployeeDisplay(r)}</p>
                <p className="text-sm text-slate-300 mt-0.5">
                  {formatLeaveTypeLabel(r.leave_type)} · {formatLeaveStatus(r.status)}
                  {r.employee_department ? ` · ${r.employee_department}` : ''}
                </p>
              </div>
              {r.status === 'pending' && (canApprove || canReject) && (
                <div className="space-x-2 shrink-0">
                  <PermissionGate permission={PERMISSIONS.APPROVE_LEAVE}>
                    <button className="rounded bg-green-700 px-2 py-1 text-white" onClick={() => processLeave(r.id, 'approved')}>Approve</button>
                  </PermissionGate>
                  <PermissionGate permission={PERMISSIONS.REJECT_LEAVE}>
                    <button className="rounded bg-red-700 px-2 py-1 text-white" onClick={() => processLeave(r.id, 'rejected')}>Reject</button>
                  </PermissionGate>
                </div>
              )}
            </GlassCard>
          ))}
      </div>
    </div>
  );
}
