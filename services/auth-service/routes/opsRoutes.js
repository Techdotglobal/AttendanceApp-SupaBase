/**
 * Tickets, Calendar, Notifications, Settings — tenant-scoped admin APIs
 */
const express = require('express');
const { supabase } = require('../config/supabase');
const { getTenantCompanyId } = require('../lib/tenantScope');
const { hasAnyPermission, hasPermission, requirePermission, writeAuthorizationAudit } = require('../lib/permissions');
const { insertNotification, notifyUsernames } = require('../lib/notificationHelper');

const router = express.Router();

const ROLES = { SUPER_ADMIN: 'super_admin', MANAGER: 'manager', EMPLOYEE: 'employee' };
const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const EVENT_TYPES = ['meeting', 'reminder', 'holiday', 'other'];
const VISIBILITY = ['all', 'none', 'selected'];

const DEFAULT_APP_SETTINGS = {
  company: { timezone: 'UTC' },
  attendance: { autoCheckoutEnabled: true, graceMinutes: 15, requireGps: true, rulesV1Enabled: false },
  leave: {},
  tickets: { defaultPriority: 'medium', notifyOnAssign: true },
  calendar: { defaultVisibility: 'all' },
  notifications: { emailEnabled: true, pushEnabled: true, inAppEnabled: true },
  reports: { retentionDays: 90 },
  geofencing: { defaultRadiusMeters: 100 },
  security: { sessionTimeoutMinutes: 480, requireStrongPasswords: true },
  theme: { accent: 'indigo', density: 'comfortable' },
};

const { resolveRequester } = require('../lib/resolveRequester');

async function withTenantContext(req, res) {
  const requester = await resolveRequester(req);
  if (!requester?.uid) {
    res.status(401).json({ success: false, error: 'Authentication required. Sign in again.' });
    return null;
  }
  // Re-load the authoritative row by the VERIFIED uid.
  const { data: user } = await supabase
    .from('users')
    .select('uid, username, email, role, department, department_id, company_id, name')
    .eq('uid', requester.uid)
    .eq('is_active', true)
    .maybeSingle();
  if (!user?.company_id) {
    res.status(403).json({ success: false, error: 'Tenant scope required' });
    return null;
  }
  return { requester: user, companyId: user.company_id };
}

async function requirePerm(requester, key, res) {
  return requirePermission(supabase, requester, key, res);
}

async function requireAnyPerm(requester, keys, res) {
  const ok = await hasAnyPermission(supabase, requester, keys);
  if (!ok) {
    res.status(403).json({ success: false, error: 'Insufficient permissions' });
    return false;
  }
  return true;
}

async function canAccessTicket(requester, companyId, ticket, permissionKey) {
  if (requester.role === ROLES.SUPER_ADMIN) return true;
  if (ticket.created_by_uid === requester.uid || ticket.assigned_to === requester.username) return true;
  const { data: creator } = await supabase
    .from('users')
    .select('uid, department, department_id')
    .eq('uid', ticket.created_by_uid)
    .eq('company_id', companyId)
    .maybeSingle();
  return Boolean(creator && await hasPermission(supabase, { ...requester, company_id: companyId }, permissionKey, {
    companyId, targetUid: creator.uid, userUid: creator.uid, departmentId: creator.department_id, department: creator.department,
  }));
}

function applyNotificationScope(query, requester, companyId) {
  const uid = String(requester.uid || '');
  const username = String(requester.username || '').replace(/"/g, '');
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid);
  const recipientParts = [];
  if (isUuid) recipientParts.push(`recipient_uid.eq.${uid}`);
  if (username) recipientParts.push(`recipient_username.eq."${username}"`);
  if (!recipientParts.length) recipientParts.push(`recipient_uid.eq.${uid}`);
  query = query.or(recipientParts.join(','));
  if (companyId) {
    query = query.or(`company_id.eq.${companyId},company_id.is.null`);
  }
  return query;
}

