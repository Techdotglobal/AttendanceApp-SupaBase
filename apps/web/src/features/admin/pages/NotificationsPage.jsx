import { GlassCard } from '../../../shared/components/GlassCard';
import { PermissionGate } from '../../../shared/components/PermissionGate';
import { PERMISSIONS } from '../permissions';

export function NotificationsPage() {
  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <h1 className="text-2xl font-semibold text-white">Notifications</h1>
        <p className="mt-1 text-sm text-slate-200">Manage company-wide notification settings and broadcasts.</p>
      </div>

      <PermissionGate permission={PERMISSIONS.MANAGE_NOTIFICATIONS}>
        <GlassCard className="p-5 space-y-4">
          <h2 className="text-sm font-medium text-white">Notification Management</h2>
          <p className="text-sm text-slate-200">
            Configure push notifications, email alerts, and in-app announcements for your organization.
          </p>
          <div className="rounded-lg border border-blue-300/20 bg-blue-500/10 px-4 py-3 text-xs text-blue-100">
            Notification configuration workspace — connect backend services to enable full management.
          </div>
        </GlassCard>
      </PermissionGate>
    </div>
  );
}
