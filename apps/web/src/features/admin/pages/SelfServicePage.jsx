import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, CalendarClock, ClipboardList, LogIn, Plus, Ticket } from 'lucide-react';
import { useAuthStore } from '../../auth/store/authStore';
import { adminService } from '../services/adminService';
import { Alert } from '../../../shared/components/ui/Alert';
import { PageActions } from '../../../shared/components/pageChrome';

const TITLES = {
  dashboard: 'My dashboard',
  attendance: 'My attendance',
  leaves: 'My leave',
  workModes: 'My work modes',
  tickets: 'My tickets',
  calendar: 'My calendar',
};

const dateLabel = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};

function Empty({ children }) {
  return <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">{children}</div>;
}
function Rows({ rows, columns, empty = 'Nothing to show yet.' }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>{columns.map((column) => <th key={column.key} className="px-4 py-3 font-semibold">{column.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={row.id || `${row.timestamp || row.created_at || index}`} className="text-slate-700">
              {columns.map((column) => <td key={column.key} className="px-4 py-3">{column.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SelfServicePage({ section = 'dashboard' }) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(section !== 'dashboard');
  const [error, setError] = useState('');
  const [leaveForm, setLeaveForm] = useState({ leave_type: 'annual', start_date: '', end_date: '', reason: '' });
  const [ticketForm, setTicketForm] = useState({ subject: '', description: '', category: 'general', priority: 'normal' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (section === 'dashboard') return;
    setLoading(true);
    setError('');
    try {
      const data = section === 'attendance'
        ? await adminService.getAttendance({ scope: 'own' })
        : section === 'leaves'
          ? await adminService.getLeaves({ scope: 'own' })
          : section === 'workModes'
            ? await adminService.getMyWorkModeRequests()
            : section === 'tickets'
              ? await adminService.getTickets({ scope: 'own' })
              : await adminService.getCalendarEvents({ scope: 'own' });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setRows([]);
      setError(err?.response?.data?.error || err?.message || 'Failed to load your data');
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => { load(); }, [load]);

  const title = TITLES[section] || TITLES.dashboard;
  const subtitle = section === 'dashboard'
    ? 'Your personal attendance, leave, work-mode and support shortcuts.'
    : `Only your ${title.replace(/^My /i, '').toLowerCase()} data is shown here.`;

  const submitLeave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await adminService.createLeave({ ...leaveForm, employee_uid: user?.uid });
      setLeaveForm({ leave_type: 'annual', start_date: '', end_date: '', reason: '' });
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create leave request');
    } finally {
      setSaving(false);
    }
  };

  const submitTicket = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await adminService.createTicket(ticketForm);
      setTicketForm({ subject: '', description: '', category: 'general', priority: 'normal' });
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create ticket');
    } finally {
      setSaving(false);
    }
  };

  const dashboardCards = useMemo(() => [
    ['attendance', 'Attendance history', 'Review your check-ins and check-outs', CalendarClock],
    ['leaves', 'Leave requests', 'Create and track your own requests', CalendarDays],
    ['workModes', 'Work-mode requests', 'Review your remote or hybrid requests', ClipboardList],
    ['tickets', 'Support tickets', 'Open and follow up on your tickets', Ticket],
    ['calendar', 'Calendar', 'See events visible to you', CalendarDays],
  ], []);

  return (
    <div className="admin-page flex flex-col gap-4 animate-fade-up">
      <PageActions>
        {section === 'leaves' && <button type="button" className="ui-btn-primary ui-btn-sm" onClick={() => document.getElementById('my-leave-form')?.scrollIntoView({ behavior: 'smooth' })}><Plus className="h-4 w-4" /> New leave request</button>}
        {section === 'tickets' && <button type="button" className="ui-btn-primary ui-btn-sm" onClick={() => document.getElementById('my-ticket-form')?.scrollIntoView({ behavior: 'smooth' })}><Plus className="h-4 w-4" /> New ticket</button>}
      </PageActions>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#00a3e8]">Self service</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </header>
      {error && <Alert type="error">{error}</Alert>}
      {section === 'dashboard' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dashboardCards.map(([id, label, description, Icon]) => (
            <button key={id} type="button" onClick={() => navigate(`/my-${id === 'workModes' ? 'work-modes' : id}`)} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#8bdcff] hover:shadow-md">
              <Icon className="h-5 w-5 text-[#00a3e8]" />
              <p className="mt-4 font-semibold text-slate-900">{label}</p>
              <p className="mt-1 text-sm text-slate-500">{description}</p>
            </button>
          ))}
        </div>
      ) : loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading your data…</div>
      ) : section === 'attendance' ? (
        <Rows rows={rows} columns={[
          { key: 'type', label: 'Event', render: (row) => String(row.type || 'attendance').replace(/_/g, ' ') },
          { key: 'timestamp', label: 'When', render: (row) => dateLabel(row.timestamp) },
          { key: 'source', label: 'Source', render: (row) => row.checkout_source || (row.is_manual ? 'Manual' : 'Self service') },
        ]} empty="No attendance history has been recorded yet." />
      ) : section === 'leaves' ? (
        <>
          <Rows rows={rows} columns={[
            { key: 'leave_type', label: 'Type', render: (row) => String(row.leave_type || '').replace(/_/g, ' ') },
            { key: 'dates', label: 'Dates', render: (row) => `${row.start_date || '—'} → ${row.end_date || row.start_date || '—'}` },
            { key: 'status', label: 'Status', render: (row) => row.status || 'pending' },
            { key: 'reason', label: 'Reason', render: (row) => row.reason || '—' },
          ]} empty="You have not submitted any leave requests." />
          <form id="my-leave-form" onSubmit={submitLeave} className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Request leave</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <select className="ui-input" value={leaveForm.leave_type} onChange={(e) => setLeaveForm((v) => ({ ...v, leave_type: e.target.value }))}><option value="annual">Annual</option><option value="sick">Sick</option><option value="casual">Casual</option></select>
              <input required type="date" className="ui-input" value={leaveForm.start_date} onChange={(e) => setLeaveForm((v) => ({ ...v, start_date: e.target.value, end_date: v.end_date || e.target.value }))} />
              <input required type="date" className="ui-input" value={leaveForm.end_date} onChange={(e) => setLeaveForm((v) => ({ ...v, end_date: e.target.value }))} />
              <input className="ui-input sm:col-span-2" placeholder="Reason (optional)" value={leaveForm.reason} onChange={(e) => setLeaveForm((v) => ({ ...v, reason: e.target.value }))} />
            </div>
            <button disabled={saving} className="ui-btn-primary ui-btn-sm mt-4" type="submit">{saving ? 'Submitting…' : 'Submit request'}</button>
          </form>
        </>
      ) : section === 'workModes' ? (
        <Rows rows={rows} columns={[
          { key: 'work_mode', label: 'Work mode', render: (row) => String(row.requested_work_mode || row.work_mode || '—').replace(/_/g, ' ') },
          { key: 'dates', label: 'Dates', render: (row) => `${row.start_date || '—'} → ${row.end_date || row.start_date || '—'}` },
          { key: 'status', label: 'Status', render: (row) => row.status || 'pending' },
        ]} empty="You have not submitted any work-mode requests." />
      ) : section === 'tickets' ? (
        <>
          <Rows rows={rows} columns={[
            { key: 'subject', label: 'Subject', render: (row) => row.subject || '—' },
            { key: 'priority', label: 'Priority', render: (row) => row.priority || 'normal' },
            { key: 'status', label: 'Status', render: (row) => row.status || 'open' },
            { key: 'created_at', label: 'Created', render: (row) => dateLabel(row.created_at) },
          ]} empty="You have not created any support tickets." />
          <form id="my-ticket-form" onSubmit={submitTicket} className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-900">Open a ticket</h2>
            <div className="mt-4 grid gap-3">
              <input required className="ui-input" placeholder="Subject" value={ticketForm.subject} onChange={(e) => setTicketForm((v) => ({ ...v, subject: e.target.value }))} />
              <textarea required className="ui-input min-h-24" placeholder="Describe the issue" value={ticketForm.description} onChange={(e) => setTicketForm((v) => ({ ...v, description: e.target.value }))} />
            </div>
            <button disabled={saving} className="ui-btn-primary ui-btn-sm mt-4" type="submit">{saving ? 'Submitting…' : 'Submit ticket'}</button>
          </form>
        </>
      ) : (
        <Rows rows={rows} columns={[
          { key: 'title', label: 'Event', render: (row) => row.title || '—' },
          { key: 'date', label: 'Date', render: (row) => row.date || '—' },
          { key: 'time', label: 'Time', render: (row) => row.time || '—' },
          { key: 'type', label: 'Type', render: (row) => row.type || 'event' },
        ]} empty="No calendar events are visible to you." />
      )}
    </div>
  );
}
