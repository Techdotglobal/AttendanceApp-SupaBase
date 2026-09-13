import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Ticket, UserCheck } from 'lucide-react';
import { adminService } from '../services/adminService';
import { hasPermission, PERMISSIONS } from '../permissions';
import { useAuthStore } from '../../auth/store/authStore';
import { useSilentPoll, useSessionState } from '../../../shared/hooks/useSilentPoll';
import { useNotificationStore } from '../../notifications/store/notificationStore';
import {
  GlassTable,
  TableCell,
  TableIdentity,
  TableRow,
} from '../../../shared/components/GlassTable';
import { Alert } from '../../../shared/components/ui/Alert';
import { Dialog } from '../../../shared/components/ui/Dialog';
import { Select } from '../../../shared/components/ui/Select';
import { EmptyStateBody } from '../../../shared/components/ui/EmptyState';
import { PageActions } from '../../../shared/components/pageChrome';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'closed', label: 'Closed' },
];

const emptyForm = { category: '', priority: 'medium', subject: '', description: '' };

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function titleCase(value) {
  const text = String(value || '').replace(/_/g, ' ').trim();
  if (!text) return '—';
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortTicketId(id) {
  const raw = String(id || '').replace(/-/g, '');
  if (!raw) return '—';
  return raw.slice(0, 8).toUpperCase();
}

function statusLabel(status) {
  const value = normalize(status);
  if (value === 'closed' || value === 'resolved') return 'Resolved';
  if (value === 'in_progress') return 'In Progress';
  return titleCase(value);
}

function isSettledStatus(status) {
  const value = normalize(status);
  return value === 'closed' || value === 'resolved';
}

function priorityTone(priority) {
  const value = normalize(priority);
  if (value === 'urgent') return 'urgent';
  if (value === 'high') return 'high';
  if (value === 'medium') return 'medium';
  return 'neutral';
}

function formatWhen(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatRelative(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function personFrom(users, username, uid) {
  return (
    users.find((row) => (uid && row.uid === uid) || (username && row.username === username)) || null
  );
}

function displayName(person, fallback) {
  return person?.name || fallback || 'Someone';
}

function categoryLabel(ticket, departments) {
  if (ticket?.category_name) return ticket.category_name;
  const raw = ticket?.category;
  if (raw == null || raw === '') return 'Uncategorised';
  const hit = departments.find(
    (dept) => String(dept.id) === String(raw) || normalize(dept.name) === normalize(raw)
  );
  return hit?.name || String(raw);
}

function ticketUpdatedAt(ticket) {
  return ticket?.updated_at || ticket?.updatedAt || ticket?.created_at || ticket?.createdAt || '';
}

function ticketResponses(ticket) {
  const rows = ticket?.responses;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      id: row.id || `${row.createdAt || row.created_at}-${row.respondedBy || row.responded_by}`,
      by: row.respondedBy || row.responded_by || 'Colleague',
      message: row.message || row.body || '',
      at: row.createdAt || row.created_at || '',
    }))
    .filter((row) => row.message)
    .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
}

