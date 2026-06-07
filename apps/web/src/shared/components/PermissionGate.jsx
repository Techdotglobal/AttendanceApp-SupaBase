import { useAuthStore } from '../../features/auth/store/authStore';
import { hasAnyPermission, hasPermission } from '../../features/admin/permissions';
import { GlassCard } from './GlassCard';

export function AccessDenied() {
  return (
    <div className="min-h-[50vh] grid place-items-center">
      <GlassCard className="max-w-md p-6 text-center">
        <h1 className="text-xl font-semibold text-white">Access Denied</h1>
        <p className="mt-2 text-sm text-slate-200">
          You do not have permission to access this feature.
        </p>
      </GlassCard>
    </div>
  );
}

export function usePermission(permission) {
  const { user } = useAuthStore();
  return hasPermission(user, permission);
}

export function useAnyPermission(permissions = []) {
  const { user } = useAuthStore();
  return hasAnyPermission(user, permissions);
}

export function PermissionGate({ permission, anyOf, children, fallback = null }) {
  const { user } = useAuthStore();
  const allowed = permission
    ? hasPermission(user, permission)
    : hasAnyPermission(user, anyOf || []);

  if (!allowed) return fallback;
  return children;
}
