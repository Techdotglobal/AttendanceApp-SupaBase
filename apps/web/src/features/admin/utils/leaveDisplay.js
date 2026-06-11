export const UNKNOWN_EMPLOYEE = 'Unknown Employee';

const INTERNAL_ID_PATTERN = /^emp_|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isInternalEmployeeId = (value) => {
  if (!value) return false;
  return INTERNAL_ID_PATTERN.test(String(value));
};

const LEAVE_TYPE_LABELS = {
  annual: 'Annual Leave',
  sick: 'Sick Leave',
  casual: 'Casual Leave',
};

export const formatLeaveTypeLabel = (type) => {
  if (!type) return 'Leave';
  const key = String(type).toLowerCase();
  return LEAVE_TYPE_LABELS[key] || type.charAt(0).toUpperCase() + type.slice(1);
};

export const formatLeaveStatus = (status) => {
  if (!status) return 'Pending';
  const label = String(status).replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const normalizeKey = (value) => {
  if (value == null) return null;
  const str = String(value).trim();
  return str ? str.toLowerCase() : null;
};

const extractUidFromEmployeeId = (employeeId) => {
  if (!employeeId) return null;
  const str = String(employeeId).trim();
  if (str.startsWith('emp_')) return normalizeKey(str.slice(4));
  if (INTERNAL_ID_PATTERN.test(str) && !str.startsWith('emp_')) return normalizeKey(str);
  return null;
};

/**
 * Client-side join when API enrichment is unavailable or incomplete.
 * @param {Array} leaves
 * @param {Array} users
 * @returns {Array}
 */
export const enrichLeavesWithUsers = (leaves = [], users = []) => {
  if (!leaves.length || !users.length) return leaves;

  const byUid = new Map();
  const byUsername = new Map();
  for (const user of users) {
    const uidKey = normalizeKey(user.uid);
    if (uidKey) byUid.set(uidKey, user);
    const idKey = normalizeKey(user.id);
    if (idKey) byUid.set(idKey, user);
    const usernameKey = normalizeKey(user.username);
    if (usernameKey) byUsername.set(usernameKey, user);
  }

  const resolveUser = (leave) => {
    const uidCandidates = [
      normalizeKey(leave.employee_uid || leave.employeeUid),
      extractUidFromEmployeeId(leave.employee_id || leave.employeeId),
    ].filter(Boolean);
    for (const key of uidCandidates) {
      const hit = byUid.get(key);
      if (hit) return hit;
    }
    const legacyId = leave.employee_id || leave.employeeId;
    if (legacyId && !String(legacyId).startsWith('emp_') && !isInternalEmployeeId(legacyId)) {
      const byName = byUsername.get(normalizeKey(legacyId));
      if (byName) return byName;
    }
    const storedUsername = normalizeKey(leave.employee_username || leave.employeeUsername);
    if (storedUsername && byUsername.has(storedUsername)) {
      return byUsername.get(storedUsername);
    }
    return null;
  };

  return leaves.map((leave) => {
    if (leave.employee_name || leave.employeeName) return leave;
    const user = resolveUser(leave);
    if (!user) return leave;
    return {
      ...leave,
      employee_name: user.name || leave.employee_name || null,
      employee_username: user.username || leave.employee_username || null,
      employee_department: user.department || leave.employee_department || null,
    };
  });
};

export const formatEmployeeDisplay = (leave) => {
  const name = leave?.employee_name || leave?.employeeName;
  const username = leave?.employee_username || leave?.employeeUsername || leave?.username;
  if (name && username && name !== username) {
    return `${name} (${username})`;
  }
  if (name) return name;
  if (username) return username;
  const legacyId = leave?.employee_id || leave?.employeeId;
  if (legacyId && !isInternalEmployeeId(legacyId)) return legacyId;
  return UNKNOWN_EMPLOYEE;
};

export const formatLeaveSummary = (leave) =>
  `${formatEmployeeDisplay(leave)} - ${formatLeaveTypeLabel(leave?.leave_type || leave?.leaveType)} - ${formatLeaveStatus(leave?.status)}`;

export const formatLeaveActivityTitle = (leave) => {
  const status = formatLeaveStatus(leave?.status).toLowerCase();
  return `Leave ${status} for ${formatEmployeeDisplay(leave)}`;
};
