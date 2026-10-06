import { useCallback, useEffect, useMemo, useState } from 'react';
import { PermissionGate } from '../../../shared/components/PermissionGate';
import { adminService } from '../services/adminService';
import { PERMISSIONS } from '../permissions';
import { Alert } from '../../../shared/components/ui/Alert';
import { Dialog } from '../../../shared/components/ui/Dialog';
import { Select } from '../../../shared/components/ui/Select';
import { SkeletonForm } from '../../../shared/components/ui/Skeleton';
import { useAuthStore } from '../../auth/store/authStore';

const NAV = [
  {
    heading: 'Organization',
    items: [
      { id: 'company', label: 'Organization' },
      { id: 'reports', label: 'Reports' },
      { id: 'calendar', label: 'Calendar' },
    ],
  },
  {
    heading: 'Attendance',
    items: [
      { id: 'attendance', label: 'Attendance' },
      { id: 'leave', label: 'Leave' },
    ],
  },
  {
    heading: 'Locations',
    items: [{ id: 'geofencing', label: 'Locations' }],
  },
  {
    heading: 'Notifications',
    items: [
      { id: 'notifications', label: 'Notifications' },
      { id: 'tickets', label: 'Tickets' },
    ],
  },
  {
    heading: 'Account',
    items: [
      { id: 'security', label: 'Security' },
      { id: 'theme', label: 'Appearance' },
    ],
  },
];

const SECTION_COPY = {
  company: {
    title: 'Organization',
    description: 'Name, branding and the timezone used for working days.',
  },
  attendance: {
    title: 'Attendance',
    description: 'How check-in is judged late, closed and verified.',
  },
  leave: {
    title: 'Leave',
    description: 'Default balances and the leave year for new people.',
  },
  tickets: {
    title: 'Tickets',
    description: 'Defaults for new support tickets and assignment alerts.',
  },
  calendar: {
    title: 'Calendar',
    description: 'Who can see newly created events.',
  },
  notifications: {
    title: 'Notifications',
    description: 'Channels used to deliver in-product alerts.',
  },
  reports: {
    title: 'Reports',
    description: 'How long generated reports are kept.',
  },
  geofencing: {
    title: 'Locations',
    description: 'Default radius applied to new work sites.',
  },
  security: {
    title: 'Security',
    description: 'Session length and password rules for this workspace.',
  },
  theme: {
    title: 'Appearance',
    description: 'Accent and density stored for this workspace.',
  },
};

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VISIBILITY = ['all', 'none', 'selected'];
const DENSITY = ['comfortable', 'compact'];
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function sameDraft(a, b) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

const NUMBER_KEYS = {
  attendance: ['graceMinutes'],
  leave: ['defaultAnnual', 'defaultSick', 'defaultCasual', 'absenceDeductionDays'],
  reports: ['retentionDays'],
  geofencing: ['defaultRadiusMeters'],
  security: ['sessionTimeoutMinutes'],
};

function prepareDraft(section, values) {
  const next = { ...(values || {}) };
  for (const key of NUMBER_KEYS[section] || []) {
    next[key] = Number(next[key]) || 0;
  }
  return next;
}

function validateSection(section, values) {
  const errors = {};
  if (section === 'attendance' && !isNonNegativeNumber(Number(values.graceMinutes))) {
    errors.graceMinutes = 'Enter zero or a positive number of minutes.';
  }
  if (section === 'leave') {
    for (const key of ['defaultAnnual', 'defaultSick', 'defaultCasual']) {
      if (!isNonNegativeNumber(Number(values[key]))) errors[key] = 'Enter zero or a positive number of days.';
    }
    if (values.yearStart && !MONTH_DAY.test(String(values.yearStart))) {
      errors.yearStart = 'Use MM-DD, for example 01-01.';
    }
    if (values.yearEnd && !MONTH_DAY.test(String(values.yearEnd))) {
      errors.yearEnd = 'Use MM-DD, for example 12-31.';
    }
    if (values.absenceDeductionDays !== undefined && !isNonNegativeNumber(Number(values.absenceDeductionDays))) {
      errors.absenceDeductionDays = 'Enter zero or a positive number of days.';
    }
    if (values.absenceEffectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(String(values.absenceEffectiveFrom))) {
      errors.absenceEffectiveFrom = 'Use YYYY-MM-DD.';
    }
  }
  if (section === 'reports' && !isNonNegativeNumber(Number(values.retentionDays))) {
    errors.retentionDays = 'Enter zero or a positive number of days.';
  }
  if (section === 'geofencing' && !isNonNegativeNumber(Number(values.defaultRadiusMeters))) {
    errors.defaultRadiusMeters = 'Enter zero or a positive number of metres.';
  }
  if (section === 'security' && !isNonNegativeNumber(Number(values.sessionTimeoutMinutes))) {
    errors.sessionTimeoutMinutes = 'Enter zero or a positive number of minutes.';
  }
  return errors;
}