export function TicketsPage() {
  const { user } = useAuthStore();
  const refreshBadge = useNotificationStore((s) => s.refresh);
  const [tickets, setTickets] = useState([]);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedId, setSelectedId] = useSessionState('tickets:selected', '');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [assignTo, setAssignTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [requesterFilter, setRequesterFilter] = useState('all');
  const [closeTarget, setCloseTarget] = useState(null);
  const historyRef = useRef(null);

  const canManage = hasPermission(user, PERMISSIONS.MANAGE_TICKETS);
  const canAssign = hasPermission(user, PERMISSIONS.ASSIGN_TICKETS);
  const canClose = hasPermission(user, PERMISSIONS.CLOSE_TICKETS);
  const assignableUsers = users.filter((row) => row.role !== 'employee');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [ticketData, userData, deptData] = await Promise.all([
        adminService.getTickets(),
        adminService.getUsers().catch(() => []),
        adminService.getDepartments().catch(() => []),
      ]);
      setTickets(ticketData || []);
      setUsers((userData || []).filter((row) => row.is_active !== false));
      setDepartments(deptData || []);
    } catch (err) {
      if (!silent) setError(err.message || 'Failed to load tickets');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useSilentPoll(load, 30000, []);

  useEffect(() => {
    setAssignTo('');
  }, [selectedId]);

  useEffect(() => {
    if (!success) return undefined;
    const timer = setTimeout(() => setSuccess(''), 2500);
    return () => clearTimeout(timer);
  }, [success]);

  const selected = tickets.find((ticket) => ticket.id === selectedId) || null;
  const requester = selected
    ? personFrom(users, selected.created_by, selected.created_by_uid)
    : null;
  const assignee = selected ? personFrom(users, selected.assigned_to) : null;

  const requesterOptions = useMemo(() => {
    const seen = new Map();
    for (const ticket of tickets) {
      const key = ticket.created_by || ticket.created_by_uid;
      if (!key || seen.has(key)) continue;
      const person = personFrom(users, ticket.created_by, ticket.created_by_uid);
      seen.set(key, displayName(person, ticket.created_by));
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [tickets, users]);

  const categoryOptions = useMemo(() => {
    const seen = new Map();
    for (const dept of departments) {
      seen.set(String(dept.id), dept.name);
    }
    for (const ticket of tickets) {
      const key = String(ticket.category || '');
      if (!key || seen.has(key)) continue;
      seen.set(key, categoryLabel(ticket, departments));
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [tickets, departments]);

  const filtered = useMemo(() => {
    return tickets.filter((ticket) => {
      const status = normalize(ticket.status || 'open');
      const priority = normalize(ticket.priority);
      const category = String(ticket.category || '');
      const requesterKey = ticket.created_by || ticket.created_by_uid || '';
      const byStatus = statusFilter === 'all' || status === statusFilter;
      const byPriority = priorityFilter === 'all' || priority === priorityFilter;
      const byCategory = categoryFilter === 'all' || category === categoryFilter;
      const byRequester = requesterFilter === 'all' || requesterKey === requesterFilter;
      return byStatus && byPriority && byCategory && byRequester;
    });
  }, [tickets, statusFilter, priorityFilter, categoryFilter, requesterFilter]);

  const responses = ticketResponses(selected);

  async function handleCreate(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const created = await adminService.createTicket({
        ...form,
        category: form.category || departments[0]?.id || '',
      });
      setSuccess('Ticket created.');
      setShowCreate(false);
      setForm(emptyForm);
      setSelectedId(created.id);
      await load(true);
      await refreshBadge();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(username) {
    const assignee = username || assignTo;
    if (!selected || !assignee) return;
    setBusy(true);
    setError('');
    try {
      await adminService.assignTicket(selected.id, assignee);
      setSuccess('Ticket assigned.');
      setAssignTo('');
      await load(true);
      await refreshBadge();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    if (!closeTarget) return;
    setBusy(true);
    setError('');
    try {
      await adminService.closeTicket(closeTarget.id);
      setSuccess('Ticket resolved.');
      setCloseTarget(null);
      await load(true);
      await refreshBadge();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await adminService.reopenTicket(selected.id);
      setSuccess('Ticket reopened.');
      await load(true);
      await refreshBadge();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const directoryEmpty = !loading && tickets.length === 0;
  const settled = isSettledStatus(selected?.status);
  const assigneeName = selected?.assigned_to ? displayName(assignee, selected.assigned_to) : '';

  return (
    <div className="tickets-directory admin-page admin-page-locked gap-4 animate-fade-up">
      {canManage && (
        <PageActions>
          <button
            type="button"
            onClick={() => setShowCreate((value) => !value)}
            className="ui-btn-primary ui-btn-sm"
          >
            {showCreate ? 'Cancel' : 'New ticket'}
          </button>
        </PageActions>
      )}

      {error && <Alert type="error">{error}</Alert>}
      {success && (
        <Alert type="success" onDismiss={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <div className="filter-action-bar">
        <div className="ui-segment" role="tablist" aria-label="Ticket status">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={statusFilter === item.id}
              onClick={() => setStatusFilter(item.id)}
              className={`ui-segment-item ${statusFilter === item.id ? 'ui-segment-item-active' : ''}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <Select
          size="sm"
          value={priorityFilter}
          onChange={(event) => setPriorityFilter(event.target.value)}
          aria-label="Filter by priority"
          className="w-auto min-w-[9.5rem]"
        >
          <option value="all">All priorities</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {titleCase(priority)}
            </option>
          ))}
        </Select>
        <Select
          size="sm"
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          aria-label="Filter by category"
          className="w-auto min-w-[10rem]"
        >
          <option value="all">All categories</option>
          {categoryOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          size="sm"
          value={requesterFilter}
          onChange={(event) => setRequesterFilter(event.target.value)}
          aria-label="Filter by requester"
          className="w-auto min-w-[10.5rem]"
        >
          <option value="all">All requesters</option>
          {requesterOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <p className="text-xs tabular-nums text-slate-400">
          {filtered.length} {filtered.length === 1 ? 'ticket' : 'tickets'}
        </p>
        </div>
      </div>

      <div className="tickets-workspace admin-fill grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
        <section className="tickets-table-card min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-white">
          {directoryEmpty ? (
            <EmptyStateBody
              icon={Ticket}
              title="Nothing in the queue"
              description="When someone needs help with leave, access or a day-to-day issue, it will land here."
              action={
                canManage ? (
                  <button type="button" onClick={() => setShowCreate(true)} className="ui-btn-primary ui-btn-sm">
                    New ticket
                  </button>
                ) : null
              }
              className="px-6 py-16"
            />
          ) : (
            <GlassTable
              className="rounded-none border-0 shadow-none"
              fillsAvailableHeight
              loading={loading}
              skeletonRows={6}
              emptyTitle="No matching tickets"
              emptyMessage="Try a different status, priority, category or requester."
              columns={[
                { key: 'id', label: 'Ticket', className: 'w-24' },
                { key: 'subject', label: 'Subject' },
                { key: 'requester', label: 'Requester' },
                { key: 'category', label: 'Category' },
                { key: 'priority', label: 'Priority' },
                { key: 'status', label: 'Status' },
                { key: 'updated', label: 'Updated', className: 'w-28' },
              ]}
            >
              {filtered.map((ticket) => {
                const person = personFrom(users, ticket.created_by, ticket.created_by_uid);
                const status = normalize(ticket.status || 'open');
                const priority = normalize(ticket.priority);
                return (
                  <TableRow
                    key={ticket.id}
                    selected={ticket.id === selectedId}
                    onClick={() => {
                      setSelectedId(ticket.id);
                      setShowCreate(false);
                    }}
                    className={priority === 'urgent' && !isSettledStatus(status) ? 'ticket-row-urgent' : ''}
                  >
                    <TableCell className="whitespace-nowrap font-mono text-xs text-slate-500" title={String(ticket.id)}>
                      {shortTicketId(ticket.id)}
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      <span className="block truncate text-sm text-slate-800">{ticket.subject || 'Untitled request'}</span>
                    </TableCell>
                    <TableCell>
                      <TableIdentity
                        size="sm"
                        name={displayName(person, ticket.created_by)}
                        secondary={person?.department || ticket.created_by}
                      />
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{categoryLabel(ticket, departments)}</TableCell>
                    <TableCell>
                      <QuietMark label={titleCase(ticket.priority)} tone={priorityTone(ticket.priority)} />
                    </TableCell>
                    <TableCell>
                      <QuietMark label={statusLabel(status)} tone={statusTone(status)} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500" title={formatWhen(ticketUpdatedAt(ticket))}>
                      {formatRelative(ticketUpdatedAt(ticket))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </GlassTable>
          )}
        </section>

        <aside className="tickets-pane flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          {showCreate && canManage ? (
            <form onSubmit={handleCreate} className="flex h-full flex-col">
              <div className="border-b border-slate-200 px-5 py-4">
                <p className="text-[17px] font-semibold tracking-tight text-slate-900">New ticket</p>
                <p className="mt-1 text-sm text-slate-500">Capture the question so the right person can follow it.</p>
              </div>
              <div className="space-y-3 px-5 py-4">
                <Select
                  required
                  value={form.category}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                  aria-label="Department"
                >
                  <option value="">Department</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </Select>
                <Select
                  value={form.priority}
                  onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
                  aria-label="Priority"
                >
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {titleCase(priority)}
                    </option>
                  ))}
                </Select>
                <input
                  required
                  placeholder="What do they need?"
                  value={form.subject}
                  onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
                  className="ui-input w-full"
                />
                <textarea
                  required
                  rows={5}
                  placeholder="Add a little context so the next person doesn’t have to chase it."
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="ui-textarea w-full"
                />
              </div>
              <div className="border-t border-slate-100 px-5 py-4">
                <button type="submit" disabled={busy} className="ui-btn-primary">
                  {busy ? 'Creating…' : 'Create Ticket'}
                </button>
              </div>
            </form>
          ) : !selected ? (
            <div className="flex flex-1 flex-col justify-center px-6 py-10">
              <p className="text-[17px] font-semibold tracking-tight text-slate-900">Start with a person</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Open a ticket to see who asked, what they need, and how the thread has unfolded.
              </p>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-200 px-5 py-4">
                <TicketIdPill id={selected.id} />
                <h2 className="mt-2 text-[17px] font-semibold tracking-tight text-slate-900">{selected.subject}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                  <QuietMark
                    label={statusLabel(selected.status)}
                    tone={statusTone(normalize(selected.status))}
                    size="sm"
                  />
                  <span className="text-slate-300" aria-hidden>
                    ·
                  </span>
                  <QuietMark
                    label={titleCase(selected.priority)}
                    tone={priorityTone(selected.priority)}
                    size="sm"
                  />
                  <span className="text-slate-300" aria-hidden>
                    ·
                  </span>
                  <span className="font-medium text-slate-500">{categoryLabel(selected, departments)}</span>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4" data-lenis-prevent>
                <div className="flex items-start gap-3">
                  <span className="tickets-avatar" aria-hidden>
                    {initialsOf(displayName(requester, selected.created_by))}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {displayName(requester, selected.created_by)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {[requester?.department, requester?.email || selected.created_by, formatWhen(selected.created_at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </div>

                <article className="tickets-bubble">
                  <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">Original request</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                    {selected.description || 'No details were added.'}
                  </p>
                </article>

                {assigneeName && (
                  <div className="flex items-center gap-2.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-50 text-[10px] font-semibold uppercase text-sky-600">
                      {initialsOf(assigneeName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Assigned to</p>
                      <p className="truncate text-sm font-medium text-slate-700">{assigneeName}</p>
                    </div>
                    <UserCheck className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
                  </div>
                )}

                <div ref={historyRef} id="ticket-history" className="space-y-3">
                  {responses.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">Conversation</p>
                      {responses.map((entry) => {
                        const author = personFrom(users, entry.by);
                        const mine = entry.by && user?.username && entry.by === user.username;
                        return (
                          <article key={entry.id} className={`tickets-bubble ${mine ? 'is-mine' : ''}`}>
                            <div className="flex items-baseline justify-between gap-3">
                              <p className="text-sm font-medium text-slate-800">{displayName(author, entry.by)}</p>
                              <p className="shrink-0 text-[11px] text-slate-400">{formatRelative(entry.at)}</p>
                            </div>
                            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{entry.message}</p>
                          </article>
                        );
                      })}
                    </div>
                  )}

                  {selected.closed_at && (
                    <p className="tickets-event">Resolved {formatWhen(selected.closed_at)}</p>
                  )}
                </div>
              </div>

              <div className="tickets-actions">
                {!settled && (canAssign || canClose) && (
                  <div className="flex flex-col gap-3">
                    {canAssign && (
                      <div>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Assign to
                        </p>
                        <Select
                          value={assignTo}
                          onChange={(event) => {
                            const next = event.target.value;
                            setAssignTo(next);
                            if (next) handleAssign(next);
                          }}
                          size="sm"
                          className="w-full"
                          aria-label="Assign ticket"
                          disabled={busy}
                        >
                          <option value="">Select a person</option>
                          {assignableUsers.map((row) => (
                            <option key={row.uid} value={row.username}>
                              {row.name || row.username}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                    {canClose && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setCloseTarget(selected)}
                        className="ui-btn-primary ui-btn-sm"
                      >
                        Resolve Ticket
                      </button>
                    )}
                  </div>
                )}
                {settled && canClose && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleReopen}
                    className="flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {busy ? 'Reopening…' : 'Reopen Ticket'}
                  </button>
                )}
                {settled && !canClose && (
                  <p className="text-sm text-slate-500">This ticket is resolved.</p>
                )}
                <button
                  type="button"
                  onClick={() => historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
                  className="text-left text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
                >
                  Ticket History
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      <Dialog
        open={Boolean(closeTarget)}
        onClose={() => !busy && setCloseTarget(null)}
        title="Resolve this ticket?"
        description="We’ll mark it resolved and let the requester know you’re done."
        footer={
          <>
            <button type="button" className="ui-btn-secondary" disabled={busy} onClick={() => setCloseTarget(null)}>
              Keep open
            </button>
            <button type="button" className="ui-btn-primary" disabled={busy} onClick={handleClose}>
              {busy ? 'Resolving…' : 'Resolve ticket'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {closeTarget?.subject ? `“${closeTarget.subject}” will leave the open queue.` : 'This request will leave the open queue.'}
        </p>
      </Dialog>
    </div>
  );
}

function TicketIdPill({ id }) {
  const [copied, setCopied] = useState(false);
  const label = shortTicketId(id);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(id || label));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied' : 'Copy ticket ID'}
      className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 hover:bg-slate-200/80"
    >
      {label}
      {copied ? (
        <Check className="h-3 w-3" strokeWidth={2.25} aria-hidden />
      ) : (
        <Copy className="h-3 w-3" strokeWidth={2} aria-hidden />
      )}
      <span className="sr-only">{copied ? 'Copied ticket ID' : 'Copy ticket ID'}</span>
    </button>
  );
}

function statusTone(status) {
  const value = normalize(status);
  if (value === 'open') return 'open';
  if (value === 'in_progress') return 'progress';
  if (value === 'closed' || value === 'resolved') return 'resolved';
  return 'neutral';
}

function QuietMark({ label, tone = 'neutral', size = 'md' }) {
  const dot = {
    open: 'bg-amber-500',
    progress: 'bg-[#00B0FF]',
    resolved: 'bg-emerald-500',
    medium: 'bg-slate-400',
    high: 'bg-amber-500',
    urgent: 'bg-rose-500',
    neutral: 'bg-slate-300',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium ${
        size === 'sm' ? 'text-xs text-slate-600' : 'text-sm text-slate-700'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}

function initialsOf(value) {
  return (
    String(value || '')
      .replace(/\(.*?\)/g, ' ')
      .split(/[\s._-]+/)
      .filter((part) => /[a-z]/i.test(part))
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?'
  );
}
