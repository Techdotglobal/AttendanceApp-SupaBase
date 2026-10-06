import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCw, SearchX } from 'lucide-react';
import { adminService } from '../services/adminService';
import {
  allManagerPermissions,
  defaultManagerPermissions,
  managerPermissionGroups,
} from '../permissions';
import {
  GlassTable,
  TableCell,
  TableIdentity,
  TableRow,
} from '../../../shared/components/GlassTable';
import { SlideOverPanel } from '../../../shared/components/SlideOverPanel';
import { PageActions } from '../../../shared/components/pageChrome';
import { Alert } from '../../../shared/components/ui/Alert';
import { EmptyStateBody } from '../../../shared/components/ui/EmptyState';
import { Select } from '../../../shared/components/ui/Select';

const VIEWS = [
  { id: 'roles', label: 'Roles' },
  { id: 'users', label: 'Users' },
  { id: 'permissions', label: 'Permissions' },
];

const AUDIT_FILTERS = [
  {
    id: 'all',
    label: 'All activity',
    actions: null,
    subtitle: 'Every access-control change in this company.',
    emptyTitle: 'No audit entries yet',
  },
  {
    id: 'roles',
    label: 'Roles',
    actions: ['role_changed'],
    subtitle: 'Role assignments and changes.',
    emptyTitle: 'No role changes yet',
  },
  {
    id: 'users',
    label: 'Users',
    actions: ['user_activated', 'user_deactivated', 'user_deleted'],
    subtitle: 'Activation, deactivation, and account changes.',
    emptyTitle: 'No user account changes yet',
  },
  {
    id: 'permissions',
    label: 'Permissions',
    actions: ['permissions_changed'],
    subtitle: 'Permission grant changes.',
    emptyTitle: 'No permission changes yet',
  },
];

const ROLE_CATALOG = [
  {
    id: 'manager',
    name: 'Manager',
    description:
      'Admin-console access is evaluated from each person’s grant list. The matrix below is the manager default until you override it for a user.',
  },
  {
    id: 'super_admin',
    name: 'Super admin',
    description: 'Unrestricted access to every module. Super-admin rights cannot be reduced on this screen.',
  },
  {
    id: 'employee',
    name: 'Employees with delegated access',
    description: 'Employees remain on the standard employee experience unless explicit administrative grants are assigned.',
  },
];

function roleLabel(value) {
  const hit = ROLE_CATALOG.find((role) => role.id === value);
  return hit?.name || String(value || '').replace(/_/g, ' ');
}

