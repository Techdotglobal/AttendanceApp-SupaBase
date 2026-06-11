const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMP_PREFIX_RE = /^emp_/i;

const normalizeKey = (value) => {
  if (value == null) return null;
  const str = String(value).trim();
  return str ? str.toLowerCase() : null;
};

const extractUidFromEmployeeId = (employeeId) => {
  if (!employeeId) return null;
  const str = String(employeeId).trim();
  if (EMP_PREFIX_RE.test(str)) return normalizeKey(str.replace(EMP_PREFIX_RE, ''));
  if (UUID_RE.test(str)) return normalizeKey(str);
  return null;
};

/**
 * Build lookup maps for all users in a company (avoids UUID/text .in() mismatches).
 * @param {Array} users
 * @returns {{ byUid: Map<string, object>, byUsername: Map<string, object> }}
 */
const buildEmployeeLookupMaps = (users = []) => {
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
  return { byUid, byUsername };
};

/**
 * Resolve a user row for a leave request using uid, emp_ id, or username.
 * @param {object} row
 * @param {{ byUid: Map<string, object>, byUsername: Map<string, object> }} maps
 * @returns {object|null}
 */
const resolveEmployeeForLeaveRow = (row, maps) => {
  const { byUid, byUsername } = maps;

  const uidCandidates = [
    normalizeKey(row.employee_uid),
    extractUidFromEmployeeId(row.employee_id),
  ].filter(Boolean);

  for (const key of uidCandidates) {
    const hit = byUid.get(key);
    if (hit) return hit;
  }

  const usernameFromId = row.employee_id && !EMP_PREFIX_RE.test(String(row.employee_id))
    ? normalizeKey(row.employee_id)
    : null;
  if (usernameFromId && byUsername.has(usernameFromId)) {
    return byUsername.get(usernameFromId);
  }

  const storedUsername = normalizeKey(row.employee_username);
  if (storedUsername && byUsername.has(storedUsername)) {
    return byUsername.get(storedUsername);
  }

  return null;
};

/**
 * Attach employee_name, employee_username, employee_department to leave rows.
 * @param {*} supabase
 * @param {string} companyId
 * @param {Array} requests
 * @returns {Promise<Array>}
 */
const enrichLeaveRequestsWithEmployees = async (supabase, companyId, requests) => {
  if (!requests?.length) return [];

  const { data: companyUsers, error: usersError } = await supabase
    .from('users')
    .select('id, uid, username, name, department')
    .eq('company_id', companyId);

  if (usersError) {
    console.warn('[leaves] enrichLeaveRequestsWithEmployees users query failed:', usersError.message);
  }

  const maps = buildEmployeeLookupMaps(companyUsers || []);

  return requests.map((row) => {
    const employee = resolveEmployeeForLeaveRow(row, maps);
    return {
      ...row,
      employee_name: employee?.name || row.employee_name || null,
      employee_username: employee?.username || row.employee_username || null,
      employee_department: employee?.department || row.employee_department || null,
    };
  });
};

module.exports = {
  normalizeKey,
  extractUidFromEmployeeId,
  buildEmployeeLookupMaps,
  resolveEmployeeForLeaveRow,
  enrichLeaveRequestsWithEmployees,
};
