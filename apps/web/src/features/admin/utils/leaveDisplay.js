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

export const formatEmployeeDisplay = (leave) => {
  const name = leave?.employee_name || leave?.employeeName;
  const username = leave?.employee_username || leave?.username;
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
