/**
 * Query Service - Read-only database queries for report generation
 * All queries use Supabase Service Role Key for read-only access.
 * Every aggregate path must pass an explicit company_id (tenant scope).
 */
const { supabase } = require('../config/supabase');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeCompanyId(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const id = String(raw).trim();
  return UUID_RE.test(id) ? id : null;
}

async function fetchCompanyUserUids(companyId) {
  const cid = normalizeCompanyId(companyId);
  if (!cid) return [];
  const { data, error } = await supabase.from('users').select('uid').eq('company_id', cid);
  if (error) {
    console.error('[queryService] fetchCompanyUserUids:', error.message);
    return [];
  }
  return (data || []).map((r) => r.uid).filter(Boolean);
}

async function fetchCompanyUsernames(companyId) {
  const cid = normalizeCompanyId(companyId);
  if (!cid) return [];
  const { data, error } = await supabase.from('users').select('username').eq('company_id', cid);
  if (error) {
    console.error('[queryService] fetchCompanyUsernames:', error.message);
    return [];
  }
  return (data || []).map((r) => r.username).filter((u) => u != null && String(u).trim() !== '');
}

/**
 * @param {string} companyId
 * @returns {Promise<Array>}
 */
async function getAllEmployees(companyId) {
  const cid = normalizeCompanyId(companyId);
  if (!cid) throw new Error('company_id is required for getAllEmployees');
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, uid, username, name, email, role, department, position, work_mode, is_active, company_id')
      .eq('is_active', true)
      .eq('company_id', cid)
      .order('department', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching employees:', error);
    throw error;
  }
}

/**
 * @param {string} department
 * @param {string} companyId
 */
async function getEmployeesByDepartment(department, companyId) {
  const cid = normalizeCompanyId(companyId);
  if (!cid) throw new Error('company_id is required for getEmployeesByDepartment');
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, uid, username, name, email, role, department, position, work_mode, is_active, company_id')
      .eq('is_active', true)
      .eq('department', department)
      .eq('company_id', cid)
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching employees by department:', error);
    throw error;
  }
}

const EMPTY_UID = '00000000-0000-0000-0000-000000000000';

/**
 * @param {Date} from
 * @param {Date} to
 * @param {string} companyId
 */
async function getAttendanceRecords(from, to, companyId) {
  const cid = normalizeCompanyId(companyId);
  if (!cid) throw new Error('company_id is required for getAttendanceRecords');
  try {
    const uids = await fetchCompanyUserUids(cid);
    const uidList = uids.length > 0 ? uids : [EMPTY_UID];
    const { data, error } = await supabase
      .from('attendance_records')
      .select('*')
      .in('user_uid', uidList)
      .gte('timestamp', from.toISOString())
      .lte('timestamp', to.toISOString())
      .order('timestamp', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching attendance records:', error);
    throw error;
  }
}

/**
 * @param {Date} from
 * @param {Date} to
 * @param {string} companyId
 */
async function getLeaveRequests(from, to, companyId) {
  const cid = normalizeCompanyId(companyId);
  if (!cid) throw new Error('company_id is required for getLeaveRequests');
  try {
    const uids = await fetchCompanyUserUids(cid);
    const uidList = uids.length > 0 ? uids : [EMPTY_UID];
    const { data, error } = await supabase
      .from('leave_requests')
      .select('*')
      .in('employee_uid', uidList)
      .gte('start_date', formatDate(from))
      .lte('end_date', formatDate(to))
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching leave requests:', error);
    throw error;
  }
}

/**
 * @param {Date} from
 * @param {Date} to
 * @param {string} companyId
 */
async function getTickets(from, to, companyId) {
  const cid = normalizeCompanyId(companyId);
  if (!cid) throw new Error('company_id is required for getTickets');
  try {
    const [uids, usernames] = await Promise.all([fetchCompanyUserUids(cid), fetchCompanyUsernames(cid)]);
    const uidSet = new Set(uids);
    const nameSet = new Set(usernames);

    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).filter((t) => {
      if (t.created_by_uid && uidSet.has(t.created_by_uid)) return true;
      if (t.created_by && nameSet.has(t.created_by)) return true;
      if (t.assigned_to && nameSet.has(t.assigned_to)) return true;
      return false;
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    throw error;
  }
}

/**
 * Super admin email for a tenant (for scheduled / per-tenant reports).
 * @param {string} companyId
 */
async function getSuperAdminEmail(companyId) {
  const envEmail = process.env.REPORT_RECIPIENT_EMAIL || process.env.SUPER_ADMIN_EMAIL;
  if (envEmail) {
    console.log('Using email from environment variable:', envEmail);
    return envEmail;
  }

  const cid = normalizeCompanyId(companyId);
  if (!cid) {
    console.warn('[queryService] getSuperAdminEmail: company_id required when REPORT_RECIPIENT_EMAIL is unset');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('email')
      .eq('role', 'super_admin')
      .eq('is_active', true)
      .eq('company_id', cid)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.email || null;
  } catch (error) {
    console.error('Error fetching super admin email:', error);
    throw error;
  }
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

module.exports = {
  normalizeCompanyId,
  fetchCompanyUserUids,
  fetchCompanyUsernames,
  getAllEmployees,
  getEmployeesByDepartment,
  getAttendanceRecords,
  getLeaveRequests,
  getTickets,
  getSuperAdminEmail,
};
