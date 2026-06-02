import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../features/auth/store/authStore';

const navItems = [
  {
    to: '/',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 13h8V3H3v10Zm0 8h8v-4H3v4Zm10 0h8V11h-8v10Zm0-18v4h8V3h-8Z" />
      </svg>
    ),
  },
  {
    to: '/users',
    label: 'Users',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    to: '/departments',
    label: 'Departments',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 21h18" />
        <path d="M5 21V7l7-4 7 4v14" />
        <path d="M9 11h6M9 15h6" />
      </svg>
    ),
  },
  {
    to: '/analytics',
    label: 'Analytics',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 3v18h18" />
        <path d="m19 9-5 5-4-4-4 4" />
      </svg>
    ),
  },
  {
    to: '/reports',
    label: 'Reports',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    ),
  },
];

export function AppShell() {
  const { user, logout } = useAuthStore();
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [search, setSearch] = useState('');

  const items = useMemo(() => {
    if (user?.role === 'manager') {
      return navItems.filter((i) => i.to !== '/settings');
    }
    return navItems;
  }, [user?.role]);

  const pageTitle = useMemo(() => {
    const matched = items.find((i) => i.to === location.pathname);
    return matched?.label || 'Dashboard';
  }, [items, location.pathname]);

  const initials = (user?.name || user?.username || 'A')
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');

  return (
    <div className="relative min-h-screen flex text-slate-100 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#0F172A,#1E3A8A,#3B82F6)]" />
      <div className="absolute -left-40 -top-24 h-[28rem] w-[28rem] rounded-full bg-blue-400/20 blur-3xl animate-float-slow" />
      <div className="absolute -right-32 bottom-0 h-[26rem] w-[26rem] rounded-full bg-cyan-300/20 blur-3xl animate-float-slower" />

      <aside className={`relative hidden md:flex flex-col m-4 rounded-2xl border border-white/15 bg-white/10 backdrop-blur-xl transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-64'}`}>
        <div className="h-16 px-4 border-b border-white/10 flex items-center justify-between">
          {!isCollapsed && <p className="font-semibold text-slate-100">Hadir.ai Admin</p>}
          <button
            type="button"
            className="rounded-md border border-white/20 p-1.5 text-slate-200 hover:bg-white/10"
            onClick={() => setIsCollapsed((prev) => !prev)}
            aria-label="Toggle sidebar"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        </div>

        <div className="p-3 space-y-1.5">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ${
                isActive
                  ? 'text-white bg-blue-500/25 border border-blue-300/35 shadow-[0_0_0_1px_rgba(59,130,246,0.2),0_8px_20px_rgba(37,99,235,0.25)]'
                  : 'text-slate-200 hover:bg-white/10 border border-transparent'
              }`}
            >
              <span className="text-blue-200">{item.icon}</span>
              {!isCollapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </div>

        <div className="mt-auto p-3">
          <button onClick={logout} className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10 transition-all duration-200">
            {isCollapsed ? '↩' : 'Logout'}
          </button>
        </div>
      </aside>

      <div className="relative flex-1 min-w-0 p-4 pl-0 md:pl-0">
        <header className="h-16 rounded-2xl border border-white/15 bg-white/10 backdrop-blur-xl px-4 md:px-6 flex items-center gap-4">
          <p className="text-sm md:text-base font-semibold text-slate-100 min-w-fit">{pageTitle}</p>

          <div className="flex-1 max-w-xl">
            <div className="relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users, roles..."
                className="w-full rounded-xl border border-white/20 bg-white/10 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-300/80 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300/40 transition-all duration-200"
              />
              <svg viewBox="0 0 24 24" className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>
          </div>

          <button className="relative rounded-lg border border-white/20 bg-white/5 p-2 text-slate-100 hover:bg-white/15 transition-all duration-200" aria-label="Notifications">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
              <path d="M9 17a3 3 0 0 0 6 0" />
            </svg>
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-blue-600" />
          </button>

          <div className="relative">
            <button
              className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-2 py-1.5 hover:bg-white/15 transition-all duration-200"
              onClick={() => setShowProfile((prev) => !prev)}
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-200/20 text-blue-100 text-xs font-semibold">
                {initials}
              </span>
              <span className="hidden md:block text-sm text-slate-100">{user?.name || user?.username || 'Admin'}</span>
            </button>

            {showProfile && (
              <div className="absolute right-0 top-11 w-52 rounded-lg border border-white/20 bg-slate-900/70 p-2 backdrop-blur-xl shadow-sm z-20">
                <p className="px-2 py-1 text-xs text-slate-300">Signed in as {user?.role}</p>
                <button onClick={logout} className="mt-1 w-full rounded-md px-2 py-2 text-left text-sm text-slate-100 hover:bg-white/10">
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="p-4 md:p-6">
          <Outlet context={{ globalSearch: search }} />
        </main>
      </div>
    </div>
  );
}
