import {
  BarChart3,
  Building2,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  FileBarChart,
  Laptop2,
  LayoutGrid,
  ListChecks,
  MapPin,
  Settings2,
  ShieldCheck,
  Ticket,
  UsersRound,
  Bell,
  Wallet,
} from 'lucide-react';

/**
 * Grouped sidebar navigation.
 * `feature` / `superAdminOnly` map to the same permission checks as the router.
 */
export const NAV_SECTIONS = [
  {
    id: 'overview',
    label: 'Main',
    // Notifications joins this group in the sidebar; it lives on its own export
    // because the header bell and the mobile tab bar both reach for it directly.
    items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutGrid }],
  },
  {
    id: 'workforce',
    label: 'Workforce',
    items: [
      { to: '/users', label: 'Users', feature: 'users', icon: UsersRound },
      { to: '/departments', label: 'Departments', feature: 'departments', icon: Building2 },
      { to: '/attendance', label: 'Attendance', feature: 'attendance', icon: CalendarCheck2 },
      { to: '/attendance-rules', label: 'Attendance rules', feature: 'attendanceRules', icon: CalendarClock },
      { to: '/work-mode-requests', label: 'Work modes', feature: 'workModeRequests', icon: Laptop2 },
      { to: '/sites', label: 'Geofencing', feature: 'sites', icon: MapPin },
      { to: '/calendar', label: 'Calendar', feature: 'calendar', icon: CalendarDays },
    ],
  },
  {
    id: 'hr',
    label: 'HR Management',
    items: [
      { to: '/leaves', label: 'Leaves', feature: 'leaves', icon: CalendarClock },
      {
        to: '/approval-workflows',
        label: 'Approvals',
        feature: 'approvalWorkflows',
        superAdminOnly: true,
        icon: ListChecks,
      },
      {
        to: '/manager-permissions',
        label: 'Permissions',
        feature: 'permissions',
        superAdminOnly: true,
        icon: ShieldCheck,
      },
      { to: '/tickets', label: 'Tickets', feature: 'tickets', icon: Ticket },
      { to: '/payroll', label: 'Payroll', feature: 'payroll', superAdminOnly: true, icon: Wallet },
    ],
  },
  {
    id: 'insights',
    label: 'Analytics',
    items: [
      { to: '/analytics', label: 'Analytics', feature: 'analytics', icon: BarChart3 },
      { to: '/reports', label: 'Reports', feature: 'reports', icon: FileBarChart },
    ],
  },
];

/** Pinned bottom section (Logout is rendered as a button, not a route). */
export const NAV_FOOTER_ITEMS = [
  { to: '/settings', label: 'Settings', feature: 'settings', icon: Settings2 },
];

/** Reachable from the header bell; kept here for mobile nav + page titles. */
export const NOTIFICATIONS_ITEM = {
  to: '/notifications',
  label: 'Notifications',
  feature: 'notifications',
  icon: Bell,
};

/** Flat list of every navigable item, unfiltered. */
export const ALL_NAV_ITEMS = [
  ...NAV_SECTIONS.flatMap((section) => section.items),
  NOTIFICATIONS_ITEM,
  ...NAV_FOOTER_ITEMS,
];
