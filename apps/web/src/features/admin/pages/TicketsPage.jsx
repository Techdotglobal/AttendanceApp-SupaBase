import { GlassCard } from '../../../shared/components/GlassCard';
import { PermissionGate } from '../../../shared/components/PermissionGate';
import { PERMISSIONS } from '../permissions';

export function TicketsPage() {
  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <h1 className="text-2xl font-semibold text-white">Tickets</h1>
        <p className="mt-1 text-sm text-slate-200">Ticket management workspace.</p>
      </div>

      <PermissionGate
        anyOf={[PERMISSIONS.VIEW_TICKETS, PERMISSIONS.MANAGE_TICKETS, PERMISSIONS.ASSIGN_TICKETS, PERMISSIONS.CLOSE_TICKETS]}
      >
        <GlassCard className="p-5 text-sm text-slate-200">No tickets available.</GlassCard>
      </PermissionGate>

      <PermissionGate permission={PERMISSIONS.MANAGE_TICKETS}>
        <GlassCard className="p-5 space-y-2">
          <h2 className="text-sm font-medium text-white">Ticket Actions</h2>
          <p className="text-sm text-slate-300">Create, update, and manage support tickets.</p>
          <button type="button" className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 transition-all duration-200">
            Create Ticket
          </button>
        </GlassCard>
      </PermissionGate>

      <PermissionGate permission={PERMISSIONS.ASSIGN_TICKETS}>
        <GlassCard className="p-5 space-y-2">
          <h2 className="text-sm font-medium text-white">Assignment Controls</h2>
          <p className="text-sm text-slate-300">Assign tickets to team members.</p>
          <button type="button" className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-slate-100 hover:bg-white/20 transition-all duration-200">
            Assign Ticket
          </button>
        </GlassCard>
      </PermissionGate>

      <PermissionGate permission={PERMISSIONS.CLOSE_TICKETS}>
        <GlassCard className="p-5 space-y-2">
          <h2 className="text-sm font-medium text-white">Close Ticket</h2>
          <p className="text-sm text-slate-300">Resolve and close open tickets.</p>
          <button type="button" className="rounded-lg border border-green-300/30 bg-green-500/20 px-3 py-2 text-sm text-green-100 hover:bg-green-500/35 transition-all duration-200">
            Close Ticket
          </button>
        </GlassCard>
      </PermissionGate>
    </div>
  );
}
