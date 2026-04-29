import { useEffect, useState } from 'react';
import { adminService } from '../services/adminService';
import { GlassCard } from '../../../shared/components/GlassCard';

export function SitesPage() {
  const [sites, setSites] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({ name: '', latitude: '', longitude: '', radius: '', department_id: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [sitesData, departmentsData] = await Promise.all([
        adminService.getSites(),
        adminService.getDepartments(),
      ]);
      setSites(sitesData || []);
      setDepartments(departmentsData || []);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load sites');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createSite = async () => {
    setError('');
    try {
      await adminService.createSite({
        ...form,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        radius: Number(form.radius),
      });
      setForm({ name: '', latitude: '', longitude: '', radius: '', department_id: '' });
      await load();
    } catch (err) {
      console.error('[SitesPage] Failed to create site:', err);
      setError(err?.message || 'Failed to create site');
    }
  };

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">Sites</h1>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-slate-100 hover:bg-white/20 transition-all duration-200"
        >
          Refresh
        </button>
      </div>
      {error && <GlassCard className="p-4 text-sm text-red-100">{error}</GlassCard>}
      <div className="grid md:grid-cols-5 gap-2 mb-4">
        <input className="rounded bg-slate-800/80 p-2 text-slate-100" placeholder="name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        <input className="rounded bg-slate-800/80 p-2 text-slate-100" placeholder="latitude" value={form.latitude} onChange={(e) => setForm((p) => ({ ...p, latitude: e.target.value }))} />
        <input className="rounded bg-slate-800/80 p-2 text-slate-100" placeholder="longitude" value={form.longitude} onChange={(e) => setForm((p) => ({ ...p, longitude: e.target.value }))} />
        <input className="rounded bg-slate-800/80 p-2 text-slate-100" placeholder="radius" value={form.radius} onChange={(e) => setForm((p) => ({ ...p, radius: e.target.value }))} />
        <select
          className="rounded bg-slate-800/80 p-2 text-slate-100"
          value={form.department_id}
          onChange={(e) => setForm((p) => ({ ...p, department_id: e.target.value }))}
        >
          <option value="">Select department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      <button className="rounded bg-indigo-600 px-3 py-2 mb-4 text-white" onClick={createSite}>
        Create Site
      </button>
      <div className="space-y-2">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl border border-white/15 bg-white/10 skeleton" />
          ))}
        {!loading && sites.length === 0 && <GlassCard className="p-4 text-sm text-slate-300">No sites available.</GlassCard>}
        {!loading &&
          sites.map((s) => (
            <GlassCard key={s.id} className="p-3 text-slate-100">
              {s.name} ({s.latitude}, {s.longitude}) r={s.radius}
            </GlassCard>
          ))}
      </div>
    </div>
  );
}
