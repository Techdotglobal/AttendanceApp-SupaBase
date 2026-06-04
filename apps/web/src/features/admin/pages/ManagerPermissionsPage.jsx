import { useEffect, useMemo, useState } from 'react';
import { adminService } from '../services/adminService';
import {
  allManagerPermissions,
  defaultManagerPermissions,
  managerPermissionGroups,
} from '../permissions';
import { GlassCard } from '../../../shared/components/GlassCard';

export function ManagerPermissionsPage() {
  const [managers, setManagers] = useState([]);
  const [selectedUid, setSelectedUid] = useState('');
  const [permissionSet, setPermissionSet] = useState(new Set());
  const [search, setSearch] = useState('');
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedManager = managers.find((m) => m.uid === selectedUid) || null;

  const filteredManagers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return managers;
    return managers.filter((manager) =>
      `${manager.name || ''} ${manager.username || ''} ${manager.email || ''} ${manager.department || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [managers, search]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [managerRows, logs] = await Promise.all([
        adminService.getManagers(),
        adminService.getAuditLogs(),
      ]);
      setManagers(managerRows || []);
      setAuditLogs(logs || []);
      const first = (managerRows || [])[0];
      if (first) {
        setSelectedUid(first.uid);
        setPermissionSet(new Set(first.permissions || []));
      }
    } catch (err) {
      setError(err?.message || 'Failed to load manager permissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const manager = managers.find((m) => m.uid === selectedUid);
    if (manager) setPermissionSet(new Set(manager.permissions || []));
  }, [selectedUid, managers]);

  const togglePermission = (key) => {
    setPermissionSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    if (!selectedManager) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const permissions = Array.from(permissionSet);
      await adminService.updateManagerPermissions(selectedManager.uid, permissions);
      setManagers((prev) =>
        prev.map((manager) =>
          manager.uid === selectedManager.uid ? { ...manager, permissions } : manager
        )
      );
      setMessage('Permissions saved.');
      const logs = await adminService.getAuditLogs();
      setAuditLogs(logs || []);
    } catch (err) {
      setError(err?.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const grantedCount = permissionSet.size;

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <h1 className="text-2xl font-semibold text-white">Manager Permissions</h1>
        <p className="mt-1 text-sm text-slate-200">
          Control manager access from one source of truth.
        </p>
      </div>

      {error && <GlassCard className="p-4 text-sm text-red-100">{error}</GlassCard>}
      {message && <GlassCard className="p-4 text-sm text-emerald-100">{message}</GlassCard>}

      <div className="grid grid-cols-1 xl:grid-cols-[22rem_1fr] gap-5">
        <GlassCard className="p-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search managers..."
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-300 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300/30"
          />
          <div className="mt-4 space-y-2">
            {loading && <p className="text-sm text-slate-200">Loading managers...</p>}
            {!loading && filteredManagers.length === 0 && (
              <p className="text-sm text-slate-200">No managers found.</p>
            )}
            {filteredManagers.map((manager) => {
              const active = manager.uid === selectedUid;
              return (
                <button
                  key={manager.uid}
                  type="button"
                  onClick={() => setSelectedUid(manager.uid)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition-all ${
                    active
                      ? 'border-blue-300/60 bg-blue-500/25 text-white'
                      : 'border-white/10 bg-white/10 text-slate-100 hover:bg-white/15'
                  }`}
                >
                  <span className="block text-sm font-semibold">{manager.name || manager.username}</span>
                  <span className="block text-xs text-slate-300">
                    {manager.department || 'No department'} / {(manager.permissions || []).length} permissions
                  </span>
                </button>
              );
            })}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          {selectedManager ? (
            <>
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-lg font-semibold text-white">
                    {selectedManager.name || selectedManager.username}
                  </p>
                  <p className="text-sm text-slate-300">
                    {grantedCount} of {allManagerPermissions.length} permissions granted
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setPermissionSet(new Set(allManagerPermissions))} className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/20">
                    Select All
                  </button>
                  <button type="button" onClick={() => setPermissionSet(new Set())} className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/20">
                    Deselect All
                  </button>
                  <button type="button" onClick={() => setPermissionSet(new Set(defaultManagerPermissions))} className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/20">
                    Reset to Default
                  </button>
                  <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save Permissions'}
                  </button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
                {managerPermissionGroups.map((group) => (
                  <div key={group.group} className="rounded-lg border border-white/10 bg-white/10 p-4">
                    <p className="font-semibold text-white">{group.group}</p>
                    <div className="mt-3 space-y-2">
                      {group.permissions.map(([key, label]) => (
                        <label key={key} className="flex items-center gap-3 text-sm text-slate-100">
                          <input
                            type="checkbox"
                            checked={permissionSet.has(key)}
                            onChange={() => togglePermission(key)}
                            className="h-4 w-4"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-200">Select a manager to edit permissions.</p>
          )}
        </GlassCard>
      </div>

      <GlassCard className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold text-white">Audit History</p>
          <button type="button" onClick={loadData} className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/20">
            Refresh
          </button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-slate-300">
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Actor</th>
                <th className="py-2 pr-3">Target</th>
                <th className="py-2 pr-3">Time</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id} className="border-b border-white/5 text-slate-100">
                  <td className="py-2 pr-3">{log.action}</td>
                  <td className="py-2 pr-3">{log.actor?.name || log.actor?.username || log.actor_uid}</td>
                  <td className="py-2 pr-3">{log.target?.name || log.target?.username || log.target_uid}</td>
                  <td className="py-2 pr-3">{new Date(log.timestamp).toLocaleString()}</td>
                </tr>
              ))}
              {auditLogs.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-300">
                    No audit entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
}
