import { useEffect, useMemo, useState } from 'react';
import { GlassCard } from '../../../shared/components/GlassCard';
import { adminService } from '../services/adminService';

export function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [departmentData, userData] = await Promise.all([
          adminService.getDepartmentsOverview(),
          adminService.getUsers(),
        ]);
        setDepartments(departmentData || []);
        setUsers(userData || []);
      } catch (err) {
        setError(err?.response?.data?.error || err?.message || 'Failed to load settings data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const roleCounts = useMemo(() => {
    const map = new Map();
    for (const user of users) {
      const role = user.role || 'unknown';
      map.set(role, (map.get(role) || 0) + 1);
    }
    return Array.from(map.entries()).map(([role, count]) => ({ role, count }));
  }, [users]);

  return (
    <div className="space-y-6 animate-fade-up">
      <h1 className="text-2xl font-semibold text-white">Settings</h1>
      <GlassCard className="p-5 space-y-4">
        <h2 className="text-sm font-medium text-white">Live System Metadata</h2>
        {error && <p className="text-sm text-red-100">{error}</p>}
        {loading ? (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="h-20 rounded-xl skeleton" />
            <div className="h-20 rounded-xl skeleton" />
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border border-white/20 bg-white/10 px-4 py-3">
              <p className="text-slate-300">Departments</p>
              <p className="text-xl font-semibold text-white mt-1">{departments.length}</p>
            </div>
            <div className="rounded-lg border border-white/20 bg-white/10 px-4 py-3">
              <p className="text-slate-300">Role Types</p>
              <p className="text-xl font-semibold text-white mt-1">{roleCounts.length}</p>
            </div>
            <div className="md:col-span-2 rounded-lg border border-white/20 bg-white/10 px-4 py-3">
              <p className="text-slate-300 mb-2">Roles Distribution</p>
              {roleCounts.length === 0 ? (
                <p className="text-slate-200">No role data available.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {roleCounts.map((item) => (
                    <span key={item.role} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-slate-100">
                      {item.role}: {item.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <div className="rounded-lg border border-blue-300/20 bg-blue-500/10 px-4 py-3 text-xs text-blue-100">
          This page is backend-driven and auto-syncs role/department metadata from live data.
        </div>
      </GlassCard>
    </div>
  );
}
