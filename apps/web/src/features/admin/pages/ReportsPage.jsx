import { useEffect, useState } from 'react';
import { GlassCard } from '../../../shared/components/GlassCard';
import { adminService } from '../services/adminService';

const RANGE_OPTIONS = [
  { value: 'monthly', label: 'Monthly (previous month)' },
  { value: 'weekly', label: 'Weekly (last 7 days)' },
  { value: 'yearly', label: 'Yearly (previous year)' },
  { value: 'all', label: 'All time' },
];

const DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => i + 1);

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function ReportsPage() {
  // Send Now state
  const [sendRange, setSendRange] = useState('monthly');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null); // { ok, message, reportId }

  // Schedule state
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleDay, setScheduleDay] = useState(1);
  const [autoSend, setAutoSend] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleResult, setScheduleResult] = useState(null); // { ok, message }

  useEffect(() => {
    adminService.getReportSchedule()
      .then((s) => {
        if (s) {
          setScheduleDay(s.day ?? 1);
          setAutoSend(s.autoSend ?? true);
        }
      })
      .catch(() => {})
      .finally(() => setScheduleLoading(false));
  }, []);

  async function handleSendNow() {
    setSending(true);
    setSendResult(null);
    try {
      const res = await adminService.sendReportNow();
      setSendResult({ ok: true, message: res.message || 'Report generation started. Check your email shortly.' });
    } catch (err) {
      setSendResult({ ok: false, message: err.message || 'Failed to send report. Please try again.' });
    } finally {
      setSending(false);
    }
  }

  async function handleGenerateReport() {
    setSending(true);
    setSendResult(null);
    try {
      const res = await adminService.generateReport({ range: sendRange });
      setSendResult({
        ok: true,
        message: res.message || 'Report generation started.',
        reportId: res.reportId,
      });
    } catch (err) {
      setSendResult({ ok: false, message: err.message || 'Failed to generate report.' });
    } finally {
      setSending(false);
    }
  }

  async function handleSaveSchedule() {
    setScheduleSaving(true);
    setScheduleResult(null);
    try {
      await adminService.updateReportSchedule({ day: scheduleDay, autoSend });
      setScheduleResult({ ok: true, message: `Schedule saved: ${autoSend ? `${ordinal(scheduleDay)} of each month at 02:00 UTC` : 'Auto-send disabled'}` });
    } catch (err) {
      setScheduleResult({ ok: false, message: err.message || 'Failed to save schedule.' });
    } finally {
      setScheduleSaving(false);
    }
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <h1 className="text-2xl font-semibold text-white">Reports</h1>

      {/* ── Send Report Now ────────────────────────────────────── */}
      <GlassCard className="p-5 space-y-4">
        <h2 className="text-sm font-medium text-white">Send Report Now</h2>
        <p className="text-xs text-slate-300">
          Generate a report immediately and email it to all super admins of your company.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-300">Report range</label>
            <select
              value={sendRange}
              onChange={(e) => setSendRange(e.target.value)}
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-300/40"
            >
              {RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-slate-800">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleGenerateReport}
            disabled={sending}
            className="flex items-center gap-2 rounded-lg border border-blue-300/30 bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-100 hover:bg-blue-500/35 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {sending ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M22 2 11 13" />
                <path d="m22 2-7 20-4-9-9-4 20-7z" />
              </svg>
            )}
            {sending ? 'Sending…' : 'Generate & Email Report'}
          </button>

          <button
            onClick={handleSendNow}
            disabled={sending}
            className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="m8 21 4-4 4 4" />
              <path d="M12 17V21" />
            </svg>
            Monthly Report (Email Only)
          </button>
        </div>

        {sendResult && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${sendResult.ok ? 'border-green-300/25 bg-green-500/15 text-green-100' : 'border-red-300/25 bg-red-500/15 text-red-100'}`}>
            {sendResult.message}
            {sendResult.ok && sendResult.reportId && (
              <a
                href={adminService.downloadReport(sendResult.reportId)}
                target="_blank"
                rel="noreferrer"
                className="ml-3 underline text-blue-200 hover:text-blue-100"
              >
                Download PDF
              </a>
            )}
          </div>
        )}
      </GlassCard>

      {/* ── Auto-Send Schedule ─────────────────────────────────── */}
      <GlassCard className="p-5 space-y-4">
        <h2 className="text-sm font-medium text-white">Scheduled Auto-Send</h2>
        <p className="text-xs text-slate-300">
          The system will automatically email the monthly report on your chosen day of every month at 02:00 AM UTC.
        </p>

        {scheduleLoading ? (
          <div className="h-20 rounded-xl skeleton" />
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex items-center gap-3">
              <label className="text-sm text-slate-200 select-none cursor-pointer flex items-center gap-2">
                <button
                  role="switch"
                  aria-checked={autoSend}
                  onClick={() => setAutoSend((v) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-300/40 ${autoSend ? 'bg-blue-500' : 'bg-white/20'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${autoSend ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                Auto-send enabled
              </label>
            </div>

            <div className={`flex flex-col gap-1 transition-opacity duration-200 ${autoSend ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <label className="text-xs text-slate-300">Day of month</label>
              <select
                value={scheduleDay}
                onChange={(e) => setScheduleDay(Number(e.target.value))}
                className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-300/40"
              >
                {DAY_OPTIONS.map((d) => (
                  <option key={d} value={d} className="bg-slate-800">
                    {ordinal(d)}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleSaveSchedule}
              disabled={scheduleSaving}
              className="flex items-center gap-2 rounded-lg border border-blue-300/30 bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-100 hover:bg-blue-500/35 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {scheduleSaving ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
              )}
              {scheduleSaving ? 'Saving…' : 'Save Schedule'}
            </button>
          </div>
        )}

        {scheduleResult && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${scheduleResult.ok ? 'border-green-300/25 bg-green-500/15 text-green-100' : 'border-red-300/25 bg-red-500/15 text-red-100'}`}>
            {scheduleResult.message}
          </div>
        )}

        {!scheduleLoading && (
          <div className="rounded-lg border border-blue-300/20 bg-blue-500/10 px-4 py-3 text-xs text-blue-100">
            Current schedule: {autoSend
              ? `Monthly report auto-sends on the ${ordinal(scheduleDay)} of each month at 02:00 AM UTC`
              : 'Auto-send is disabled — reports must be sent manually'}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
