import { useCallback, useEffect, useState } from 'react';
import { GlassCard } from '../../../shared/components/GlassCard';
import { GlassTable } from '../../../shared/components/GlassTable';
import { PermissionGate } from '../../../shared/components/PermissionGate';
import { adminService } from '../services/adminService';
import { PERMISSIONS } from '../permissions';

const RANGE_OPTIONS = [
  { value: 'daily', label: 'Daily (today)' },
  { value: 'weekly', label: 'Weekly (last 7 days)' },
  { value: 'monthly', label: 'Monthly (previous month)' },
  { value: 'yearly', label: 'Yearly (previous year)' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom date range' },
];

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => i + 1);

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function formatFileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status }) {
  const styles = {
    completed: 'bg-green-500/20 text-green-100 border-green-300/30',
    sent: 'bg-green-500/20 text-green-100 border-green-300/30',
    not_sent: 'bg-slate-500/20 text-slate-200 border-slate-300/20',
    failed: 'bg-red-500/20 text-red-100 border-red-300/30',
    skipped: 'bg-amber-500/20 text-amber-100 border-amber-300/30',
  };
  const cls = styles[status] || styles.not_sent;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs capitalize ${cls}`}>
      {(status || 'unknown').replace(/_/g, ' ')}
    </span>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function Alert({ ok, message }) {
  if (!message) return null;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${ok ? 'border-green-300/25 bg-green-500/15 text-green-100' : 'border-red-300/25 bg-red-500/15 text-red-100'}`}>
      {message}
    </div>
  );
}

