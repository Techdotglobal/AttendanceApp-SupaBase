import { NavLink, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../features/auth/store/authStore';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/users', label: 'Users' },
  { to: '/departments', label: 'Departments' },
  { to: '/sites', label: 'Sites' },
  { to: '/attendance', label: 'Attendance' },
  { to: '/leaves', label: 'Leaves' },
];

export function AppShell() {
  const { user, logout } = useAuthStore();
  const items = user?.role === 'manager' ? navItems.filter((i) => i.to !== '/departments') : navItems;
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      <aside className="w-64 border-r border-slate-800 p-4 hidden md:block">
        <p className="font-semibold mb-4">Hadir.AI Admin</p>
        <div className="space-y-2">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `block rounded-md px-3 py-2 ${isActive ? 'bg-indigo-600' : 'bg-slate-900'}`}>
              {item.label}
            </NavLink>
          ))}
        </div>
        <button onClick={logout} className="mt-6 w-full rounded-md bg-slate-800 px-3 py-2">Logout</button>
      </aside>
      <main className="flex-1 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
