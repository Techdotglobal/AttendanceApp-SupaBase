import { useEffect, useState } from 'react';
import { adminService } from '../services/adminService';

export function SitesPage() {
  const [sites, setSites] = useState([]);
  const [form, setForm] = useState({ name: '', latitude: '', longitude: '', radius: '', department_id: '' });
  const load = () => adminService.getSites().then(setSites);
  useEffect(() => { load(); }, []);
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Sites</h1>
      <div className="grid md:grid-cols-5 gap-2 mb-4">
        {Object.keys(form).map((k) => <input key={k} className="rounded bg-slate-800 p-2" placeholder={k} value={form[k]} onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))} />)}
      </div>
      <button className="rounded bg-indigo-600 px-3 py-2 mb-4" onClick={async () => { await adminService.createSite({ ...form, latitude: Number(form.latitude), longitude: Number(form.longitude), radius: Number(form.radius) }); setForm({ name: '', latitude: '', longitude: '', radius: '', department_id: '' }); load(); }}>
        Create Site
      </button>
      <div className="space-y-2">
        {sites.map((s) => <div key={s.id} className="rounded border border-slate-800 p-3">{s.name} ({s.latitude}, {s.longitude}) r={s.radius}</div>)}
      </div>
    </div>
  );
}