function formatWhen(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatAction(action) {
  const labels = {
    permissions_changed: 'Permissions Changed',
    user_activated: 'User Activated',
    user_deactivated: 'User Deactivated',
    role_changed: 'Role Changed',
    user_deleted: 'User Deleted',
  };
  if (labels[action]) return labels[action];
  const text = String(action || '').replace(/_/g, ' ').trim();
  if (!text) return '—';
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function AuditHistoryButton({ open, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={open}
      className="ui-btn-secondary ui-btn-sm"
    >
      <History className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      Audit History
    </button>
  );
}

function defaultSetForRole(roleId) {
  if (roleId === 'manager') return new Set(defaultManagerPermissions);
  if (roleId === 'super_admin') return new Set(allManagerPermissions);
  return new Set();
}

function samePermissionSet(a, b) {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

export function ManagerPermissionsPage() {
  const [view, setView] = useState('roles');
  const [managers, setManagers] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [selectedUid, setSelectedUid] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('manager');
  const [permissionSet, setPermissionSet] = useState(new Set());
  const [grantScope, setGrantScope] = useState('DEPARTMENT');
  const [grantDepartmentId, setGrantDepartmentId] = useState('');
  const [departments, setDepartments] = useState([]);
  const [search, setSearch] = useState('');
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditFilter, setAuditFilter] = useState('roles');
  const [auditRefreshing, setAuditRefreshing] = useState(false);
  const [organizationRoles, setOrganizationRoles] = useState([]);
  const [roleEditor, setRoleEditor] = useState(null);
  const [roleSaving, setRoleSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedManager = managers.find((row) => row.uid === selectedUid) || null;

  const filteredManagers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return managers;
    return managers.filter((row) =>
      `${row.name || ''} ${row.username || ''} ${row.email || ''} ${row.department || ''} ${row.role || ''}`
        .toLowerCase()
        .includes(query)
    );
  }, [managers, search]);

  const usersByRole = useMemo(
    () => ({
      manager: managers.filter((row) => row.role === 'manager'),
      super_admin: directory.filter((row) => row.role === 'super_admin'),
      employee: managers.filter((row) => row.role === 'employee' && (row.permissions || []).length > 0),
    }),
    [managers, directory]
  );

  const refreshAuditLogs = useCallback(async () => {
    setAuditRefreshing(true);
    try {
      const logs = await adminService.getAuditLogs().catch(() => []);
      setAuditLogs(logs || []);
    } finally {
      setAuditRefreshing(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [userRows, logs, roleRows, departmentRows] = await Promise.all([
        adminService.getUsers(),
        adminService.getAuditLogs().catch(() => []),
        adminService.getOrganizationRoles().catch(() => []),
        adminService.getDepartments().catch(() => []),
      ]);
      const directoryRows = userRows || [];
      const delegatedRows = await Promise.all(directoryRows
        .filter((row) => row.role !== 'super_admin')
        .map(async (row) => {
          try {
            const grants = await adminService.getUserGrants(row.uid);
            return { ...row, grants: grants || [], permissions: [...new Set((grants || []).map((grant) => grant.permission_key))] };
          } catch (_) {
            return row;
          }
        }));
      const rowsByUid = new Map();
      for (const row of delegatedRows) {
        rowsByUid.set(row.uid, row);
      }
      const rows = [...rowsByUid.values()];
      setManagers(rows);
      setAuditLogs(logs || []);
      setDirectory(directoryRows);
      setOrganizationRoles(roleRows || []);
      setDepartments(departmentRows || []);
      setSelectedUid((current) => {
        if (current && rows.some((row) => row.uid === current)) return current;
        return rows[0]?.uid || '';
      });
    } catch (err) {
      setError(err?.message || 'Failed to load user permissions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const manager = managers.find((row) => row.uid === selectedUid);
    if (manager) {
      setPermissionSet(new Set(manager.permissions || []));
      setGrantScope(manager.grants?.find((grant) => grant.granted !== false)?.scope_type || 'DEPARTMENT');
      setGrantDepartmentId(String(manager.grants?.find((grant) => grant.granted !== false)?.department_id || manager.department_id || ''));
    }
  }, [selectedUid, managers]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(''), 2500);
    return () => clearTimeout(timer);
  }, [message]);

  const togglePermission = (key) => {
    setPermissionSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (keys, grant) => {
    setPermissionSet((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (grant) next.add(key);
        else next.delete(key);
      }
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
      if (selectedManager.role === 'manager') {
        await adminService.updateManagerPermissions(selectedManager.uid, permissions);
      } else {
        await adminService.updateUserGrants(selectedManager.uid, permissions.map((permission_key) => ({
          permission_key,
          granted: true,
          scope_type: grantScope,
          department_id: grantScope === 'DEPARTMENT' ? grantDepartmentId || selectedManager.department_id : null,
        })));
      }
      setManagers((prev) =>
        prev.map((row) => (row.uid === selectedManager.uid ? { ...row, permissions } : row))
      );
      setMessage('Permissions saved.');
      refreshAuditLogs();
    } catch (err) {
      setError(err?.message || 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  };

  const grantedCount = permissionSet.size;
  const savedSet = new Set(selectedManager?.permissions || []);
  const dirty = Boolean(selectedManager) && !samePermissionSet(permissionSet, savedSet);
  const selectedRole = ROLE_CATALOG.find((role) => role.id === selectedRoleId);
  const roleUsers = usersByRole[selectedRoleId] || [];
  const roleAccess = defaultSetForRole(selectedRoleId);

  const auditScope = AUDIT_FILTERS.find((item) => item.id === auditFilter) || AUDIT_FILTERS[0];
  const visibleAuditLogs = useMemo(() => {
    if (!auditScope.actions) return auditLogs;
    return auditLogs.filter((log) => auditScope.actions.includes(log.action));
  }, [auditLogs, auditScope]);

  const openUserPermissions = (uid) => {
    setSelectedUid(uid);
    setView('permissions');
  };

  const openAuditHistory = () => {
    setAuditFilter(view);
    setAuditOpen(true);
    refreshAuditLogs();
  };

  const saveOrganizationRole = async (event) => {
    event.preventDefault();
    if (!roleEditor?.name?.trim()) return;
    setRoleSaving(true);
    setError('');
    try {
      const payload = {
        name: roleEditor.name.trim(),
        code: roleEditor.code?.trim() || roleEditor.name.trim(),
        description: roleEditor.description?.trim() || null,
        is_active: roleEditor.is_active !== false,
      };
      const saved = roleEditor.id
        ? await adminService.updateOrganizationRole(roleEditor.id, payload)
        : await adminService.createOrganizationRole(payload);
      setOrganizationRoles((current) => {
        const next = current.filter((row) => row.id !== saved.id);
        return [...next, saved].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      });
      setRoleEditor(null);
      setMessage('Organizational role saved.');
    } catch (err) {
      setError(err?.message || 'Failed to save organizational role');
    } finally {
      setRoleSaving(false);
    }
  };

  const deactivateOrganizationRole = async (role) => {
    if (!window.confirm(`Deactivate ${role.name}? Existing users and workflow history will keep the role reference.`)) return;
    setRoleSaving(true);
    setError('');
    try {
      const saved = await adminService.deactivateOrganizationRole(role.id);
      setOrganizationRoles((current) => current.map((row) => (row.id === saved.id ? saved : row)));
      setMessage('Organizational role deactivated.');
    } catch (err) {
      setError(err?.message || 'Failed to deactivate organizational role');
    } finally {
      setRoleSaving(false);
    }
  };

  return (
    <div className="permissions-directory admin-page admin-page-locked gap-4 animate-fade-up">
      <PageActions>
        <AuditHistoryButton open={auditOpen} onClick={openAuditHistory} />
      </PageActions>
      {error && <Alert type="error">{error}</Alert>}
      {message && <Alert type="success">{message}</Alert>}

      <div className="ui-segment" role="tablist" aria-label="Access control">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
            className={`ui-segment-item ${view === item.id ? 'ui-segment-item-active' : ''}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === 'roles' && (
        <PermissionsColumns
          rail={
            <aside className="permissions-rail">
      <div className="permissions-rail-list" data-lenis-prevent>
                {ROLE_CATALOG.map((role) => {
                  const active = role.id === selectedRoleId;
                  const count = (usersByRole[role.id] || []).length;
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setSelectedRoleId(role.id)}
                      className={`permissions-rail-item w-full text-left ${active ? 'is-active' : ''}`}
                    >
                      <span className="block text-sm font-medium text-slate-900">{role.name}</span>
                      <span className="mt-0.5 block text-xs text-slate-400">
                        {loading ? '—' : count === 1 ? '1 person' : `${count} people`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>
          }
        >
          {selectedRole && (
            <div className="permissions-panel-body p-5" data-lenis-prevent>
              <h2 className="text-[17px] font-semibold tracking-tight text-slate-900">{selectedRole.name}</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">{selectedRole.description}</p>
              <p className="mt-3 text-sm text-slate-600">
                {selectedRoleId === 'manager' &&
                  `${roleAccess.size} of ${allManagerPermissions.length} permissions by default`}
                {selectedRoleId === 'super_admin' && `All ${allManagerPermissions.length} permissions`}
              </p>

              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Organizational roles</h3>
                    <p className="mt-1 text-xs text-slate-500">Job titles are separate from security roles and never grant access by themselves.</p>
                  </div>
                  <button type="button" className="ui-btn-secondary ui-btn-sm" onClick={() => setRoleEditor({ name: '', code: '', description: '', is_active: true })}>New role</button>
                </div>
                {roleEditor && (
                  <form className="mt-3 grid gap-2 md:grid-cols-4" onSubmit={saveOrganizationRole}>
                    <input className="ui-input" placeholder="Role name" value={roleEditor.name} onChange={(e) => setRoleEditor((r) => ({ ...r, name: e.target.value }))} required />
                    <input className="ui-input" placeholder="Code" value={roleEditor.code} onChange={(e) => setRoleEditor((r) => ({ ...r, code: e.target.value }))} />
                    <input className="ui-input md:col-span-2" placeholder="Description" value={roleEditor.description || ''} onChange={(e) => setRoleEditor((r) => ({ ...r, description: e.target.value }))} />
                    <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={roleEditor.is_active !== false} onChange={(e) => setRoleEditor((r) => ({ ...r, is_active: e.target.checked }))} /> Active</label>
                    <div className="flex gap-2 md:col-span-3 md:justify-end"><button type="button" className="ui-btn-secondary ui-btn-sm" onClick={() => setRoleEditor(null)}>Cancel</button><button type="submit" className="ui-btn-primary ui-btn-sm" disabled={roleSaving}>{roleSaving ? 'Saving…' : 'Save role'}</button></div>
                  </form>
                )}
                <div className="mt-3 divide-y divide-slate-200">
                  {organizationRoles.map((role) => (
                    <div key={role.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span><span className="font-medium text-slate-800">{role.name}</span><span className="ml-2 text-xs text-slate-400">{role.code}{role.is_active === false ? ' · inactive' : ''}</span></span>
                      <span className="flex gap-2"><button type="button" className="ui-btn-ghost ui-btn-sm" onClick={() => setRoleEditor(role)}>Edit</button>{role.is_active !== false && <button type="button" className="ui-btn-danger ui-btn-sm" disabled={roleSaving} onClick={() => deactivateOrganizationRole(role)}>Deactivate</button>}</span>
                    </div>
                  ))}
                  {!organizationRoles.length && <p className="py-2 text-xs text-slate-500">No organizational roles configured.</p>}
                </div>
              </div>

              <h3 className="permissions-section-label">Assigned users</h3>
              {roleUsers.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  {selectedRoleId === 'super_admin'
                    ? 'Super-admin accounts are not edited from this screen.'
                    : 'No one with this role is in the access list yet.'}
                </p>
              ) : (
                <ul className="permissions-user-list mt-2">
                  {roleUsers.map((row) => (
                    <li key={row.uid}>
                      {row.role === 'super_admin' ? (
                        <div className="permissions-user-row">
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-slate-800">{row.name || row.username}</span>
                            <span className="block truncate text-xs text-slate-400">
                              {row.department || row.email || row.username}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">Full access</span>
                        </div>
                      ) : (
                        <button type="button" onClick={() => openUserPermissions(row.uid)} className="permissions-user-row">
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-slate-800">{row.name || row.username}</span>
                            <span className="block truncate text-xs text-slate-400">
                              {row.department || row.email || row.username}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">
                            {(row.permissions || []).length} granted
                          </span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="permissions-section-label">Permissions</h3>
              <p className="mt-1 mb-3 text-xs text-slate-400">
                {selectedRoleId === 'manager'
                  ? 'Module totals reflect the manager default. Open a group to see each grant.'
                  : 'Open a module to see which grants are included.'}
              </p>
              <PermissionMatrix value={roleAccess} readOnly />
            </div>
          )}
        </PermissionsColumns>
      )}

      {view === 'users' && (
        <PermissionsColumns
          rail={
            <UserRail
              loading={loading}
              search={search}
              onSearch={setSearch}
              rows={filteredManagers}
              selectedUid={selectedUid}
              onSelect={setSelectedUid}
            />
          }
        >
          <div className="permissions-panel-body p-5" data-lenis-prevent>
            {selectedManager ? (
              <>
                <h2 className="text-[17px] font-semibold tracking-tight text-slate-900">
                  {selectedManager.name || selectedManager.username}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {roleLabel(selectedManager.role)}
                  {selectedManager.department ? ` · ${selectedManager.department}` : ''}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {(selectedManager.permissions || []).length} of {allManagerPermissions.length} permissions granted
                </p>
                {selectedManager.role !== 'manager' && (
                  <p className="mt-3 text-sm text-slate-500">
                    These are explicit delegated grants. The employee baseline remains unchanged.
                  </p>
                )}
                <div className="mt-4">
                  <button type="button" onClick={() => setView('permissions')} className="ui-btn-primary ui-btn-sm">
                    Edit permissions
                  </button>
                </div>
                <h3 className="permissions-section-label">Permissions</h3>
                <PermissionMatrix value={new Set(selectedManager.permissions || [])} readOnly />
              </>
            ) : (
              <p className="text-sm text-slate-500">Select a user to review their access.</p>
            )}
          </div>
        </PermissionsColumns>
      )}

      {view === 'permissions' && (
        <PermissionsColumns
          rail={
            <UserRail
              loading={loading}
              search={search}
              onSearch={setSearch}
              rows={filteredManagers}
              selectedUid={selectedUid}
              onSelect={setSelectedUid}
            />
          }
        >
          {selectedManager ? (
            <>
              <div className="permissions-matrix-toolbar">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {selectedManager.name || selectedManager.username}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {roleLabel(selectedManager.role)}
                    {selectedManager.department ? ` · ${selectedManager.department}` : ''}
                    {` · ${grantedCount} of ${allManagerPermissions.length} granted`}
                    {dirty ? ' · unsaved' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPermissionSet(new Set(allManagerPermissions))}
                    className="ui-btn-secondary ui-btn-sm"
                  >
                    Select All
                  </button>
                  <button type="button" onClick={() => setPermissionSet(new Set())} className="ui-btn-secondary ui-btn-sm">
                    Deselect All
                  </button>
                  <button
                    type="button"
                    onClick={() => setPermissionSet(new Set(defaultManagerPermissions))}
                    className="ui-btn-secondary ui-btn-sm"
                  >
                    Reset to Default
                  </button>
                  <button type="button" onClick={save} disabled={saving} className="ui-btn-primary ui-btn-sm">
                    {saving ? 'Saving…' : 'Save Permissions'}
                  </button>
                </div>
              </div>
              {selectedManager.role !== 'manager' && (
                <p className="border-b border-slate-100 px-5 py-3 text-sm text-slate-500">
                  These grants are stored for this account and are evaluated with the selected scope.
                </p>
              )}
              {selectedManager.role !== 'manager' && (
                <div className="border-b border-slate-100 px-5 py-3">
                  <label className="text-xs font-medium text-slate-600" htmlFor="grant-scope">Grant scope</label>
                  <Select id="grant-scope" size="sm" value={grantScope} onChange={(event) => setGrantScope(event.target.value)} className="mt-1 w-full max-w-xs">
                    <option value="OWN">Own</option>
                    <option value="DEPARTMENT">Department</option>
                    <option value="ASSIGNED_DEPARTMENTS">Assigned departments</option>
                    <option value="COMPANY">Company</option>
                  </Select>
                  {grantScope === 'DEPARTMENT' && <Select id="grant-department" size="sm" value={grantDepartmentId} onChange={(event) => setGrantDepartmentId(event.target.value)} className="mt-2 w-full max-w-xs" aria-label="Grant department"><option value="">Select department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</Select>}
                </div>
              )}
              <div className="permissions-panel-body p-5" data-lenis-prevent>
                <PermissionMatrix
                  value={permissionSet}
                  onToggle={togglePermission}
                  onToggleGroupKeys={toggleGroup}
                />
              </div>
            </>
          ) : (
            <p className="p-5 text-sm text-slate-500">Select a user to edit permissions.</p>
          )}
        </PermissionsColumns>
      )}

      <SlideOverPanel
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        size="lg"
        title="Audit History"
        description={auditScope.subtitle}
        bodyClassName="overflow-x-hidden px-0 py-0"
        headerActions={
          <>
            <Select
              size="sm"
              aria-label="Filter audit history"
              value={auditFilter}
              onChange={(event) => setAuditFilter(event.target.value)}
              className="w-auto min-w-[8.75rem]"
            >
              {AUDIT_FILTERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
            <button
              type="button"
              onClick={refreshAuditLogs}
              disabled={auditRefreshing}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${auditRefreshing ? 'animate-spin' : ''}`} strokeWidth={2} aria-hidden />
              Refresh
            </button>
          </>
        }
      >
        <GlassTable
          className="permissions-audit-table rounded-none border-0 shadow-none"
          emptyIcon={History}
          emptyTitle={auditScope.emptyTitle}
          emptyMessage="Access-control changes are recorded here with the actor and the affected user."
          columns={[
            { key: 'action', label: 'Action' },
            { key: 'actor', label: 'Actor' },
            { key: 'target', label: 'Target' },
            { key: 'time', label: 'Time', className: 'text-right' },
          ]}
        >
          {visibleAuditLogs.map((log) => {
            const actionLabel = formatAction(log.action);
            return (
              <TableRow key={log.id}>
                <TableCell>
                  <span className="block truncate text-xs font-medium text-slate-800" title={actionLabel}>
                    {actionLabel}
                  </span>
                </TableCell>
                <TableCell>
                  <TableIdentity size="xs" name={log.actor?.name || log.actor?.username || 'Unknown user'} />
                </TableCell>
                <TableCell>
                  <TableIdentity
                    size="xs"
                    name={log.target?.name || log.target?.username || 'Unknown user'}
                    tone="neutral"
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-xs text-slate-400">
                  {formatWhen(log.timestamp)}
                </TableCell>
              </TableRow>
            );
          })}
        </GlassTable>
      </SlideOverPanel>
    </div>
  );
}

function PermissionsColumns({ rail, children }) {
  return (
    <div className="permissions-content-wrapper">
      {rail}
      <section className="permissions-panel">{children}</section>
    </div>
  );
}

function UserRail({ loading, search, onSearch, rows, selectedUid, onSelect }) {
  return (
    <aside className="permissions-rail">
      <div className="shrink-0 border-b border-slate-200 p-3">
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search users"
          aria-label="Search users"
          className="ui-input w-full"
        />
      </div>
      <div className="permissions-rail-list" data-lenis-prevent>
        {loading && (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="skeleton h-14 rounded-lg" />
            ))}
          </div>
        )}
        {!loading && rows.length === 0 && (
          <EmptyStateBody
            size="sm"
            icon={SearchX}
            title="No users match"
            description={
              search
                ? 'Try a shorter search term, or clear it to see every manager and admin.'
                : 'Promote someone to manager and they will show up here for permission tuning.'
            }
            action={
              search ? (
                <button type="button" onClick={() => onSearch('')} className="ui-btn-secondary ui-btn-sm">
                  Clear search
                </button>
              ) : null
            }
            className="py-8"
          />
        )}
        {rows.map((row) => {
          const active = row.uid === selectedUid;
          return (
            <button
              key={row.uid}
              type="button"
              onClick={() => onSelect(row.uid)}
              className={`permissions-rail-item w-full text-left ${active ? 'is-active' : ''}`}
            >
              <span className="block truncate text-sm font-medium text-slate-900">{row.name || row.username}</span>
              <span className="mt-0.5 block truncate text-xs text-slate-400">
                {roleLabel(row.role)}
                {row.department ? ` · ${row.department}` : ''}
                {` · ${(row.permissions || []).length} granted`}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function PermissionMatrix({ value, onToggle, onToggleGroupKeys, readOnly = false }) {
  return (
    <div className="permission-matrix">
      <div className="permission-matrix-head">
        <span>Permission</span>
        <span>Access</span>
      </div>
      {managerPermissionGroups.map((group, index) => {
        const keys = group.permissions.map(([key]) => key);
        const granted = keys.filter((key) => value.has(key)).length;
        return (
          <details key={group.group} className="permission-group" defaultOpen={index === 0}>
            <summary>
              <span className="permission-group-name">{group.group}</span>
              {!readOnly && onToggleGroupKeys && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    onToggleGroupKeys(keys, granted !== keys.length);
                  }}
                  className="permission-group-action"
                >
                  {granted === keys.length ? 'Clear group' : 'Grant group'}
                </button>
              )}
              <span className="permission-group-count">
                {granted}/{keys.length}
              </span>
            </summary>
            <ul>
              {group.permissions.map(([key, label]) => (
                <li key={key} className="permission-row">
                  <span>{label}</span>
                  <label className="permission-check">
                    <span className="sr-only">{label}</span>
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      checked={value.has(key)}
                      disabled={readOnly}
                      onChange={() => onToggle?.(key)}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
