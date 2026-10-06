import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { createLenis, destroyLenis, getLenis, resetScrollPosition } from '../lib/smoothScroll';
import { usePageScrollLock } from '../lib/usePageScrollLock';
import { Menu, X } from 'lucide-react';
import { AppIcon } from './AppIcon';
import { useAuthStore } from '../../features/auth/store/authStore';
import { canAccessFeature, hasAnyPermission, hasPermission, isSuperAdmin } from '../../features/admin/permissions';
import { useNotificationStore } from '../../features/notifications/store/notificationStore';
import { useSilentPoll } from '../hooks/useSilentPoll';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { PageChromeProvider } from './pageChrome';
import { ALL_NAV_ITEMS } from './navConfig';
import { CountBadge } from './ui/CountBadge';
import { DirectorySkeleton } from './ui/Skeleton';

export function AppShell() {
  const { user, logout, refreshPermissions } = useAuthStore();
  const { unreadCount, refresh: refreshBadge } = useNotificationStore();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mainRef = useRef(null);
  const contentRef = useRef(null);
  const fillsViewport =
    location.pathname === '/sites' ||
    location.pathname === '/calendar' ||
    location.pathname === '/manager-permissions' ||
    location.pathname === '/tickets';

  useEffect(() => {
    if (!user) return undefined;
    refreshBadge();
    const onFocus = () => {
      refreshPermissions();
      refreshBadge();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user?.uid, refreshPermissions, refreshBadge]);

  useEffect(() => {
    const wrapper = mainRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return undefined;
    createLenis({ wrapper, content });
    return () => destroyLenis();
  }, []);

  useSilentPoll(() => refreshBadge(), 30000, [user?.uid]);
  usePageScrollLock(mobileNavOpen);

  const canSee = useMemo(() => {
    return (item) => {
      const delegatedPayroll = item.feature === 'payroll' && hasAnyPermission(user, ['view_payroll', 'manage_payroll']);
      const delegatedPermissionsAdmin = item.feature === 'permissions' && hasPermission(user, 'assign_user_permissions');
      if (item.superAdminOnly && !isSuperAdmin(user) && !delegatedPayroll && !delegatedPermissionsAdmin) return false;
      if (item.feature && !canAccessFeature(user, item.feature)) return false;
      return true;
    };
  }, [user]);

  const items = useMemo(() => ALL_NAV_ITEMS.filter(canSee), [canSee]);

  const mobileNavItems = useMemo(() => {
    const primary = ['/dashboard', '/attendance', '/leaves', '/notifications'];
    return items.filter((item) => primary.includes(item.to));
  }, [items]);

  useEffect(() => {
    setMobileNavOpen(false);
    resetScrollPosition();
    const lenis = getLenis();
    if (lenis) {
      // Pages that own their internal scroll regions don't want the page-level
      // smooth scroller competing for the wheel; everywhere else it drives the
      // main column. (Replaces Lenis `autoToggle`, which raced with our
      // imperative scroll locks — see smoothScroll.js.)
      if (fillsViewport) lenis.stop();
      else lenis.start();
      lenis.resize();
    }
  }, [location.pathname, fillsViewport]);

  return (
    <div className="app-admin-surface m-0 flex h-dvh w-full overflow-hidden bg-[#E8F3F8] p-0 text-ink md:p-4">
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-none md:rounded-3xl md:shadow-[0_24px_64px_-16px_rgba(15,23,42,0.18)]">
        <Sidebar
          canSee={canSee}
          onLogout={logout}
          unreadCount={unreadCount}
          layoutGroupId="admin-sidebar-desktop"
          className="hidden rounded-l-3xl md:flex"
        />

        <PageChromeProvider>
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#F8FAFC] md:rounded-r-3xl">
          <TopBar
            pathname={location.pathname}
            canSee={canSee}
            unreadCount={unreadCount}
            onOpenMobileNav={() => setMobileNavOpen(true)}
          />

          <main
            ref={mainRef}
            className={`admin-main main-content-container flex min-h-0 flex-1 flex-col bg-[#F8FAFC] px-4 text-ink md:px-6 ${
              fillsViewport ? 'overflow-hidden' : 'overflow-y-auto'
            }`}
          >
            <div
              ref={contentRef}
              className={
                fillsViewport
                  ? 'flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden'
                  : 'mx-auto w-full min-w-0 max-w-[1600px]'
              }
            >
              <Suspense fallback={<DirectorySkeleton kpis={location.pathname.startsWith('/leaves') ? 4 : 0} />}>
                <Outlet />
              </Suspense>
            </div>
          </main>
        </div>
        </PageChromeProvider>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-100 bg-white/92 px-2 pb-safe backdrop-blur-2xl md:hidden">
        <div className="flex items-stretch justify-around">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-micro font-medium transition-colors duration-200 ${
                    isActive ? 'text-[#00B0FF]' : 'text-[#8898AA]'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <AppIcon
                      icon={Icon}
                      className={isActive ? 'text-[#00B0FF]' : 'text-current'}
                    />
                    <span>{item.label}</span>
                    {item.to === '/notifications' && (
                      <CountBadge
                        count={unreadCount}
                        className="absolute right-[calc(50%-1.15rem)] top-0.5"
                      />
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-micro font-medium text-[#8898AA]"
          >
            <AppIcon icon={Menu} />
            <span>More</span>
          </button>
        </div>
      </nav>

      <div className={`fixed inset-0 z-30 md:hidden ${mobileNavOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <div
          className={`absolute inset-0 bg-slate-950/30 backdrop-blur-sm transition-opacity ${mobileNavOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setMobileNavOpen(false)}
        />
        <aside
          className={`nav-surface absolute left-0 top-0 flex h-full max-h-dvh w-[min(20rem,85vw)] flex-col overflow-hidden rounded-r-3xl shadow-xl transition-transform duration-200 ${
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          data-lenis-prevent
        >
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-[10px] text-white/85 transition-colors hover:bg-white/15 hover:text-white"
            aria-label="Close menu"
          >
            <AppIcon icon={X} size={20} />
          </button>
          <Sidebar
            canSee={canSee}
            onLogout={logout}
            unreadCount={unreadCount}
            layoutGroupId="admin-sidebar-mobile"
            className="flex h-full w-full"
          />
        </aside>
      </div>
    </div>
  );
}
