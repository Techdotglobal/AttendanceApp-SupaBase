import { useEffect, useState } from 'react';
import { adminService } from '../services/adminService';
import { GlassCard } from '../../../shared/components/GlassCard';

export function AttendancePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAttendance = async () => {
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
    const timer = setInterval(loadAttendance, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">Attendance</h1>
        <button
          type="button"
          onClick={loadAttendance}
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
        {!loading && rows.length === 0 && <GlassCard className="p-4 text-sm text-slate-300">No attendance records found.</GlassCard>}
        {!loading &&
          rows.slice(0, 100).map((r) => (
            <GlassCard key={r.id} className="p-3 text-slate-100">
              {r.username || 'Unknown user'} - {r.type || 'event'} - {r.timestamp ? new Date(r.timestamp).toLocaleString() : 'Unknown time'}
            </GlassCard>
          ))}
      </div>
    </div>
  );
}