export function ReportsPage() {
  const [reportRange, setReportRange] = useState('monthly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [generating, setGenerating] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [actionResult, setActionResult] = useState(null);
  const [latestReport, setLatestReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [rowAction, setRowAction] = useState(null);

  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleDay, setScheduleDay] = useState(1);
  const [autoSend, setAutoSend] = useState(true);
  const [frequency, setFrequency] = useState('monthly');
  const [recipients, setRecipients] = useState([]);
  const [scheduleMeta, setScheduleMeta] = useState({});
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleResult, setScheduleResult] = useState(null);

  const buildPayload = () => {
    const payload = { range: reportRange };
    if (reportRange === 'custom') {
      payload.from = customFrom;
      payload.to = customTo;
    }
    return payload;
  };

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const [reports, latest] = await Promise.all([
        adminService.getReportHistory().catch(() => []),
        adminService.getLatestReport().catch(() => null),
      ]);
      setHistory(reports || []);
      setLatestReport(latest);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    try {
      const schedule = await adminService.getReportSchedule();
      if (schedule) {
        setScheduleDay(schedule.day ?? 1);
        setAutoSend(schedule.autoSend ?? true);
        setFrequency(schedule.frequency ?? 'monthly');
        setRecipients(schedule.recipients || []);
        setScheduleMeta({
          lastExecution: schedule.lastExecution,
          lastStatus: schedule.lastStatus,
          nextExecution: schedule.nextExecution,
        });
      }
    } catch {
      /* defaults */
    } finally {
      setScheduleLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
    loadSchedule();
  }, [loadHistory, loadSchedule]);

  async function handleGeneratePdf() {
    if (reportRange === 'custom' && (!customFrom || !customTo)) {
      setActionResult({ ok: false, message: 'Please select both start and end dates for a custom range.' });
      return;
    }
    setGenerating(true);
    setActionResult(null);
    try {
      const res = await adminService.generateReportPdf(buildPayload());
      setActionResult({ ok: true, message: res.message || 'Report generated successfully.', reportId: res.reportId });
      await loadHistory();
    } catch (err) {
      setActionResult({ ok: false, message: err.message || 'PDF generation failed.' });
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateAndEmail() {
    if (reportRange === 'custom' && (!customFrom || !customTo)) {
      setActionResult({ ok: false, message: 'Please select both start and end dates for a custom range.' });
      return;
    }
    setEmailing(true);
    setActionResult(null);
    try {
      const res = await adminService.generateAndEmailReport(buildPayload());
      setActionResult({ ok: true, message: res.message, reportId: res.reportId });
      await loadHistory();
    } catch (err) {
      setActionResult({ ok: false, message: err.message || 'Failed to generate and email report.' });
    } finally {
      setEmailing(false);
    }
  }

  async function handlePreview(reportId) {
    setRowAction(reportId);
    try {
      await adminService.previewReport(reportId);
    } catch (err) {
      setActionResult({ ok: false, message: err.message || 'Unable to preview report.' });
    } finally {
      setRowAction(null);
    }
  }

  async function handleDownload(report) {
    setRowAction(report.reportId);
    try {
      const name = `${report.reportType}_Report_${(report.periodLabel || 'report').replace(/[^a-z0-9]+/gi, '_')}.pdf`;
      await adminService.downloadReportFile(report.reportId, name);
    } catch (err) {
      setActionResult({ ok: false, message: err.message || 'Download failed.' });
    } finally {
      setRowAction(null);
    }
  }

  async function handleResend(reportId) {
    setRowAction(reportId);
    try {
      await adminService.resendReportEmail(reportId);
      setActionResult({ ok: true, message: 'Report emailed successfully.' });
      await loadHistory();
    } catch (err) {
      setActionResult({ ok: false, message: err.message || 'Email failed.' });
    } finally {
      setRowAction(null);
    }
  }

  async function handleDelete(reportId) {
    if (!window.confirm('Delete this report permanently?')) return;
    setRowAction(reportId);
    try {
      await adminService.deleteReport(reportId);
      setActionResult({ ok: true, message: 'Report deleted.' });
      await loadHistory();
    } catch (err) {
      setActionResult({ ok: false, message: err.message || 'Failed to delete report.' });
    } finally {
      setRowAction(null);
    }
  }

  async function handleSaveSchedule() {
    setScheduleSaving(true);
    setScheduleResult(null);
    try {
      const updated = await adminService.updateReportSchedule({ day: scheduleDay, autoSend, frequency });
      setRecipients(updated.recipients || []);
      setScheduleMeta({
        lastExecution: updated.lastExecution,
        lastStatus: updated.lastStatus,
        nextExecution: updated.nextExecution,
      });
      setScheduleResult({
        ok: true,
        message: autoSend
          ? `Schedule saved: ${frequency} reports on the ${ordinal(scheduleDay)} at 02:00 UTC`
          : 'Auto-send disabled',
      });
    } catch (err) {
      setScheduleResult({ ok: false, message: err.message || 'Failed to save schedule.' });
    } finally {
      setScheduleSaving(false);
    }
  }

  const busy = generating || emailing;

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="text-2xl font-semibold text-white">Reports</h1>
        <p className="mt-1 text-sm text-slate-300">Generate, preview, download, and schedule attendance reports.</p>
      </div>

      <PermissionGate permission={PERMISSIONS.EXPORT_REPORTS}>
        {/* Generate Reports */}
        <GlassCard className="p-5 space-y-4">
          <div>
            <h2 className="text-base font-medium text-white">Generate Reports</h2>
            <p className="text-xs text-slate-300 mt-1">Create PDF reports without requiring email delivery.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-300">Report type</label>
              <select
                value={reportRange}
                onChange={(e) => setReportRange(e.target.value)}
                className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-300/40"
              >
                {RANGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-slate-800">{opt.label}</option>
                ))}
              </select>
            </div>

            {reportRange === 'custom' && (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-300">From</label>
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                    className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-300">To</label>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                    className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100" />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={handleGeneratePdf} disabled={busy}
              className="flex items-center gap-2 rounded-lg border border-blue-300/30 bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-100 hover:bg-blue-500/35 disabled:opacity-50 transition-all">
              {generating ? <Spinner /> : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              )}
              {generating ? 'Generating…' : 'Generate PDF'}
            </button>

            <button onClick={handleGenerateAndEmail} disabled={busy}
              className="flex items-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/35 disabled:opacity-50 transition-all">
              {emailing ? <Spinner /> : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4 20-7z" />
                </svg>
              )}
              {emailing ? 'Processing…' : 'Generate & Email Report'}
            </button>

            {latestReport && (
              <>
                <button onClick={() => handlePreview(latestReport.reportId)} disabled={!!rowAction}
                  className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/15 disabled:opacity-50 transition-all">
                  Preview Report
                </button>
                <button onClick={() => handleDownload(latestReport)} disabled={!!rowAction}
                  className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/15 disabled:opacity-50 transition-all">
                  Download Latest
                </button>
              </>
            )}
          </div>

          <Alert {...(actionResult || {})} />
        </GlassCard>

        {/* Scheduled Reports */}
        <GlassCard className="p-5 space-y-4">
          <div>
            <h2 className="text-base font-medium text-white">Scheduled Reports</h2>
            <p className="text-xs text-slate-300 mt-1">Configure automatic report delivery to super admins.</p>
          </div>

          {scheduleLoading ? (
            <div className="h-24 rounded-xl skeleton" />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                <button role="switch" aria-checked={autoSend} onClick={() => setAutoSend((v) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoSend ? 'bg-blue-500' : 'bg-white/20'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${autoSend ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                Enable auto reports
              </label>

              <div className={`flex flex-col gap-1 ${autoSend ? '' : 'opacity-40 pointer-events-none'}`}>
                <label className="text-xs text-slate-300">Frequency</label>
                <select value={frequency} onChange={(e) => setFrequency(e.target.value)}
                  className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100">
                  {FREQUENCY_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value} className="bg-slate-800">{f.label}</option>
                  ))}
                </select>
              </div>

              <div className={`flex flex-col gap-1 ${autoSend && frequency === 'monthly' ? '' : 'opacity-40 pointer-events-none'}`}>
                <label className="text-xs text-slate-300">Day of month</label>
                <select value={scheduleDay} onChange={(e) => setScheduleDay(Number(e.target.value))}
                  className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100">
                  {DAY_OPTIONS.map((d) => (
                    <option key={d} value={d} className="bg-slate-800">{ordinal(d)}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <button onClick={handleSaveSchedule} disabled={scheduleSaving}
                  className="flex items-center gap-2 rounded-lg border border-blue-300/30 bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-100 hover:bg-blue-500/35 disabled:opacity-50 transition-all">
                  {scheduleSaving ? <Spinner /> : null}
                  {scheduleSaving ? 'Saving…' : 'Save Schedule'}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300 space-y-1">
            <p><span className="text-slate-400">Recipient summary:</span> {recipients.length ? recipients.join(', ') : 'No super admin emails configured'}</p>
          </div>

          <Alert {...(scheduleResult || {})} />
        </GlassCard>

        {/* Current Schedule */}
        <GlassCard className="p-5 space-y-3">
          <h2 className="text-base font-medium text-white">Current Schedule</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs text-slate-400">Auto send</p>
              <p className="text-white mt-1">{autoSend ? 'Enabled' : 'Disabled'}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs text-slate-400">Frequency</p>
              <p className="text-white mt-1 capitalize">{frequency}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs text-slate-400">Next execution</p>
              <p className="text-white mt-1">{formatDateTime(scheduleMeta.nextExecution)}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs text-slate-400">Last execution</p>
              <p className="text-white mt-1">{formatDateTime(scheduleMeta.lastExecution)}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs text-slate-400">Last status</p>
              <p className="text-white mt-1 capitalize">{scheduleMeta.lastStatus || '—'}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs text-slate-400">Recipients</p>
              <p className="text-white mt-1">{recipients.length} super admin(s)</p>
            </div>
          </div>
        </GlassCard>

        {/* Report History */}
        <GlassCard className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-medium text-white">Report History</h2>
              <p className="text-xs text-slate-300 mt-1">Previously generated reports for your company.</p>
            </div>
            <button onClick={loadHistory} disabled={historyLoading}
              className="text-xs text-blue-200 hover:text-blue-100 underline disabled:opacity-50">
              Refresh
            </button>
          </div>

          {historyLoading ? (
            <div className="h-32 rounded-xl skeleton" />
          ) : history.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">No reports generated yet.</p>
          ) : (
            <GlassTable columns={[
              { key: 'id', label: 'Report ID' },
              { key: 'company', label: 'Company' },
              { key: 'by', label: 'Generated By' },
              { key: 'at', label: 'Generated At' },
              { key: 'type', label: 'Type' },
              { key: 'status', label: 'Status' },
              { key: 'size', label: 'PDF' },
              { key: 'email', label: 'Email' },
              { key: 'actions', label: 'Actions' },
            ]}>
              {history.map((r) => (
                <tr key={r.reportId} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-3 font-mono text-xs text-slate-300">{r.reportId.slice(0, 8)}…</td>
                  <td className="p-3">{r.companyName}</td>
                  <td className="p-3 text-slate-300">{r.generatedBy}</td>
                  <td className="p-3 text-slate-300 text-xs">{formatDateTime(r.generatedAt)}</td>
                  <td className="p-3 capitalize">{r.reportType}</td>
                  <td className="p-3"><StatusBadge status={r.generationStatus} /></td>
                  <td className="p-3 text-slate-300">{formatFileSize(r.fileSize)}</td>
                  <td className="p-3"><StatusBadge status={r.emailStatus} /></td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => handlePreview(r.reportId)} disabled={rowAction === r.reportId}
                        className="text-xs text-blue-200 hover:text-blue-100 underline disabled:opacity-50">View</button>
                      <button onClick={() => handleDownload(r)} disabled={rowAction === r.reportId}
                        className="text-xs text-blue-200 hover:text-blue-100 underline disabled:opacity-50">Download</button>
                      <button onClick={() => handleResend(r.reportId)} disabled={rowAction === r.reportId}
                        className="text-xs text-emerald-200 hover:text-emerald-100 underline disabled:opacity-50">Resend</button>
                      <button onClick={() => handleDelete(r.reportId)} disabled={rowAction === r.reportId}
                        className="text-xs text-red-300 hover:text-red-200 underline disabled:opacity-50">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </GlassTable>
          )}
        </GlassCard>
      </PermissionGate>
    </div>
  );
}
