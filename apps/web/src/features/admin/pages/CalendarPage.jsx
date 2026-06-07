import { GlassCard } from '../../../shared/components/GlassCard';
import { PermissionGate } from '../../../shared/components/PermissionGate';
import { PERMISSIONS } from '../permissions';

export function CalendarPage() {
  return (
    <div className="space-y-5 animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Calendar</h1>
          <p className="mt-1 text-sm text-slate-200">Company calendar workspace.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PermissionGate permission={PERMISSIONS.CREATE_EVENTS}>
            <button type="button" className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 transition-all duration-200">
              Create Event
            </button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.EDIT_EVENTS}>
            <button type="button" className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/20 transition-all duration-200">
              Edit Event
            </button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.DELETE_EVENTS}>
            <button type="button" className="rounded-lg border border-red-200/40 bg-red-500/15 px-3 py-2 text-sm text-red-100 hover:bg-red-500/25 transition-all duration-200">
              Delete Event
            </button>
          </PermissionGate>
        </div>
      </div>

      <PermissionGate
        anyOf={[PERMISSIONS.CREATE_EVENTS, PERMISSIONS.EDIT_EVENTS, PERMISSIONS.DELETE_EVENTS]}
      >
        <GlassCard className="p-5 text-sm text-slate-200">No events available.</GlassCard>
      </PermissionGate>
    </div>
  );
}