function mergeSettings(raw) {
  const base = JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS));
  if (!raw || typeof raw !== 'object') return base;
  for (const section of Object.keys(base)) {
    if (raw[section] && typeof raw[section] === 'object') {
      base[section] = { ...base[section], ...raw[section] };
    }
  }
  return base;
}

// ── Tickets ───────────────────────────────────────────────────────────────────

router.get('/tickets', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const isEmployee = requester.role === ROLES.EMPLOYEE;
  const hasTicketGrant = await hasAnyPermission(supabase, requester, ['view_tickets', 'manage_tickets', 'assign_tickets', 'close_tickets']);
  if (!isEmployee && !hasTicketGrant && !(await requireAnyPerm(requester, ['view_tickets', 'manage_tickets', 'assign_tickets', 'close_tickets'], res))) return;
  try {
    let query = supabase
      .from('tickets')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (isEmployee && !hasTicketGrant) {
      query = query.eq('created_by_uid', requester.uid);
    }
    const { data, error } = await query;
    if (error) throw error;
    let rows = data || [];
    if (requester.role === ROLES.MANAGER && !hasTicketGrant) {
      const { data: depts } = await supabase
        .from('departments')
        .select('id, name')
        .eq('company_id', companyId)
        .eq('name', requester.department);
      const deptIds = new Set((depts || []).map((d) => String(d.id)));
      rows = rows.filter(
        (t) =>
          deptIds.has(String(t.category)) ||
          t.created_by === requester.username ||
          t.assigned_to === requester.username
      );
    }
    if (hasTicketGrant && requester.role !== ROLES.SUPER_ADMIN) {
      const creatorUids = [...new Set(rows.map((ticket) => ticket.created_by_uid).filter(Boolean))];
      const { data: creators } = creatorUids.length
        ? await supabase.from('users').select('uid, department, department_id').eq('company_id', companyId).in('uid', creatorUids)
        : { data: [] };
      const creatorMap = new Map((creators || []).map((user) => [user.uid, user]));
      const visible = [];
      for (const ticket of rows) {
        if (ticket.created_by_uid === requester.uid || ticket.assigned_to === requester.username) {
          visible.push(ticket);
          continue;
        }
        const creator = creatorMap.get(ticket.created_by_uid);
        if (creator && await hasPermission(supabase, { ...requester, company_id: companyId }, 'view_tickets', {
          companyId, targetUid: creator.uid, userUid: creator.uid, departmentId: creator.department_id, department: creator.department,
        })) visible.push(ticket);
      }
      rows = visible;
    }
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/tickets', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (requester.role !== ROLES.EMPLOYEE && !(await requirePerm(requester, 'manage_tickets', res))) return;
  const { category, priority, subject, description } = req.body;
  if (!subject?.trim() || !description?.trim()) {
    return res.status(400).json({ success: false, error: 'Subject and description are required' });
  }
  if (!TICKET_PRIORITIES.includes(priority)) {
    return res.status(400).json({ success: false, error: 'Invalid priority' });
  }
  try {
    const { data, error } = await supabase
      .from('tickets')
      .insert({
        company_id: companyId,
        created_by_uid: requester.uid,
        created_by: requester.username,
        category: String(category || ''),
        priority,
        subject: subject.trim(),
        description: description.trim(),
        status: 'open',
      })
      .select()
      .single();
    if (error) throw error;

    const { data: managers } = await supabase
      .from('users')
      .select('username')
      .eq('company_id', companyId)
      .in('role', ['manager', 'super_admin'])
      .eq('is_active', true);
    await notifyUsernames(supabase, companyId, (managers || []).map((m) => m.username), {
      title: 'New support ticket',
      body: `${requester.username} created: ${subject.trim()}`,
      type: 'ticket_created',
      data: { ticketId: data.id },
    });

    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/tickets/:id/assign', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requirePerm(requester, 'assign_tickets', res))) return;
  const { assigned_to } = req.body;
  if (!assigned_to?.trim()) {
    return res.status(400).json({ success: false, error: 'assigned_to is required' });
  }
  try {
    const { data: assignee } = await supabase
      .from('users')
      .select('uid, username')
      .eq('company_id', companyId)
      .eq('username', assigned_to.trim())
      .eq('is_active', true)
      .maybeSingle();
    if (!assignee) return res.status(400).json({ success: false, error: 'Assignee not found' });

    const { data: ticket } = await supabase.from('tickets').select('*').eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    if (!(await canAccessTicket(requester, companyId, ticket, 'assign_tickets'))) return res.status(403).json({ success: false, error: 'Ticket is outside your permission scope' });

    const { data, error } = await supabase
      .from('tickets')
      .update({
        assigned_to: assignee.username,
        status: 'in_progress',
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Ticket not found' });

    await insertNotification(supabase, {
      companyId,
      recipientUid: assignee.uid,
      recipientUsername: assignee.username,
      title: 'Ticket assigned to you',
      body: `You were assigned: ${data.subject}`,
      type: 'ticket_assigned',
      data: { ticketId: data.id },
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/tickets/:id/close', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requirePerm(requester, 'close_tickets', res))) return;
  try {
    const { data: existing } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ success: false, error: 'Ticket not found' });
    if (!(await canAccessTicket(requester, companyId, existing, 'close_tickets'))) return res.status(403).json({ success: false, error: 'Ticket is outside your permission scope' });

    const { data, error } = await supabase
      .from('tickets')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw error;

    if (existing.created_by && existing.created_by !== requester.username) {
      await notifyUsernames(supabase, companyId, [existing.created_by], {
        title: 'Ticket closed',
        body: `Your ticket "${existing.subject}" was closed.`,
        type: 'ticket_closed',
        data: { ticketId: data.id },
      });
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/tickets/:id/reopen', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requirePerm(requester, 'close_tickets', res))) return;
  try {
    const { data: existing } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ success: false, error: 'Ticket not found' });
    if (!(await canAccessTicket(requester, companyId, existing, 'close_tickets'))) return res.status(403).json({ success: false, error: 'Ticket is outside your permission scope' });

    const nextStatus = existing.assigned_to ? 'in_progress' : 'open';
    const { data, error } = await supabase
      .from('tickets')
      .update({
        status: nextStatus,
        closed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Calendar ──────────────────────────────────────────────────────────────────

router.get('/calendar-events', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const isEmployee = requester.role === ROLES.EMPLOYEE;
  if (!isEmployee && !(await requireAnyPerm(requester, ['create_events', 'edit_events', 'delete_events'], res))) return;
  try {
    const { data, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('company_id', companyId)
      .order('date', { ascending: true });
    if (error) throw error;
    const events = isEmployee
      ? (data || []).filter((event) => {
          const visibility = String(event.visibility || 'all').toLowerCase();
          if (visibility === 'none') return event.created_by_uid === requester.uid;
          if (visibility === 'selected') {
            const selected = Array.isArray(event.visible_to) ? event.visible_to : [];
            return event.created_by_uid === requester.uid || selected.includes(requester.uid) || selected.includes(requester.username);
          }
          return true;
        })
      : (data || []);
    res.json({ success: true, data: events });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/calendar-events', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requirePerm(requester, 'create_events', res))) return;
  const { title, description, date, time, type, color, visibility, visible_to } = req.body;
  if (!title?.trim() || !date) {
    return res.status(400).json({ success: false, error: 'Title and date are required' });
  }
  if (type && !EVENT_TYPES.includes(type)) {
    return res.status(400).json({ success: false, error: 'Invalid event type' });
  }
  if (visibility && !VISIBILITY.includes(visibility)) {
    return res.status(400).json({ success: false, error: 'Invalid visibility' });
  }
  try {
    const { data, error } = await supabase
      .from('calendar_events')
      .insert({
        company_id: companyId,
        title: title.trim(),
        description: description || null,
        date,
        time: time || null,
        type: type || 'other',
        color: color || '#3b82f6',
        visibility: visibility || 'all',
        visible_to: visible_to || [],
        assigned_to: visible_to || [],
        created_by: requester.username,
        created_by_uid: requester.uid,
      })
      .select()
      .single();
    if (error) throw error;

    if (visibility === 'selected' && Array.isArray(visible_to) && visible_to.length) {
      await notifyUsernames(supabase, companyId, visible_to.filter((u) => u !== requester.username), {
        title: 'New calendar event',
        body: `${requester.username} invited you to "${title.trim()}" on ${date}`,
        type: 'calendar_event',
        data: { eventId: data.id },
      });
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/calendar-events/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requirePerm(requester, 'edit_events', res))) return;
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  delete updates.id;
  delete updates.company_id;
  if (updates.title !== undefined && !String(updates.title).trim()) {
    return res.status(400).json({ success: false, error: 'Title cannot be empty' });
  }
  try {
    const { data, error } = await supabase
      .from('calendar_events')
      .update(updates)
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/calendar-events/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requirePerm(requester, 'delete_events', res))) return;
  try {
    const { error } = await supabase
      .from('calendar_events')
      .delete()
      .eq('id', req.params.id)
      .eq('company_id', companyId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Notifications ─────────────────────────────────────────────────────────────

router.get('/notifications/unread-count', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const { count, error } = await applyNotificationScope(
      supabase.from('notifications').select('id', { count: 'exact', head: true }),
      requester,
      companyId,
    ).eq('read', false);
    if (error) throw error;
    res.json({ success: true, count: count || 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/notifications', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const readFilter = req.query.read;
  const typeFilter = req.query.type;
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  try {
    let query = applyNotificationScope(
      supabase.from('notifications').select('*', { count: 'exact' }),
      requester,
      companyId,
    )
      .order('created_at', { ascending: false })
      .range(from, to);
    if (readFilter === 'true') query = query.eq('read', true);
    if (readFilter === 'false') query = query.eq('read', false);
    if (typeFilter) query = query.eq('type', typeFilter);
    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [], page, limit, total: count || 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/notifications/:id/read', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('recipient_uid', requester.uid)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/notifications/mark-all-read', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const { error } = await applyNotificationScope(
      supabase.from('notifications').update({ read: true, read_at: new Date().toISOString() }),
      requester,
      companyId,
    ).eq('read', false);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/notifications/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  try {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', req.params.id)
      .eq('recipient_uid', requester.uid);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────

router.get('/settings', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requirePerm(requester, 'access_system_settings', res))) return;
  try {
    const [{ data: company }, { data: leaveSettings }, { data: absencePolicy }] = await Promise.all([
      supabase.from('companies').select('id, name, logo_url, app_settings').eq('id', companyId).single(),
      supabase.from('leave_settings').select('*').eq('company_id', companyId).maybeSingle(),
      supabase.from('attendance_absence_policies').select('*').eq('company_id', companyId).maybeSingle(),
    ]);
    const appSettings = mergeSettings(company?.app_settings);
    if (leaveSettings) {
      appSettings.leave = {
        defaultAnnual: leaveSettings.default_annual_leaves,
        defaultSick: leaveSettings.default_sick_leaves,
        defaultCasual: leaveSettings.default_casual_leaves,
        yearStart: leaveSettings.leave_year_start,
        yearEnd: leaveSettings.leave_year_end,
      };
    }
    appSettings.leave = {
      ...(appSettings.leave || {}),
      absenceDeductionsV1Enabled: company?.app_settings?.leave?.absenceDeductionsV1Enabled === true,
      absencePolicy: absencePolicy || null,
      absenceAction: absencePolicy?.action || 'NONE',
      absenceLeaveType: absencePolicy?.leave_type || 'annual',
      absenceDeductionDays: absencePolicy?.deduction_days ?? 1,
      absenceInsufficientBalancePolicy: absencePolicy?.insufficient_balance_policy || 'CAP_AT_ZERO_UNPAID',
      absenceEffectiveFrom: absencePolicy?.effective_from || '',
    };
    appSettings.company = {
      ...appSettings.company,
      name: company?.name,
      logoUrl: company?.logo_url,
    };
    res.json({ success: true, data: appSettings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/settings', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requirePerm(requester, 'access_system_settings', res))) return;
  const { section, values, reset } = req.body;
  if (!section) return res.status(400).json({ success: false, error: 'section is required' });
  const absenceTouched = section === 'leave' && (reset || Object.keys(values || {}).some((key) => [
    'absenceDeductionsV1Enabled', 'absenceEnabled', 'absenceAction', 'absenceLeaveType',
    'absenceDeductionDays', 'absenceInsufficientBalancePolicy', 'absenceEffectiveFrom',
  ].includes(key)));
  if (absenceTouched && requester.role !== ROLES.SUPER_ADMIN) {
    return res.status(403).json({ success: false, error: 'Only super admins can configure automatic absence handling' });
  }
  if (section === 'attendance' && (values?.rulesV1Enabled !== undefined || reset)
      && !(await requirePerm(requester, 'manage_attendance_rules', res))) return;
  try {
    let previousAbsencePolicy = null;
    if (section === 'leave') {
      const leaveValues = values || DEFAULT_APP_SETTINGS.leave || {};
      const row = {
        company_id: companyId,
        default_annual_leaves: Number(leaveValues.defaultAnnual) || 20,
        default_sick_leaves: Number(leaveValues.defaultSick) || 10,
        default_casual_leaves: Number(leaveValues.defaultCasual) || 5,
        leave_year_start: leaveValues.yearStart || '01-01',
        leave_year_end: leaveValues.yearEnd || '12-31',
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('leave_settings').upsert(row, { onConflict: 'company_id' });
      if (error) throw error;
      if (absenceTouched) {
        const { data: existingPolicy } = await supabase
          .from('attendance_absence_policies').select('*').eq('company_id', companyId).maybeSingle();
        previousAbsencePolicy = existingPolicy || null;
        const action = reset ? 'NONE' : String(values.absenceAction || values.absencePolicy?.action || existingPolicy?.action || 'NONE').toUpperCase();
        const leaveType = reset ? null : (values.absenceLeaveType || values.absencePolicy?.leave_type || existingPolicy?.leave_type || null);
        const deductionDays = reset ? 1 : Number(values.absenceDeductionDays ?? values.absencePolicy?.deduction_days ?? existingPolicy?.deduction_days ?? 1);
        const insufficient = reset ? 'CAP_AT_ZERO_UNPAID' : String(values.absenceInsufficientBalancePolicy || values.absencePolicy?.insufficient_balance_policy || existingPolicy?.insufficient_balance_policy || 'CAP_AT_ZERO_UNPAID').toUpperCase();
        const policy = {
          company_id: companyId,
          enabled: reset ? false : values.absenceDeductionsV1Enabled === true,
          action,
          leave_type: leaveType,
          deduction_days: Number.isFinite(deductionDays) ? deductionDays : 1,
          insufficient_balance_policy: insufficient,
          effective_from: reset ? null : (values.absenceEffectiveFrom || values.absencePolicy?.effective_from || existingPolicy?.effective_from || null),
          updated_by_uid: requester.uid,
          updated_at: new Date().toISOString(),
        };
        const { data: savedPolicy, error: policyError } = await supabase
          .from('attendance_absence_policies')
          .upsert(policy, { onConflict: 'company_id' })
          .select('*').single();
        if (policyError) throw policyError;
        const { data: companySettings } = await supabase.from('companies').select('app_settings').eq('id', companyId).single();
        const appSettings = mergeSettings(companySettings?.app_settings);
        appSettings.leave = {
          ...(appSettings.leave || {}),
          absenceDeductionsV1Enabled: policy.enabled,
        };
        const { error: companySettingsError } = await supabase.from('companies').update({ app_settings: appSettings, updated_at: new Date().toISOString() }).eq('id', companyId);
        if (companySettingsError) throw companySettingsError;
        await writeAuthorizationAudit(supabase, {
          companyId,
          actorUid: requester.uid,
          action: 'attendance_absence_policy_changed',
          beforeState: previousAbsencePolicy || {},
          afterState: savedPolicy,
        });
      }
    } else if (section === 'company' && values) {
      const updates = { updated_at: new Date().toISOString() };
      if (values.name) updates.name = String(values.name).trim();
      if (values.logoUrl !== undefined) updates.logo_url = values.logoUrl;
      const { error } = await supabase.from('companies').update(updates).eq('id', companyId);
      if (error) throw error;
    } else {
      const { data: company } = await supabase
        .from('companies')
        .select('app_settings')
        .eq('id', companyId)
        .single();
      const current = mergeSettings(company?.app_settings);
      const previousRulesEnabled = current.attendance?.rulesV1Enabled === true;
      if (reset) {
        current[section] = DEFAULT_APP_SETTINGS[section] || {};
      } else if (values) {
        current[section] = { ...(current[section] || {}), ...values };
      }
      const { error } = await supabase
        .from('companies')
        .update({ app_settings: current, updated_at: new Date().toISOString() })
        .eq('id', companyId);
      if (error) throw error;
      if (section === 'attendance' && previousRulesEnabled !== (current.attendance?.rulesV1Enabled === true)) {
        await writeAuthorizationAudit(supabase, {
          companyId,
          actorUid: requester.uid,
          action: 'attendance_rules_feature_changed',
          beforeState: { rulesV1Enabled: previousRulesEnabled },
          afterState: { rulesV1Enabled: current.attendance?.rulesV1Enabled === true },
        });
      }
    }

    const [{ data: company }, { data: leaveSettings }, { data: absencePolicy }] = await Promise.all([
      supabase.from('companies').select('id, name, logo_url, app_settings').eq('id', companyId).single(),
      supabase.from('leave_settings').select('*').eq('company_id', companyId).maybeSingle(),
      supabase.from('attendance_absence_policies').select('*').eq('company_id', companyId).maybeSingle(),
    ]);
    const appSettings = mergeSettings(company?.app_settings);
    if (leaveSettings) {
      appSettings.leave = {
        defaultAnnual: leaveSettings.default_annual_leaves,
        defaultSick: leaveSettings.default_sick_leaves,
        defaultCasual: leaveSettings.default_casual_leaves,
        yearStart: leaveSettings.leave_year_start,
        yearEnd: leaveSettings.leave_year_end,
      };
    }
    appSettings.leave = {
      ...(appSettings.leave || {}),
      absenceDeductionsV1Enabled: company?.app_settings?.leave?.absenceDeductionsV1Enabled === true,
      absencePolicy: absencePolicy || null,
      absenceAction: absencePolicy?.action || 'NONE',
      absenceLeaveType: absencePolicy?.leave_type || 'annual',
      absenceDeductionDays: absencePolicy?.deduction_days ?? 1,
      absenceInsufficientBalancePolicy: absencePolicy?.insufficient_balance_policy || 'CAP_AT_ZERO_UNPAID',
      absenceEffectiveFrom: absencePolicy?.effective_from || '',
    };
    appSettings.company = { ...appSettings.company, name: company?.name, logoUrl: company?.logo_url };

    res.json({ success: true, message: reset ? 'Settings reset' : 'Settings saved', data: appSettings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