export function SettingsPage() {
  const [active, setActive] = useState('company');
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [errors, setErrors] = useState({});
  const [confirm, setConfirm] = useState(null);

  const saved = settings?.[active] || {};
  const dirty = useMemo(() => !sameDraft(draft, saved), [draft, saved]);
  const copy = SECTION_COPY[active] || { title: active, description: '' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminService.getSettings();
      setSettings(data);
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (settings) {
      setDraft({ ...(settings[active] || {}) });
      setErrors({});
    }
  }, [active, settings]);

  useEffect(() => {
    if (!message?.ok) return undefined;
    const timer = setTimeout(() => setMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onLeave = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  function onFieldChange(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function requestSection(nextId) {
    if (nextId === active) return;
    if (dirty) setConfirm({ type: 'discard', nextId });
    else setActive(nextId);
  }

  function discardAndSwitch() {
    const nextId = confirm?.nextId;
    setConfirm(null);
    if (nextId) setActive(nextId);
  }

  async function save() {
    const payload = prepareDraft(active, draft);
    const nextErrors = validateSection(active, payload);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setMessage({ ok: false, text: 'Fix the highlighted fields before saving.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await adminService.saveSettingsSection(active, payload);
      setSettings(res.data);
      setMessage({ ok: true, text: res.message || 'Saved' });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function resetSection() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await adminService.saveSettingsSection(active, null, true);
      setSettings(res.data);
      setDraft(res.data?.[active] || {});
      setErrors({});
      setConfirm(null);
      setMessage({ ok: true, text: 'Reset to defaults' });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PermissionGate permission={PERMISSIONS.ACCESS_SYSTEM_SETTINGS}>
      <div className="settings-directory admin-page gap-4 animate-fade-up">
        {message && (
          <Alert type={message.ok ? 'success' : 'error'} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <nav className="settings-nav" aria-label="Settings sections">
            {NAV.map((group) => (
              <div key={group.heading} className="settings-nav-group">
                <p className="settings-nav-heading">{group.heading}</p>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => requestSection(item.id)}
                    aria-current={active === item.id ? 'page' : undefined}
                    className={`settings-nav-item ${active === item.id ? 'is-active' : ''}`}
                  >
                    {item.label}
                    {active === item.id && dirty ? <span className="settings-nav-dot" aria-label="Unsaved changes" /> : null}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <section className="settings-panel">
            <div className="settings-panel-head">
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold tracking-tight text-slate-900">{copy.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{copy.description}</p>
              </div>
              {dirty && <p className="settings-unsaved">Unsaved changes</p>}
            </div>

            <div className="settings-panel-body">
              {loading ? (
                <div className="px-5 py-4">
                  <SkeletonForm fields={5} />
                </div>
              ) : (
                <SectionFields section={active} values={draft} errors={errors} onChange={onFieldChange} />
              )}
            </div>

            <div className="settings-panel-foot">
              <button type="button" onClick={save} disabled={saving || loading || !dirty} className="ui-btn-primary ui-btn-sm">
                {saving ? 'Saving…' : 'Save'}
              </button>
              {dirty && (
                <button
                  type="button"
                  onClick={() => setDraft({ ...saved })}
                  disabled={saving}
                  className="ui-btn-secondary ui-btn-sm"
                >
                  Discard
                </button>
              )}
            </div>

            <div className="settings-danger">
              <div>
                <p className="text-sm font-medium text-slate-800">Reset {copy.title.toLowerCase()}</p>
                <p className="mt-1 text-sm text-slate-500">
                  Restore the defaults for this section. Current values are replaced immediately.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirm({ type: 'reset' })}
                disabled={saving || loading}
                className="ui-btn-danger ui-btn-sm"
              >
                Reset
              </button>
            </div>
          </section>
        </div>

        <Dialog
          open={confirm?.type === 'discard'}
          onClose={() => setConfirm(null)}
          title="Discard unsaved changes?"
          description="The current section has edits that have not been saved."
          footer={
            <>
              <button type="button" className="ui-btn-secondary" onClick={() => setConfirm(null)}>
                Keep editing
              </button>
              <button type="button" className="ui-btn-primary" onClick={discardAndSwitch}>
                Discard
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">Leave this section without saving, and those edits will be lost.</p>
        </Dialog>

        <Dialog
          open={confirm?.type === 'reset'}
          onClose={() => !saving && setConfirm(null)}
          title={`Reset ${copy.title.toLowerCase()} to defaults?`}
          description="This replaces the current values for this section."
          footer={
            <>
              <button type="button" className="ui-btn-secondary" disabled={saving} onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button type="button" className="ui-btn-danger" disabled={saving} onClick={resetSection}>
                {saving ? 'Resetting…' : 'Reset to defaults'}
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">You can save new values afterwards, but this reset cannot be undone from here.</p>
        </Dialog>
      </div>
    </PermissionGate>
  );
}

function SectionFields({ section, values, errors = {}, onChange }) {
  if (!values) return null;

  if (section === 'company') {
    return (
      <>
        <TextRow
          label="Company name"
          hint="How the organization appears across Hadir."
          value={values.name}
          error={errors.name}
          onChange={(value) => onChange('name', value)}
        />
        <TextRow
          label="Logo URL"
          hint="Image address used wherever the company mark is shown."
          value={values.logoUrl}
          error={errors.logoUrl}
          onChange={(value) => onChange('logoUrl', value)}
        />
        <TextRow
          label="Timezone"
          hint="IANA name used for attendance days and reports, for example Asia/Karachi."
          value={values.timezone}
          error={errors.timezone}
          onChange={(value) => onChange('timezone', value)}
        />
      </>
    );
  }

  if (section === 'attendance') {
    return (
      <>
        <NumberRow
          label="Grace minutes"
          hint="Extra minutes before a check-in is treated as late."
          value={values.graceMinutes}
          error={errors.graceMinutes}
          onChange={(value) => onChange('graceMinutes', value)}
        />
        <ToggleRow
          label="Auto checkout"
          hint="Close an open shift automatically at the end of the day."
          checked={!!values.autoCheckoutEnabled}
          onChange={(value) => onChange('autoCheckoutEnabled', value)}
        />
        <ToggleRow
          label="Require GPS"
          hint="Check-in must include a location to count."
          checked={!!values.requireGps}
          onChange={(value) => onChange('requireGps', value)}
        />
        <ToggleRow
          label="Attendance rules engine"
          hint="Enable server-side schedule summaries for this company. Raw attendance and legacy behavior remain available."
          checked={!!values.rulesV1Enabled}
          onChange={(value) => onChange('rulesV1Enabled', value)}
        />
      </>
    );
  }

  if (section === 'leave') {
    const isSuperAdmin = useAuthStore((state) => state.user?.role === 'super_admin');
    return (
      <>
        <NumberRow
          label="Default annual days"
          hint="Starting annual balance for new people."
          value={values.defaultAnnual}
          error={errors.defaultAnnual}
          onChange={(value) => onChange('defaultAnnual', value)}
        />
        <NumberRow
          label="Default sick days"
          hint="Starting sick balance for new people."
          value={values.defaultSick}
          error={errors.defaultSick}
          onChange={(value) => onChange('defaultSick', value)}
        />
        <NumberRow
          label="Default casual days"
          hint="Starting casual balance for new people."
          value={values.defaultCasual}
          error={errors.defaultCasual}
          onChange={(value) => onChange('defaultCasual', value)}
        />
        <TextRow
          label="Year start"
          hint="Leave year begins on this date (MM-DD)."
          value={values.yearStart}
          error={errors.yearStart}
          onChange={(value) => onChange('yearStart', value)}
        />
        <TextRow
          label="Year end"
          hint="Leave year ends on this date (MM-DD)."
          value={values.yearEnd}
          error={errors.yearEnd}
          onChange={(value) => onChange('yearEnd', value)}
        />
        {isSuperAdmin && (
          <>
            <ToggleRow
              label="Automatic absence handling"
              hint="Enable auditable absence outcomes after the finalized overtime window."
              checked={!!values.absenceDeductionsV1Enabled}
              onChange={(value) => onChange('absenceDeductionsV1Enabled', value)}
            />
            <SelectRow
              label="Absence action"
              hint="Choose what a finalized absence should do."
              value={values.absenceAction || 'NONE'}
              onChange={(value) => onChange('absenceAction', value)}
            >
              <option value="NONE">No automatic deduction</option>
              <option value="DEDUCT_LEAVE">Deduct configured leave</option>
              <option value="UNPAID_ABSENCE">Mark unpaid absence</option>
            </SelectRow>
            <SelectRow
              label="Leave type"
              hint="Leave balance used when deduction is enabled."
              value={values.absenceLeaveType || 'annual'}
              onChange={(value) => onChange('absenceLeaveType', value)}
            >
              <option value="annual">Annual</option>
              <option value="sick">Sick</option>
              <option value="casual">Casual</option>
            </SelectRow>
            <NumberRow
              label="Deduction days"
              hint="Amount deducted for one full-day absence."
              value={values.absenceDeductionDays ?? 1}
              error={errors.absenceDeductionDays}
              onChange={(value) => onChange('absenceDeductionDays', value)}
            />
            <SelectRow
              label="Insufficient balance"
              hint="Control what happens when the selected balance is too low."
              value={values.absenceInsufficientBalancePolicy || 'CAP_AT_ZERO_UNPAID'}
              onChange={(value) => onChange('absenceInsufficientBalancePolicy', value)}
            >
              <option value="CAP_AT_ZERO_UNPAID">Cap at zero + unpaid remainder</option>
              <option value="ALLOW_NEGATIVE">Allow negative balance</option>
              <option value="NO_DEDUCTION">No deduction + unpaid absence</option>
            </SelectRow>
            <TextRow
              label="Absence effective date"
              hint="No automatic outcomes are created before this date (YYYY-MM-DD)."
              value={values.absenceEffectiveFrom}
              error={errors.absenceEffectiveFrom}
              onChange={(value) => onChange('absenceEffectiveFrom', value)}
            />
          </>
        )}
      </>
    );
  }

  if (section === 'tickets') {
    return (
      <>
        <SelectRow
          label="Default priority"
          hint="Applied when a new ticket is created."
          value={values.defaultPriority || 'medium'}
          onChange={(value) => onChange('defaultPriority', value)}
        >
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {priority.charAt(0).toUpperCase() + priority.slice(1)}
            </option>
          ))}
        </SelectRow>
        <ToggleRow
          label="Notify on assign"
          hint="Alert the assignee when a ticket is given to them."
          checked={!!values.notifyOnAssign}
          onChange={(value) => onChange('notifyOnAssign', value)}
        />
      </>
    );
  }

  if (section === 'calendar') {
    return (
      <SelectRow
        label="Default visibility"
        hint="Who can see newly created calendar events."
        value={values.defaultVisibility || 'all'}
        onChange={(value) => onChange('defaultVisibility', value)}
      >
        {VISIBILITY.map((item) => (
          <option key={item} value={item}>
            {item.charAt(0).toUpperCase() + item.slice(1)}
          </option>
        ))}
      </SelectRow>
    );
  }

  if (section === 'notifications') {
    return (
      <>
        <ToggleRow
          label="Email"
          hint="Send alerts to the recipient’s email when the channel is available."
          checked={!!values.emailEnabled}
          onChange={(value) => onChange('emailEnabled', value)}
        />
        <ToggleRow
          label="Push"
          hint="Send push alerts to signed-in devices."
          checked={!!values.pushEnabled}
          onChange={(value) => onChange('pushEnabled', value)}
        />
        <ToggleRow
          label="In-app"
          hint="Show alerts in the notification inbox."
          checked={!!values.inAppEnabled}
          onChange={(value) => onChange('inAppEnabled', value)}
        />
      </>
    );
  }

  if (section === 'reports') {
    return (
      <NumberRow
        label="Retention days"
        hint="How long generated reports are kept."
        value={values.retentionDays}
        error={errors.retentionDays}
        onChange={(value) => onChange('retentionDays', value)}
      />
    );
  }

  if (section === 'geofencing') {
    return (
      <NumberRow
        label="Default radius"
        hint="Radius in metres applied to new work sites."
        value={values.defaultRadiusMeters}
        error={errors.defaultRadiusMeters}
        suffix="m"
        onChange={(value) => onChange('defaultRadiusMeters', value)}
      />
    );
  }

  if (section === 'security') {
    return (
      <>
        <NumberRow
          label="Session timeout"
          hint="Sign people out after this many minutes idle."
          value={values.sessionTimeoutMinutes}
          error={errors.sessionTimeoutMinutes}
          suffix="min"
          onChange={(value) => onChange('sessionTimeoutMinutes', value)}
        />
        <ToggleRow
          label="Strong passwords"
          hint="Ask for a stronger password on new accounts."
          checked={!!values.requireStrongPasswords}
          onChange={(value) => onChange('requireStrongPasswords', value)}
        />
      </>
    );
  }

  if (section === 'theme') {
    return (
      <>
        <TextRow
          label="Accent color"
          hint="Stored accent for this workspace."
          value={values.accent}
          error={errors.accent}
          onChange={(value) => onChange('accent', value)}
        />
        <SelectRow
          label="Density"
          hint="Comfortable gives more space; compact tightens lists."
          value={values.density || 'comfortable'}
          onChange={(value) => onChange('density', value)}
        >
          {DENSITY.map((item) => (
            <option key={item} value={item}>
              {item.charAt(0).toUpperCase() + item.slice(1)}
            </option>
          ))}
        </SelectRow>
      </>
    );
  }

  return null;
}

function TextRow({ label, hint, value, error, onChange }) {
  return (
    <label className="settings-row">
      <span className="settings-row-copy">
        <span className="settings-row-title">{label}</span>
        <span className="settings-row-hint">{hint}</span>
        {error && <span className="settings-row-error">{error}</span>}
      </span>
      <input
        type="text"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className={`ui-input settings-control ${error ? 'settings-control-error' : ''}`}
      />
    </label>
  );
}

function NumberRow({ label, hint, value, error, suffix, onChange }) {
  return (
    <label className="settings-row">
      <span className="settings-row-copy">
        <span className="settings-row-title">{label}</span>
        <span className="settings-row-hint">{hint}</span>
        {error && <span className="settings-row-error">{error}</span>}
      </span>
      <span className="settings-control-wrap">
        <input
          type="number"
          min="0"
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
          className={`ui-input settings-control ${error ? 'settings-control-error' : ''}`}
        />
        {suffix ? <span className="settings-suffix">{suffix}</span> : null}
      </span>
    </label>
  );
}

function SelectRow({ label, hint, value, onChange, children }) {
  return (
    <div className="settings-row">
      <span className="settings-row-copy">
        <span className="settings-row-title">{label}</span>
        <span className="settings-row-hint">{hint}</span>
      </span>
      <Select size="sm" value={value} onChange={(event) => onChange(event.target.value)} className="settings-control">
        {children}
      </Select>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }) {
  return (
    <label className="settings-row settings-row-toggle">
      <span className="settings-row-copy">
        <span className="settings-row-title">{label}</span>
        <span className="settings-row-hint">{hint}</span>
      </span>
      <input type="checkbox" className="ui-checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
