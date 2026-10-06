import { useEffect, useMemo, useState } from 'react';
import { Alert } from '../../../shared/components/ui/Alert';
import { PermissionGate } from '../../../shared/components/PermissionGate';
import { adminService } from '../services/adminService';
import { PERMISSIONS } from '../permissions';

const DAYS = [
  [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun'],
];

const emptyRule = {
  scope_type: 'COMPANY', department_id: '', user_uid: '', timezone: 'UTC',
  scheduled_start: '09:00', scheduled_end: '18:00', grace_minutes: 15,
  working_days: [1, 2, 3, 4, 5], overtime_enabled: false,
  overtime_window_minutes: 60, auto_checkout_enabled: true, effective_from: new Date().toISOString().slice(0, 10), effective_to: '',
};

export function AttendanceRulesPage() {
  const [rules, setRules] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [rule, setRule] = useState(emptyRule);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [holiday, setHoliday] = useState({ holiday_date: '', name: '', holiday_type: 'public', is_working_day: false });
  const [editingHolidayId, setEditingHolidayId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = async () => {
    try {
      const [nextRules, nextHolidays, nextDepartments, nextUsers] = await Promise.all([
        adminService.getAttendanceRules(), adminService.getAttendanceHolidays(), adminService.getDepartments(), adminService.getUsers(),
      ]);
      setRules(nextRules || []); setHolidays(nextHolidays || []); setDepartments(nextDepartments || []); setUsers(nextUsers || []);
    } catch (error) { setMessage({ type: 'error', text: error.message }); }
  };

  useEffect(() => { load(); }, []);

  const scopeOptions = useMemo(() => {
    if (rule.scope_type === 'DEPARTMENT') return departments;
    if (rule.scope_type === 'USER') return users;
    return [];
  }, [departments, users, rule.scope_type]);

  const updateRule = (key, value) => setRule((current) => ({ ...current, [key]: value }));
  const toggleDay = (day) => setRule((current) => ({ ...current, working_days: current.working_days.includes(day) ? current.working_days.filter((item) => item !== day) : [...current.working_days, day].sort() }));

  async function saveRule(event) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const payload = { ...rule, department_id: rule.scope_type === 'DEPARTMENT' ? rule.department_id : null, user_uid: rule.scope_type === 'USER' ? rule.user_uid : null };
      if (editingRuleId) await adminService.updateAttendanceRule(editingRuleId, payload);
      else await adminService.createAttendanceRule(payload);
      setRule(emptyRule); setEditingRuleId(null); await load(); setMessage({ type: 'success', text: editingRuleId ? 'Attendance rule updated.' : 'Attendance rule saved.' });
    } catch (error) { setMessage({ type: 'error', text: error.message }); } finally { setBusy(false); }
  }

  function editRule(item) {
    setEditingRuleId(item.id);
    setRule({ ...emptyRule, ...item, department_id: item.department_id || '', user_uid: item.user_uid || '', working_days: Array.isArray(item.working_days) ? item.working_days.map(Number) : emptyRule.working_days, effective_to: item.effective_to || '' });
  }

  async function removeRule(id) {
    if (!window.confirm('Delete this schedule rule? Existing summaries keep their snapshot.')) return;
    setBusy(true); try { await adminService.deleteAttendanceRule(id); await load(); } catch (error) { setMessage({ type: 'error', text: error.message }); } finally { setBusy(false); }
  }

  async function saveHoliday(event) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try { if (editingHolidayId) await adminService.updateAttendanceHoliday(editingHolidayId, holiday); else await adminService.createAttendanceHoliday(holiday); setHoliday({ holiday_date: '', name: '', holiday_type: 'public', is_working_day: false }); setEditingHolidayId(null); await load(); setMessage({ type: 'success', text: editingHolidayId ? 'Holiday updated.' : 'Holiday saved.' }); } catch (error) { setMessage({ type: 'error', text: error.message }); } finally { setBusy(false); }
  }

  function editHoliday(item) {
    setEditingHolidayId(item.id);
    setHoliday({ holiday_date: item.holiday_date || '', name: item.name || '', holiday_type: item.holiday_type || 'public', is_working_day: Boolean(item.is_working_day) });
  }

  async function removeHoliday(id) {
    if (!window.confirm('Delete this holiday?')) return;
    setBusy(true); try { await adminService.deleteAttendanceHoliday(id); await load(); } catch (error) { setMessage({ type: 'error', text: error.message }); } finally { setBusy(false); }
  }

  return (
    <PermissionGate permission={PERMISSIONS.MANAGE_ATTENDANCE_RULES}>
      <div className="admin-page gap-4 animate-fade-up">
        {message && <Alert type={message.type} onDismiss={() => setMessage(null)}>{message.text}</Alert>}
        {rules.length > 0 && <section className="ui-card p-5"><h2 className="text-lg font-semibold text-slate-900">Edit a configured rule</h2><select className="ui-input mt-3" value={editingRuleId || ''} onChange={(e) => { const selected = rules.find((item) => String(item.id) === e.target.value); if (selected) editRule(selected); }}><option value="">Select a rule</option>{rules.map((item) => <option key={item.id} value={item.id}>{item.scope_type} · {item.effective_from} · {item.scheduled_start}–{item.scheduled_end}</option>)}</select></section>}
        {holidays.length > 0 && <section className="ui-card p-5"><h2 className="text-lg font-semibold text-slate-900">Edit a holiday</h2><select className="ui-input mt-3" value={editingHolidayId || ''} onChange={(e) => { const selected = holidays.find((item) => String(item.id) === e.target.value); if (selected) editHoliday(selected); }}><option value="">Select a holiday</option>{holidays.map((item) => <option key={item.id} value={item.id}>{item.holiday_date} · {item.name}</option>)}</select></section>}
        <section className="ui-card p-5">
          <h1 className="text-xl font-semibold text-slate-900">Attendance rules</h1>
          <p className="mt-1 text-sm text-slate-500">Rules apply company-wide, by primary department, or to an individual user. Existing days keep their persisted schedule snapshot.</p>
          <form className="mt-5 grid gap-4 md:grid-cols-3" onSubmit={saveRule}>
            <label className="text-sm text-slate-600">Scope<select className="ui-input mt-1" value={rule.scope_type} onChange={(e) => updateRule('scope_type', e.target.value)}><option value="COMPANY">Company</option><option value="DEPARTMENT">Department</option><option value="USER">User</option></select></label>
            {rule.scope_type !== 'COMPANY' && <label className="text-sm text-slate-600">Target<select className="ui-input mt-1" value={rule.scope_type === 'DEPARTMENT' ? rule.department_id : rule.user_uid} onChange={(e) => updateRule(rule.scope_type === 'DEPARTMENT' ? 'department_id' : 'user_uid', e.target.value)}><option value="">Select target</option>{scopeOptions.map((item) => <option key={item.id || item.uid} value={item.id || item.uid}>{item.name || item.username}</option>)}</select></label>}
            <label className="text-sm text-slate-600">Timezone<input className="ui-input mt-1" value={rule.timezone} onChange={(e) => updateRule('timezone', e.target.value)} placeholder="Asia/Karachi" /></label>
            <label className="text-sm text-slate-600">Start<input type="time" className="ui-input mt-1" value={rule.scheduled_start} onChange={(e) => updateRule('scheduled_start', e.target.value)} /></label>
            <label className="text-sm text-slate-600">End<input type="time" className="ui-input mt-1" value={rule.scheduled_end} onChange={(e) => updateRule('scheduled_end', e.target.value)} /></label>
            <label className="text-sm text-slate-600">Grace minutes<input type="number" min="0" className="ui-input mt-1" value={rule.grace_minutes} onChange={(e) => updateRule('grace_minutes', Number(e.target.value))} /></label>
            <label className="text-sm text-slate-600">Effective from<input type="date" className="ui-input mt-1" value={rule.effective_from} onChange={(e) => updateRule('effective_from', e.target.value)} /></label>
            <label className="text-sm text-slate-600">Effective to (optional)<input type="date" className="ui-input mt-1" value={rule.effective_to || ''} onChange={(e) => updateRule('effective_to', e.target.value)} /></label>
            <label className="text-sm text-slate-600">Overtime window (minutes)<input type="number" min="0" className="ui-input mt-1" value={rule.overtime_window_minutes} onChange={(e) => updateRule('overtime_window_minutes', Number(e.target.value))} /></label>
            <label className="flex items-center gap-2 text-sm text-slate-600 md:pt-7"><input type="checkbox" checked={rule.overtime_enabled} onChange={(e) => updateRule('overtime_enabled', e.target.checked)} /> Overtime enabled</label>
            <label className="flex items-center gap-2 text-sm text-slate-600 md:pt-7"><input type="checkbox" checked={rule.auto_checkout_enabled} onChange={(e) => updateRule('auto_checkout_enabled', e.target.checked)} /> Scheduled auto-checkout</label>
            <fieldset className="md:col-span-3"><legend className="text-sm text-slate-600">Working days</legend><div className="mt-2 flex flex-wrap gap-2">{DAYS.map(([day, label]) => <label key={day} className="flex items-center gap-1 rounded border px-2 py-1 text-sm"><input type="checkbox" checked={rule.working_days.includes(day)} onChange={() => toggleDay(day)} />{label}</label>)}</div></fieldset>
            {editingRuleId && <button type="button" className="ui-btn-secondary ui-btn-sm md:col-span-3" onClick={() => { setRule(emptyRule); setEditingRuleId(null); }}>Cancel edit</button>}
            <button type="submit" disabled={busy} className="ui-btn-primary ui-btn-sm md:col-span-3">{busy ? 'Saving…' : 'Save schedule rule'}</button>
          </form>
        </section>
        <section className="ui-card p-5"><h2 className="text-lg font-semibold text-slate-900">Configured rules</h2><div className="mt-3 divide-y">{rules.map((item) => <div key={item.id} className="flex items-center justify-between py-3 text-sm"><span>{item.scope_type} · {item.scheduled_start}–{item.scheduled_end} · from {item.effective_from}</span><button type="button" className="ui-btn-danger ui-btn-sm" onClick={() => removeRule(item.id)}>Delete</button></div>)}{!rules.length && <p className="py-3 text-sm text-slate-500">No V1 rules configured.</p>}</div></section>
        <section className="ui-card p-5"><h2 className="text-lg font-semibold text-slate-900">Public holidays</h2><form className="mt-4 flex flex-wrap gap-3" onSubmit={saveHoliday}><input required type="date" className="ui-input" value={holiday.holiday_date} onChange={(e) => setHoliday({ ...holiday, holiday_date: e.target.value })} /><input required className="ui-input" placeholder="Holiday name" value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} /><select className="ui-input" value={holiday.holiday_type} onChange={(e) => setHoliday({ ...holiday, holiday_type: e.target.value })}><option value="public">Public</option><option value="company">Company</option><option value="religious">Religious</option><option value="other">Other</option></select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={holiday.is_working_day} onChange={(e) => setHoliday({ ...holiday, is_working_day: e.target.checked })} /> Working holiday</label><button type="submit" disabled={busy} className="ui-btn-primary ui-btn-sm">{editingHolidayId ? 'Save holiday' : 'Add holiday'}</button></form><div className="mt-3 divide-y">{holidays.map((item) => <div key={item.id} className="flex items-center justify-between py-3 text-sm"><span>{item.holiday_date} · {item.name} ({item.holiday_type || 'public'}){item.is_working_day ? ' (working)' : ''}</span><div className="flex gap-2"><button type="button" className="ui-btn-secondary ui-btn-sm" onClick={() => editHoliday(item)}>Edit</button><button type="button" className="ui-btn-danger ui-btn-sm" onClick={() => removeHoliday(item.id)}>Delete</button></div></div>)}{!holidays.length && <p className="py-3 text-sm text-slate-500">No holidays configured.</p>}</div></section>
      </div>
    </PermissionGate>
  );
}
