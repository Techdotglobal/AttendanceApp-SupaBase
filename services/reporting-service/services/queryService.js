/**
 * Query Service - Read-only database queries for report generation
 * All queries use Supabase Service Role Key for read-only access.
 * Every aggregate path must pass an explicit company_id (tenant scope).
 */
const { supabase } = require('../config/supabase');
const { getExtendedSchedule, setExtendedSchedule } = require('./scheduleConfig');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeCompanyId(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const id = String(raw).trim();
  return UUID_RE.test(id) ? id : null;
}

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
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
 * Fetch ALL active super admin email addresses for a tenant.
 * Returns an array (never a single string) so callers must handle zero, one, or many.
 * The REPORT_RECIPIENT_EMAIL / SUPER_ADMIN_EMAIL env-var overrides are intentionally
 * removed here — they caused every company's report to go to one hardcoded address.
 *
 * @param {string} companyId
 * @returns {Promise<string[]>} Validated email addresses
 */
async function getSuperAdminEmails(companyId) {
  const cid = normalizeCompanyId(companyId);
  if (!cid) {
    console.warn('[queryService] getSuperAdminEmails: valid company_id is required');
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('email, report_email, name')
      .eq('role', 'super_admin')
      .eq('is_active', true)
      .eq('company_id', cid);

    if (error) throw error;

    // Prefer report_email if set; fall back to login email; dedupe case-insensitively
    const seen = new Set();
    const emails = [];
    for (const r of data || []) {
      const raw = (r.report_email && r.report_email.trim()) || r.email;
      if (!isValidEmail(raw)) continue;
      const trimmed = raw.trim();
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      emails.push(trimmed);
    }

    if (emails.length === 0) {
      console.warn(`[queryService] getSuperAdminEmails: no valid super_admin emails found for company ${cid}`);
    }

    return emails;
  } catch (error) {
    console.error(`[queryService] getSuperAdminEmails error for company ${cid}:`, error);
    throw error;
  }
}

/**
 * Fetch company record (id + name) for a given UUID.
 * @param {string} companyId
 * @returns {Promise<{id: string, name: string}|null>}
 */
async function getCompany(companyId) {
  const cid = normalizeCompanyId(companyId);
  if (!cid) return null;

  try {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, logo_url')
      .eq('id', cid)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch (error) {
    console.error(`[queryService] getCompany error for ${cid}:`, error);
    throw error;
  }
}

/**
 * Fetch all active companies (id + name).
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function getAllCompanies() {
  try {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, report_schedule_day, report_auto_send')
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('[queryService] getAllCompanies error:', error);
    throw error;
  }
}

/**
 * Get a company's report schedule settings from company_settings.
 * Falls back to { day: 1, autoSend: true } if no row exists.
 * @param {string} companyId
 * @returns {Promise<{day: number, autoSend: boolean}>}
 */
async function getReportSchedule(companyId) {
  const cid = normalizeCompanyId(companyId);
  if (!cid) return { day: 1, autoSend: true };

  try {
    const { data, error } = await supabase
      .from('companies')
      .select('report_schedule_day, report_auto_send')
      .eq('id', cid)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { day: 1, autoSend: true };

    const day = data.report_schedule_day ?? 1;
    const extended = getExtendedSchedule(cid);
    return {
      day: Number.isFinite(day) && day >= 1 && day <= 28 ? day : 1,
      autoSend: data.report_auto_send ?? true,
      frequency: extended.frequency,
      lastExecution: extended.lastExecution,
      lastStatus: extended.lastStatus,
      nextExecution: extended.nextExecution,
    };
  } catch (err) {
    console.warn(`[queryService] getReportSchedule error for ${cid} (using defaults):`, err.message);
    return { day: 1, autoSend: true };
  }
}

/**
 * Persist report schedule settings for a company.
 * Updates the companies row directly (one row per company).
 * @param {string} companyId
 * @param {{ day?: number, autoSend?: boolean }} settings
 */
async function setReportSchedule(companyId, settings) {
  const cid = normalizeCompanyId(companyId);
  if (!cid) throw new Error('setReportSchedule: valid company_id required');

  const updates = {};

  if (settings.day !== undefined) {
    const day = parseInt(settings.day, 10);
    if (!Number.isFinite(day) || day < 1 || day > 28) {
      throw new Error('report_schedule_day must be between 1 and 28');
    }
    updates.report_schedule_day = day;
  }

  if (settings.autoSend !== undefined) {
    updates.report_auto_send = Boolean(settings.autoSend);
  }

  if (settings.frequency !== undefined) {
    setExtendedSchedule(cid, { frequency: settings.frequency });
  }

  if (Object.keys(updates).length === 0 && settings.frequency === undefined) return;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('companies')
      .update(updates)
      .eq('id', cid);

    if (error) throw error;
  }
}

/**
 * Write a report audit log entry to the database.
 * Fails silently so a logging error never blocks the delivery pipeline.
 * @param {Object} entry
 */
async function logReportAudit(entry) {
  try {
    const { error } = await supabase.from('report_audit_logs').insert({
      company_id: entry.companyId,
      company_name: entry.companyName || null,
      report_period: entry.reportPeriod || null,
      recipients: entry.recipients || [],
      status: entry.status || 'unknown',
      error_message: entry.errorMessage || null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.warn('[queryService] logReportAudit DB insert failed (non-fatal):', error.message);
    }
  } catch (err) {
    console.warn('[queryService] logReportAudit unexpected error (non-fatal):', err.message);
  }
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

module.exports = {
  normalizeCompanyId,
  isValidEmail,
  fetchCompanyUserUids,
  fetchCompanyUsernames,
  getAllEmployees,
  getEmployeesByDepartment,
  getAttendanceRecords,
  getLeaveRequests,
  getTickets,
  getSuperAdminEmails,
  getCompany,
  getAllCompanies,
  getReportSchedule,
  setReportSchedule,
  logReportAudit,
};
