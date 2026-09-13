import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange } from 'lucide-react';
import { payrollService } from '../services/payrollService';
import { KpiMetricCard, KpiMetricGrid } from '../../../shared/components/ui/KpiMetricCard';
import { Alert } from '../../../shared/components/ui/Alert';
import { Button } from '../../../shared/components/ui/Button';
import { Dialog } from '../../../shared/components/ui/Dialog';
import { Input } from '../../../shared/components/ui/Input';
import { Textarea } from '../../../shared/components/ui/Textarea';
import { Badge, formatStatusLabel } from '../../../shared/components/ui/Badge';
import { EmptyStateBody } from '../../../shared/components/ui/EmptyState';
import { GlassTable, TableCell, TableRow } from '../../../shared/components/GlassTable';
import { PageActions } from '../../../shared/components/pageChrome';
import { formatCurrency, formatDateRange } from '../../../shared/lib/format';
import { useSessionState } from '../../../shared/hooks/useSilentPoll';

const STATUS_TONE = {
  draft: 'neutral',
  calculated: 'warning',
  reviewed: 'accent',
  approved: 'success',
  locked: 'violet',
};

export function StatusPill({ status }) {
  return <Badge tone={STATUS_TONE[status] || 'neutral'}>{formatStatusLabel(status)}</Badge>;
}

export function PayrollDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ period_start: '', period_end: '', pay_date: '', notes: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [explainerDismissed, setExplainerDismissed] = useSessionState('payroll:explainerDismissed', false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await payrollService.getDashboard();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submitCreate = async (event) => {
    event.preventDefault();
    setFormError('');
    if (!form.period_start || !form.period_end) {
      setFormError('Period start and end are required.');
      return;
    }
    if (new Date(form.period_start) >= new Date(form.period_end)) {
      setFormError('Period start must be before period end.');
      return;
    }
    setSaving(true);
    try {
      const period = await payrollService.createPeriod({
        period_start: form.period_start,
        period_end: form.period_end,
        pay_date: form.pay_date || null,
        notes: form.notes || null,
      });
      setShowCreate(false);
      setForm({ period_start: '', period_end: '', pay_date: '', notes: '' });
      setNotice('Payroll period created.');
      await load();
      navigate(`/payroll/periods/${period.id}`);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const kpis = data?.kpis;
  const periods = data?.periods || [];

  return (
    <div className="payroll-dashboard admin-page gap-4 animate-fade-up">
      <PageActions>
        <Button variant="ghost" size="sm" onClick={() => navigate('/payroll/reports')}>
          View reports
        </Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/payroll/employees')}>
          Configure salaries
        </Button>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          Create payroll period
        </Button>
      </PageActions>

      {error && <Alert type="error">{error}</Alert>}
      {notice && (
        <Alert type="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      {!explainerDismissed && (
        <Alert type="info" title="How payroll works" onDismiss={() => setExplainerDismissed(true)}>
          <p>
            Each employee has a salary profile (monthly or hourly, with an optional overtime rate).
            Creating a payroll period pulls their real attendance and leave records for that date
            range: unpaid absences and unpaid leave reduce a monthly salary proportionally; hourly
            pay is based on actual worked and paid-leave hours; hours beyond the standard day are
            paid as overtime where enabled. Bonuses, allowances, other earnings, and deductions can
            be added manually per employee and are added on top of — never overwrite — that
            calculated base. Tax, if enabled on a profile, is deducted as a flat amount or a
            percentage of gross pay.
          </p>
          <p className="mt-2">
            A period moves through <strong>draft → calculated → reviewed → approved → locked</strong>.
            Locking a period finalizes it and prevents further changes. Only Super Admin can access
            payroll — it&apos;s not part of manager permissions.
          </p>
        </Alert>
      )}

      <KpiMetricGrid columns={5}>
        <KpiMetricCard
          label="Total payroll"
          value={loading ? '—' : formatCurrency(kpis?.total_payroll, kpis?.current_period?.currency)}
          subtitle="Current period, net"
          loading={loading}
        />
        <KpiMetricCard label="Employees included" value={loading ? '—' : kpis?.employees_included ?? 0} subtitle="Current period" loading={loading} />
        <KpiMetricCard label="Pending review" value={loading ? '—' : kpis?.pending_review ?? 0} subtitle="Calculated periods" loading={loading} />
        <KpiMetricCard label="Approved" value={loading ? '—' : kpis?.approved ?? 0} subtitle="Awaiting lock" loading={loading} />
        <KpiMetricCard label="Locked" value={loading ? '—' : kpis?.locked ?? 0} subtitle="Finalized periods" loading={loading} />
      </KpiMetricGrid>

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
        {!loading && periods.length === 0 ? (
          <EmptyStateBody
            icon={CalendarRange}
            title="No payroll periods yet"
            description="Create your first payroll period to pull attendance and leave, calculate pay, and run it through review and approval."
            action={
              <Button size="sm" onClick={() => setShowCreate(true)}>
                Create payroll period
              </Button>
            }
            className="py-12"
          />
        ) : (
          <GlassTable
            className="rounded-none border-0 shadow-none"
            loading={loading}
            skeletonRows={5}
            emptyTitle="No payroll periods"
            emptyMessage="Create a payroll period to get started."
            columns={[
              { key: 'period', label: 'Period' },
              { key: 'employees', label: 'Employees' },
              { key: 'gross', label: 'Gross' },
              { key: 'deductions', label: 'Deductions' },
              { key: 'net', label: 'Net payroll' },
              { key: 'status', label: 'Status' },
              { key: 'pay_date', label: 'Pay date' },
            ]}
          >
            {periods.map((period) => (
              <TableRow key={period.id} onClick={() => navigate(`/payroll/periods/${period.id}`)}>
                <TableCell className="text-sm font-medium text-slate-800">
                  {formatDateRange(period.period_start, period.period_end)}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-slate-600">{period.employee_count}</TableCell>
                <TableCell className="text-sm tabular-nums text-slate-600">{formatCurrency(period.gross_total)}</TableCell>
                <TableCell className="text-sm tabular-nums text-slate-500">
                  {formatCurrency((period.gross_total || 0) - (period.net_total || 0))}
                </TableCell>
                <TableCell className="text-sm font-medium tabular-nums text-slate-800">{formatCurrency(period.net_total)}</TableCell>
                <TableCell>
                  <StatusPill status={period.status} />
                </TableCell>
                <TableCell className="text-sm text-slate-500">{period.pay_date || '—'}</TableCell>
              </TableRow>
            ))}
          </GlassTable>
        )}
      </div>

      <Dialog
        open={showCreate}
        onClose={() => (saving ? null : setShowCreate(false))}
        title="Create payroll period"
        description="Pick the date range to calculate payroll for. It cannot overlap an existing period."
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={saving} onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={saving} onClick={submitCreate}>
              Create period
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={submitCreate}>
          {formError && <Alert type="error">{formError}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Period start"
              type="date"
              required
              value={form.period_start}
              onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
            />
            <Input
              label="Period end"
              type="date"
              required
              value={form.period_end}
              onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
            />
          </div>
          <Input
            label="Pay date"
            optional
            type="date"
            value={form.pay_date}
            onChange={(e) => setForm((f) => ({ ...f, pay_date: e.target.value }))}
          />
          <Textarea
            label="Notes"
            optional
            rows={2}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </form>
      </Dialog>
    </div>
  );
}
