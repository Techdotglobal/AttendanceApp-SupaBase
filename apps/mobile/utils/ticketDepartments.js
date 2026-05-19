/**
 * Ticket department resolution — dynamic departments from tenant API (no hardcoded lists).
 */
import { fetchTenantDepartments } from '../core/api/tenantOrgApi';
import { departmentLookupKey, departmentNamesMatch } from './orgNormalize';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Legacy slug → display name (read-only for old tickets stored before department UUIDs). */
const LEGACY_SLUG_LABELS = {
  engineering: 'Engineering',
  technical: 'Technical',
  hr: 'HR',
  finance: 'Finance',
  sales: 'Sales',
  facilities: 'Facilities',
  other: 'Other',
};

/** Legacy slug → department display name used for manager matching. */
const LEGACY_SLUG_DEPARTMENT_NAMES = {
  engineering: 'Engineering',
  technical: 'Technical',
  hr: 'HR',
  finance: 'Finance',
  sales: 'Sales',
  facilities: 'Facilities',
};

export function isDepartmentUuid(value) {
  return UUID_REGEX.test(String(value || '').trim());
}

export async function fetchTicketDepartments(requester = null) {
  return fetchTenantDepartments(requester, { scope: 'all' });
}

/** Alias for tickets, leaves, and other org pickers */
export const fetchOrgDepartments = fetchTicketDepartments;

/**
 * Resolve a ticket `category` value (department UUID or legacy slug/name) to a department row.
 * @param {string} categoryValue
 * @param {Array<{ id: string, name: string, normalized_name?: string }>} departments
 */
export function findDepartmentByCategoryValue(categoryValue, departments) {
  if (!categoryValue || !Array.isArray(departments) || departments.length === 0) {
    return null;
  }

  const raw = String(categoryValue).trim();
  if (isDepartmentUuid(raw)) {
    const byId = departments.find((d) => String(d.id) === raw);
    if (byId) return byId;
  }

  const key = departmentLookupKey(raw);
  if (!key) return null;

  const byName = departments.find(
    (d) =>
      departmentLookupKey(d.name) === key ||
      (d.normalized_name && departmentLookupKey(d.normalized_name) === key)
  );
  if (byName) return byName;

  const legacyName = LEGACY_SLUG_DEPARTMENT_NAMES[key] || LEGACY_SLUG_LABELS[key];
  if (legacyName) {
    return (
      departments.find((d) => departmentNamesMatch(d.name, legacyName)) || null
    );
  }

  return null;
}

/**
 * Human-readable label for ticket category (department).
 * @param {string} category
 * @param {Array|null} departmentCatalog
 */
export function getCategoryLabel(category, departmentCatalog = null) {
  if (!category) return 'Unknown';

  const dept = findDepartmentByCategoryValue(category, departmentCatalog);
  if (dept?.name) return dept.name;

  const slugKey = departmentLookupKey(category);
  if (LEGACY_SLUG_LABELS[slugKey]) return LEGACY_SLUG_LABELS[slugKey];

  if (isDepartmentUuid(category)) return 'Department';

  return String(category)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Whether a ticket's category targets the manager's department.
 */
export function categoryMatchesManagerDepartment(
  ticketCategory,
  managerUser,
  departments
) {
  if (!ticketCategory || !managerUser) return false;

  const ticketDept = findDepartmentByCategoryValue(ticketCategory, departments);
  if (ticketDept) {
    const managerDeptId =
      managerUser.departmentId ?? managerUser.department_id ?? null;
    if (
      managerDeptId &&
      String(ticketDept.id) === String(managerDeptId)
    ) {
      return true;
    }
    if (
      managerUser.department &&
      departmentNamesMatch(ticketDept.name, managerUser.department)
    ) {
      return true;
    }
    return false;
  }

  const slugKey = departmentLookupKey(ticketCategory);
  const legacyDeptName = LEGACY_SLUG_DEPARTMENT_NAMES[slugKey];
  if (
    legacyDeptName &&
    managerUser.department &&
    departmentNamesMatch(legacyDeptName, managerUser.department)
  ) {
    return true;
  }

  return (
    managerUser.department &&
    departmentNamesMatch(ticketCategory, managerUser.department)
  );
}

/**
 * Filter tickets visible to a non–super-admin / non–HR-admin manager.
 */
export function filterTicketsForManager(
  tickets,
  managerUser,
  departments,
  manageableEmployeeUsernames = new Set()
) {
  if (!Array.isArray(tickets)) return [];
  const names =
    manageableEmployeeUsernames instanceof Set
      ? manageableEmployeeUsernames
      : new Set(manageableEmployeeUsernames);

  return tickets.filter((ticket) => {
    if (ticket.assignedTo === managerUser.username) return true;
    if (names.has(ticket.createdBy)) return true;
    return categoryMatchesManagerDepartment(
      ticket.category,
      managerUser,
      departments
    );
  });
}

/**
 * Whether a manager may act on a ticket (close, etc.).
 */
export function managerCanManageTicket(ticket, managerUser, departments) {
  if (!ticket || !managerUser) return false;
  if (ticket.assignedTo === managerUser.username) return true;
  return categoryMatchesManagerDepartment(
    ticket.category,
    managerUser,
    departments
  );
}
