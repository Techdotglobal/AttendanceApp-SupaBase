import { useCallback, useEffect, useMemo, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { adminService } from '../services/adminService';
import { useAuthStore } from '../../auth/store/authStore';
import { SlideOverPanel } from '../../../shared/components/SlideOverPanel';
import {
  GlassTable,
  TableActions,
  TableCell,
  TableIdentity,
  TableRow,
} from '../../../shared/components/GlassTable';
import { Alert } from '../../../shared/components/ui/Alert';
import { Dialog } from '../../../shared/components/ui/Dialog';
import { Select } from '../../../shared/components/ui/Select';
import { EmptyStateBody } from '../../../shared/components/ui/EmptyState';
import { hasPermission, PERMISSIONS } from '../permissions';
import {
  formatEmployeeDisplay,
  formatLeaveTypeLabel,
} from '../utils/leaveDisplay';
import { useSilentPoll } from '../../../shared/hooks/useSilentPoll';

const REQUEST_TYPE_LABELS = {
  annual_leave: 'Annual Leave',
  sick_leave: 'Sick Leave',
  casual_leave: 'Casual Leave',
  remote_work: 'Remote Work',
};

const APPROVER_ROLE_LABELS = {
  department_manager: 'Team Lead / Department Manager',
  hr: 'HR',
  super_admin: 'Super Admin',
};

const AUTHORITY_TYPE_LABELS = {
  LEGACY_ROLE: 'Legacy role',
  PERMISSION: 'Permission + scope',
  ORGANIZATION_ROLE: 'Organization role + permission',
};

const APPROVAL_PERMISSION_OPTIONS = [
  ['approve_leave', 'Approve leave'],
  ['reject_leave', 'Reject leave'],
  ['approve_work_mode', 'Approve work mode'],
  ['reject_work_mode', 'Reject work mode'],
];

const APPROVAL_SCOPE_OPTIONS = [
  ['DEPARTMENT', 'Specific department'],
  ['ASSIGNED_DEPARTMENTS', 'Approver assigned departments'],
  ['COMPANY', 'Entire company'],
];

const WORK_MODE_LABELS = {
  in_office: 'Office',
  office: 'Office',
  semi_remote: 'Hybrid',
  hybrid: 'Hybrid',
  fully_remote: 'Remote',
  remote: 'Remote',
};

const BUCKETS = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Recently approved' },
  { id: 'rejected', label: 'Recently rejected' },
];

const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

function normalizeStatus(value) {
  return String(value || 'pending').toLowerCase();
}

function formatWorkMode(value) {
  const key = String(value || '').toLowerCase().replace(/-/g, '_');
  return WORK_MODE_LABELS[key] || String(value || 'Unknown').replace(/_/g, ' ');
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).split('T')[0];
  const [year, month, day] = raw.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateRange(startValue, endValue) {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start) return '';
  const from = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (!end || start.getTime() === end.getTime()) return from;
  const sameMonth = start.getMonth() === end.getMonth();
  const to = end.toLocaleDateString(undefined, { month: sameMonth ? undefined : 'short', day: 'numeric' });
  return `${from} – ${to}`;
}

function leaveDuration(leave) {
  if (leave?.is_half_day) return 'Half day';
  const days = Number(leave?.days);
  if (days) return days === 1 ? '1 day' : `${days} days`;
  return '';
}

function leaveCategory(leave) {
  const type = String(leave?.leave_type || '').toLowerCase();
  if (type === 'annual') return 'annual_leave';
  if (type === 'sick') return 'sick_leave';
  if (type === 'casual') return 'casual_leave';
  return 'casual_leave';
}

function workModeBucket(request) {
  const status = normalizeStatus(request.status);
  const progress = request.approvalProgress || [];
  if (status === 'rejected' || progress.some((step) => normalizeStatus(step.action) === 'rejected')) return 'rejected';
  if (status === 'approved' || status === 'completed' || status === 'done') return 'approved';
  return 'pending';
}

function timeValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function formatWhen(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const delta = Date.now() - date.getTime();
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isRecent(timestamp) {
  if (!timestamp) return true;
  return Date.now() - timestamp <= RECENT_MS;
}

function toLeaveItem(leave) {
  const status = normalizeStatus(leave.status);
  const dates = formatDateRange(leave.start_date, leave.end_date);
  const duration = leaveDuration(leave);
  const need = [duration, formatLeaveTypeLabel(leave.leave_type)].filter(Boolean).join(' ');
  return {
    key: `leave-${leave.id}`,
    source: 'leave',
    sourceId: leave.id,
    category: leaveCategory(leave),
    bucket: status === 'rejected' ? 'rejected' : status === 'approved' ? 'approved' : 'pending',
    person: formatEmployeeDisplay(leave),
    secondary: leave.employee_department || leave.employee_username || '',
    need: need || 'Leave request',
    when: dates || formatWhen(leave.requested_at || leave.created_at),
    requestedLabel: formatWhen(leave.requested_at || leave.created_at),
    reason: leave.reason || '',
    sortPending: timeValue(leave.requested_at || leave.created_at),
    sortProcessed: timeValue(leave.processed_at || leave.updated_at),
    raw: leave,
  };
}

function toWorkModeItem(request) {
  const bucket = workModeBucket(request);
  const from = formatWorkMode(request.current_work_mode);
  const to = formatWorkMode(request.requested_work_mode);
  return {
    key: `work-mode-${request.id}`,
    source: 'work_mode',
    sourceId: request.id,
    category: 'remote_work',
    bucket,
    person: request.employee?.name || request.employee?.username || request.employee_uid || 'Employee',
    secondary: request.employee?.department || request.employee_department || '',
    need: `${from} → ${to}`,
    when: formatWhen(request.requested_at || request.created_at),
    requestedLabel: formatWhen(request.requested_at || request.created_at),
    reason: request.reason || '',
    sortPending: timeValue(request.requested_at || request.created_at),
    sortProcessed: timeValue(request.processed_at || request.updated_at || request.created_at),
    raw: request,
  };
}

export function ApprovalWorkflowsPage() {
  const { user } = useAuthStore();
  const [leaves, setLeaves] = useState([]);
  const [workModes, setWorkModes] = useState([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bucket, setBucket] = useState('pending');
  const [typeFilter, setTypeFilter] = useState('all');
  const [activeItem, setActiveItem] = useState(null);
  const [busyKey, setBusyKey] = useState('');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectNote, setRejectNote] = useState('');

  const [workflows, setWorkflows] = useState([]);
  const [selectedType, setSelectedType] = useState('annual_leave');
  const [steps, setSteps] = useState([]);
  const [workflowLoading, setWorkflowLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [message, setMessage] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [organizationRoles, setOrganizationRoles] = useState([]);
  const [workflowDepartmentId, setWorkflowDepartmentId] = useState('');
  const [workflowActive, setWorkflowActive] = useState(true);

  const canApproveLeave = hasPermission(user, PERMISSIONS.APPROVE_LEAVE);
  const canRejectLeave = hasPermission(user, PERMISSIONS.REJECT_LEAVE);
  const canApproveWorkMode = hasPermission(user, PERMISSIONS.APPROVE_WORK_MODE);
  const canRejectWorkMode = hasPermission(user, PERMISSIONS.REJECT_WORK_MODE);

  const loadInbox = useCallback(async (silent = false) => {
    if (!silent) setInboxLoading(true);
    if (!silent) setError('');
    try {
      const [leaveRows, workModeRows] = await Promise.all([
        adminService.getLeaves().catch(() => []),
        adminService.getWorkModeRequests().catch(() => []),
      ]);
      setLeaves(leaveRows || []);
      setWorkModes(workModeRows || []);
    } catch (err) {
      if (!silent) setError(err?.message || 'Failed to load requests');
    } finally {
      if (!silent) setInboxLoading(false);
    }
  }, []);

  const loadWorkflows = useCallback(async () => {
    setWorkflowLoading(true);
    try {
      const [data, departmentRows, roleRows] = await Promise.all([
        adminService.getApprovalWorkflows(),
        adminService.getDepartments().catch(() => []),
        adminService.getOrganizationRoles().catch(() => []),
      ]);
      setWorkflows(data || []);
      setDepartments(departmentRows || []);
      setOrganizationRoles(roleRows || []);
      const current = (data || []).find((w) => w.request_type === selectedType && String(w.department_id || '') === workflowDepartmentId);
      setWorkflowDepartmentId(String(current?.department_id || ''));
      setWorkflowActive(current?.is_active !== false);
      setSteps(current?.steps?.map((s, i) => ({
        ...s,
        step_order: i + 1,
        authority_type: s.authority_type || (s.required_permission_key ? 'PERMISSION' : 'LEGACY_ROLE'),
        required_scope_type: s.required_scope_type || 'DEPARTMENT',
      })) || []);
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setWorkflowLoading(false);
    }
  }, [selectedType, workflowDepartmentId]);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  useSilentPoll(loadInbox, 30000);

  useEffect(() => {
    const current = workflows.find((w) => w.request_type === selectedType && String(w.department_id || '') === workflowDepartmentId);
    if (current) {
      setWorkflowActive(current.is_active !== false);
      setSteps(current.steps?.map((s, i) => ({
        ...s,
        step_order: i + 1,
        authority_type: s.authority_type || (s.required_permission_key ? 'PERMISSION' : 'LEGACY_ROLE'),
        required_scope_type: s.required_scope_type || 'DEPARTMENT',
      })) || []);
    }
  }, [selectedType, workflows, workflowDepartmentId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const items = useMemo(() => {
    const list = [...leaves.map(toLeaveItem), ...workModes.map(toWorkModeItem)];
    return list.filter((item) => typeFilter === 'all' || item.category === typeFilter);
  }, [leaves, workModes, typeFilter]);

  const grouped = useMemo(() => {
    const pending = items.filter((item) => item.bucket === 'pending').sort((a, b) => a.sortPending - b.sortPending);
    const approved = items
      .filter((item) => item.bucket === 'approved' && isRecent(item.sortProcessed))
      .sort((a, b) => b.sortProcessed - a.sortProcessed);
    const rejected = items
      .filter((item) => item.bucket === 'rejected' && isRecent(item.sortProcessed))
      .sort((a, b) => b.sortProcessed - a.sortProcessed);
    return { pending, approved, rejected };
  }, [items]);

  const visible = grouped[bucket] || [];
  const counts = {
    pending: grouped.pending.length,
    approved: grouped.approved.length,
    rejected: grouped.rejected.length,
  };

  useEffect(() => {
    if (!activeItem?.key) return;
    setActiveItem((current) => {
      if (!current) return current;
      return items.find((item) => item.key === current.key) || null;
    });
  }, [items]);

  const canApproveItem = (item) => (item.source === 'leave' ? canApproveLeave : canApproveWorkMode);
  const canRejectItem = (item) => (item.source === 'leave' ? canRejectLeave : canRejectWorkMode);

  const processItem = async (item, status, adminNotes = '') => {
    setBusyKey(item.key);
    setError('');
    try {
      const payload = { status };
      if (adminNotes) payload.admin_notes = adminNotes;
      if (item.source === 'leave') {
        await adminService.processLeave(item.sourceId, payload);
      } else {
        await adminService.processWorkModeRequest(item.sourceId, payload);
      }
      setNotice(status === 'approved' ? 'Approved.' : 'Rejected.');
      setRejectTarget(null);
      setRejectNote('');
      setActiveItem((current) => (current?.key === item.key ? null : current));
      await loadInbox(true);
    } catch (err) {
      setError(err?.message || 'Failed to process request');
    } finally {
      setBusyKey('');
    }
  };

  const openRow = (event, item) => {
    if (event.target.closest('button, input, a, [data-row-action]')) return;
    setActiveItem(item);
  };

  function addStep() {
    setSteps((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        step_order: prev.length + 1,
        step_label: 'Approver',
        approver_role: 'department_manager',
        authority_type: 'LEGACY_ROLE',
        required_permission_key: 'approve_leave',
        required_scope_type: 'DEPARTMENT',
        department_id: '',
        organization_role_id: '',
      },
    ]);
  }

  function removeStep(index) {
    setSteps((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_order: i + 1 })));
  }

  function moveStep(from, to) {
    if (from === to || to < 0 || to >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next.map((s, i) => ({ ...s, step_order: i + 1 }));
    });
  }

  async function handleSave() {
    if (!steps.length) {
      setMessage({ ok: false, text: 'Add at least one approval step.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await adminService.updateApprovalWorkflow(selectedType, {
        name: REQUEST_TYPE_LABELS[selectedType],
        department_id: workflowDepartmentId || null,
        is_active: workflowActive,
        steps: steps.map((s) => ({
          step_order: s.step_order,
          step_label: s.step_label,
          approver_role: s.approver_role,
          authority_type: s.authority_type || 'LEGACY_ROLE',
          organization_role_id: s.organization_role_id || null,
          required_permission_key: s.authority_type === 'LEGACY_ROLE' ? null : s.required_permission_key,
          required_scope_type: s.authority_type === 'LEGACY_ROLE' ? null : s.required_scope_type,
          department_id: s.authority_type === 'LEGACY_ROLE' || s.required_scope_type !== 'DEPARTMENT' ? null : (s.department_id || workflowDepartmentId || null),
        })),
      });
      setMessage({ ok: true, text: 'Workflow saved.' });
      await loadWorkflows();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="approvals-directory admin-page gap-4 animate-fade-up">
      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type="success">{notice}</Alert>}

      <div className="filter-action-bar">
        <div className="ui-segment" role="tablist" aria-label="Approval inbox">
          {BUCKETS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={bucket === item.id}
              onClick={() => setBucket(item.id)}
              className={`ui-segment-item ${bucket === item.id ? 'ui-segment-item-active' : ''}`}
            >
              {item.label}
              <span className="ml-1 tabular-nums text-slate-400">{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by request type" size="sm" className="w-auto min-w-[10rem]">
          <option value="all">All types</option>
          {Object.entries(REQUEST_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
        <GlassTable
          className="rounded-none border-0 shadow-none"
          loading={inboxLoading}
          skeletonRows={6}
          emptyTitle={bucket === 'pending' ? "You're caught up" : 'Nothing here'}
          emptyMessage={
            bucket === 'pending'
              ? 'New leave and work-mode requests will appear here.'
              : 'No matching requests in the last 14 days.'
          }
          columns={[
            { key: 'who', label: 'Requester' },
            { key: 'what', label: 'Request' },
            { key: 'when', label: 'When' },
            { key: 'why', label: 'Why' },
            { key: 'status', label: 'Status' },
            { key: 'actions', label: <span className="sr-only">Actions</span>, className: 'w-44' },
          ]}
        >
          {visible.map((item) => {
            const pending = item.bucket === 'pending';
            return (
              <TableRow
                key={item.key}
                onClick={(event) => openRow(event, item)}
                className={pending ? 'approval-row-pending' : ''}
              >
                <TableCell>
                  <TableIdentity size="sm" name={item.person} secondary={item.secondary} />
                </TableCell>
                <TableCell>
                  <p className="text-sm text-slate-800">{item.need}</p>
                  <p className="text-xs text-slate-400">{REQUEST_TYPE_LABELS[item.category]}</p>
                </TableCell>
                <TableCell className="text-sm tabular-nums text-slate-600">{item.when || '—'}</TableCell>
                <TableCell className="max-w-[14rem] truncate text-sm text-slate-500">{item.reason || '—'}</TableCell>
                <TableCell>
                  <QuietStatus status={item.bucket} />
                </TableCell>
                <TableCell>
                  <span data-row-action className="flex items-center justify-end gap-1">
                    {pending && canApproveItem(item) && (
                      <button
                        type="button"
                        disabled={busyKey === item.key}
                        onClick={() => processItem(item, 'approved')}
                        className="ui-btn-success ui-btn-sm"
                      >
                        Approve
                      </button>
                    )}
                    {pending && canRejectItem(item) && (
                      <button
                        type="button"
                        disabled={busyKey === item.key}
                        onClick={() => {
                          setRejectTarget(item);
                          setRejectNote('');
                        }}
                        className="ui-btn-danger ui-btn-sm"
                      >
                        Reject
                      </button>
                    )}
                    {(!pending || (!canApproveItem(item) && !canRejectItem(item))) && (
                      <TableActions
                        label={`Open ${item.person}`}
                        items={[{ label: 'View details', onClick: () => setActiveItem(item) }]}
                      />
                    )}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </GlassTable>
      </div>

      <details className="approvals-chains rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">Approval chains</summary>
        <div className="space-y-4 border-t border-slate-100 px-4 py-4">
          <p className="text-sm text-slate-500">Configure multi-level approval chains per request type. Drag steps to reorder.</p>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={workflowActive} onChange={(event) => setWorkflowActive(event.target.checked)} /> Workflow active for newly initialized requests</label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(REQUEST_TYPE_LABELS).map(([type, label]) => (
              <button
                key={type}
                type="button"
                onClick={() => setSelectedType(type)}
                aria-pressed={selectedType === type}
                className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                  selectedType === type
                    ? 'border-slate-200 bg-slate-50 font-semibold text-slate-900'
                    : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {message && (
            <Alert type={message.ok ? 'success' : 'error'} onDismiss={() => setMessage(null)}>
              {message.text}
            </Alert>
          )}

          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{REQUEST_TYPE_LABELS[selectedType]} chain</h2>
            <Select
              value={workflowDepartmentId}
              onChange={(e) => {
                setWorkflowDepartmentId(e.target.value);
                const current = workflows.find((w) => w.request_type === selectedType && String(w.department_id || '') === e.target.value);
                setSteps(current?.steps?.map((s, i) => ({
                  ...s,
                  step_order: i + 1,
                  authority_type: s.authority_type || (s.required_permission_key ? 'PERMISSION' : 'LEGACY_ROLE'),
                  required_scope_type: s.required_scope_type || 'DEPARTMENT',
                })) || []);
              }}
              className="w-auto min-w-[12rem]"
              aria-label="Workflow department"
            >
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </Select>
            <button type="button" onClick={addStep} className="ui-btn-secondary ui-btn-sm">
              Add step
            </button>
          </div>

          {workflowLoading ? (
            <p className="text-sm text-slate-500">Loading chain…</p>
          ) : steps.length === 0 ? (
            <EmptyStateBody
              size="sm"
              icon={ListChecks}
              title="No approval steps yet"
              description="Add the approvers this request type has to pass through, in order. Saving with none loads the defaults."
              action={
                <button type="button" onClick={addStep} className="ui-btn-secondary ui-btn-sm">
                  Add first step
                </button>
              }
              className="py-6"
            />
          ) : (
            <ul className="space-y-2">
              {steps.map((step, index) => (
                <li
                  key={step.id || index}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    moveStep(dragIndex, index);
                    setDragIndex(null);
                  }}
                  className="flex cursor-grab flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 active:cursor-grabbing"
                >
                  <span className="w-8 text-xs font-semibold text-slate-400">#{index + 1}</span>
                  <input
                    value={step.step_label}
                    onChange={(e) => setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, step_label: e.target.value } : s)))}
                    className="ui-input min-w-[120px] flex-1"
                    placeholder="Step label"
                  />
                  <Select
                    value={step.authority_type || 'LEGACY_ROLE'}
                    onChange={(e) => setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, authority_type: e.target.value } : s)))}
                    className="w-auto"
                  >
                    {Object.entries(AUTHORITY_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                  {(step.authority_type || 'LEGACY_ROLE') === 'LEGACY_ROLE' ? (
                    <Select
                      value={step.approver_role || 'department_manager'}
                      onChange={(e) => setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, approver_role: e.target.value } : s)))}
                      className="w-auto"
                    >
                      {Object.entries(APPROVER_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select>
                  ) : (
                    <>
                      {(step.authority_type === 'ORGANIZATION_ROLE') && (
                        <Select
                          value={step.organization_role_id || ''}
                          onChange={(e) => setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, organization_role_id: e.target.value } : s)))}
                          className="w-auto min-w-[10rem]"
                        >
                          <option value="">Organization role</option>
                          {organizationRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                        </Select>
                      )}
                      <Select
                        value={step.required_permission_key || 'approve_leave'}
                        onChange={(e) => setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, required_permission_key: e.target.value } : s)))}
                        className="w-auto"
                      >
                        {APPROVAL_PERMISSION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </Select>
                      <Select
                        value={step.required_scope_type || 'DEPARTMENT'}
                        onChange={(e) => setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, required_scope_type: e.target.value } : s)))}
                        className="w-auto"
                      >
                        {APPROVAL_SCOPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </Select>
                      {step.required_scope_type === 'DEPARTMENT' && (
                        <Select
                          value={step.department_id || workflowDepartmentId || ''}
                          onChange={(e) => setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, department_id: e.target.value } : s)))}
                          className="w-auto min-w-[10rem]"
                        >
                          <option value="">Department</option>
                          {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                        </Select>
                      )}
                    </>
                  )}
                  <button type="button" onClick={() => removeStep(index)} className="text-xs font-medium text-rose-500 hover:text-rose-600">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {steps.some((step) => step.eligibility_warning || step.eligible_approver_count === 0) && (
            <Alert type="warning">
              One or more steps currently has no eligible approver. Requests will remain pending until the required role, permission, scope, and department configuration is satisfied.
            </Alert>
          )}

          <button type="button" onClick={handleSave} disabled={saving} className="ui-btn-primary ui-btn-sm">
            {saving ? 'Saving…' : 'Save workflow'}
          </button>
        </div>
      </details>

      <SlideOverPanel open={Boolean(activeItem)} onClose={() => setActiveItem(null)}>
        {activeItem && (
          <div className="flex h-full flex-col">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[17px] font-semibold tracking-tight text-slate-900">{activeItem.person}</p>
                  <p className="mt-1 text-sm text-slate-500">{activeItem.need}</p>
                </div>
                <button type="button" onClick={() => setActiveItem(null)} className="ui-btn-ghost ui-btn-sm">
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              <dl>
                <DetailField label="Requester">{activeItem.person}</DetailField>
                <DetailField label="Request type">{REQUEST_TYPE_LABELS[activeItem.category]}</DetailField>
                <DetailField label="Details">{activeItem.need}</DetailField>
                {activeItem.source === 'leave' && (
                  <>
                    <DetailField label="Dates">{formatDateRange(activeItem.raw.start_date, activeItem.raw.end_date) || '—'}</DetailField>
                    <DetailField label="Duration">{leaveDuration(activeItem.raw) || '—'}</DetailField>
                  </>
                )}
                {activeItem.source === 'work_mode' && (
                  <>
                    <DetailField label="Current">{formatWorkMode(activeItem.raw.current_work_mode)}</DetailField>
                    <DetailField label="Requested">{formatWorkMode(activeItem.raw.requested_work_mode)}</DetailField>
                  </>
                )}
                <DetailField label="When">{activeItem.when || activeItem.requestedLabel || '—'}</DetailField>
                <DetailField label="Why">{activeItem.reason || '—'}</DetailField>
                <DetailField label="Status">
                  <QuietStatus status={activeItem.bucket} />
                </DetailField>
              </dl>

              <ApprovalHistory item={activeItem} />
            </div>
            {activeItem.bucket === 'pending' && (canApproveItem(activeItem) || canRejectItem(activeItem)) && (
              <div className="mt-auto flex justify-end gap-2 border-t border-slate-200 p-5">
                {canRejectItem(activeItem) && (
                  <button
                    type="button"
                    className="ui-btn-danger ui-btn-sm"
                    disabled={busyKey === activeItem.key}
                    onClick={() => {
                      setRejectTarget(activeItem);
                      setRejectNote('');
                    }}
                  >
                    Reject
                  </button>
                )}
                {canApproveItem(activeItem) && (
                  <button
                    type="button"
                    className="ui-btn-success ui-btn-sm"
                    disabled={busyKey === activeItem.key}
                    onClick={() => processItem(activeItem, 'approved')}
                  >
                    {busyKey === activeItem.key ? 'Saving…' : 'Approve'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </SlideOverPanel>

      <Dialog
        open={Boolean(rejectTarget)}
        onClose={() => (busyKey ? null : setRejectTarget(null))}
        title="Reject this request?"
        description={rejectTarget ? `${rejectTarget.person} · ${rejectTarget.need}` : ''}
        footer={
          <>
            <button type="button" className="ui-btn-secondary ui-btn-sm" disabled={Boolean(busyKey)} onClick={() => setRejectTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="ui-btn-danger ui-btn-sm"
              disabled={Boolean(busyKey)}
              onClick={() => processItem(rejectTarget, 'rejected', rejectNote.trim())}
            >
              {busyKey ? 'Rejecting…' : 'Reject request'}
            </button>
          </>
        }
      >
        <label className="block space-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.06em] text-slate-400">Note (optional)</span>
          <input
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Add a short reason"
            className="ui-input"
          />
        </label>
      </Dialog>
    </div>
  );
}

function ApprovalHistory({ item }) {
  const progress = item.raw?.approvalProgress || [];
  const hasLeaveTrail = item.source === 'leave' && (item.raw.current_step || item.raw.processed_by || item.raw.admin_notes);
  if (!progress.length && !hasLeaveTrail) return null;
  return (
    <div className="mt-5">
      <p className="text-xs font-medium uppercase tracking-[0.06em] text-slate-400">Approval history</p>
      {progress.length > 0 ? (
        <ul className="mt-1 divide-y divide-slate-100">
          {progress.map((step) => (
            <li key={step.id || `${step.step_label}-${step.step_order}`} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-sm text-slate-700">{step.step_label || `Step ${step.step_order}`}</span>
              <QuietStatus status={normalizeStatus(step.action) === 'in_review' ? 'pending' : normalizeStatus(step.action)} />
            </li>
          ))}
        </ul>
      ) : (
        <dl className="mt-1">
          {item.raw.current_step ? <DetailField label="Step">{item.raw.current_step}</DetailField> : null}
          {item.raw.processed_by ? <DetailField label="Processed by">{item.raw.processed_by}</DetailField> : null}
          {item.raw.admin_notes ? <DetailField label="Notes">{item.raw.admin_notes}</DetailField> : null}
        </dl>
      )}
    </div>
  );
}

function QuietStatus({ status }) {
  const meta = {
    pending: { label: 'Pending', dot: 'bg-amber-500' },
    approved: { label: 'Approved', dot: 'bg-emerald-500' },
    rejected: { label: 'Rejected', dot: 'bg-slate-300' },
  }[status] || { label: status, dot: 'bg-slate-300' };
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
      {meta.label}
    </span>
  );
}

function DetailField({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <dt className="shrink-0 text-xs font-medium text-slate-400">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-slate-800">{children || '—'}</dd>
    </div>
  );
}
