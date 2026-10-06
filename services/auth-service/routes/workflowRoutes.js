/**
 * Approval workflows, work-mode requests, employee site assignments
 */
const express = require('express');
const { supabase } = require('../config/supabase');
const { requirePermission, hasPermission, hasAnyPermission, writeAuthorizationAudit } = require('../lib/permissions');
const { normalizeDepartmentName, toLookupKey } = require('../lib/orgNormalize');
const {
  ALL_MANAGER_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  APPROVER_ROLES,
} = require('../../../shared/permissions/catalog.cjs');

/** Resolve a department UUID from an id or a (possibly display) name in a company. */
async function resolveDepartmentId({ department_id, department }, companyId) {
  if (department_id) {
    const { data } = await supabase
      .from('departments')
      .select('id')
      .eq('id', String(department_id))
      .eq('company_id', companyId)
      .maybeSingle();
    return data?.id ? String(data.id) : null;
  }
  const raw = String(department || '').trim();
  if (!raw || !companyId) return null;
  const key = toLookupKey(normalizeDepartmentName(raw) || raw);
  const { data } = await supabase
    .from('departments')
    .select('id, name, normalized_name')
    .eq('company_id', companyId);
  const row = (data || []).find(
    (d) =>
      toLookupKey(d.normalized_name) === key ||
      toLookupKey(normalizeDepartmentName(d.name) || d.name) === key
  );
  return row?.id ? String(row.id) : null;
}
const {
  ensureDefaultWorkflows,
  getWorkflowForRequestType,
  initializeApprovalSteps,
  getApprovalProgress,
  processApprovalStep,
  resolveApproversForStep,
  canUserActOnStep,
  REQUEST_TYPES,
  mapLeaveTypeToRequestType,
} = require('../lib/approvalEngine');

const router = express.Router();

const ROLES = { SUPER_ADMIN: 'super_admin', MANAGER: 'manager', EMPLOYEE: 'employee' };
const AUTHORITY_TYPES = new Set(['LEGACY_ROLE', 'PERMISSION', 'ORGANIZATION_ROLE']);
const APPROVAL_SCOPES = new Set(['DEPARTMENT', 'ASSIGNED_DEPARTMENTS', 'COMPANY']);

function normalizeWorkflowStep(step, index) {
  const authorityType = String(step.authority_type || (step.required_permission_key ? 'PERMISSION' : 'LEGACY_ROLE')).toUpperCase();
  const permissionKey = step.required_permission_key ? String(step.required_permission_key).trim() : null;
  const scopeType = step.required_scope_type ? String(step.required_scope_type).trim().toUpperCase() : null;
  const approverRole = step.approver_role ? String(step.approver_role).trim() : null;
  const organizationRoleId = step.organization_role_id ? String(step.organization_role_id) : null;
  if (!AUTHORITY_TYPES.has(authorityType)) throw new Error(`Invalid authority_type on step ${index + 1}`);
  if (!step.step_label || !String(step.step_label).trim()) throw new Error(`Each step needs a label (step ${index + 1})`);
  if (authorityType === 'LEGACY_ROLE') {
    if (!Object.values(APPROVER_ROLES).includes(approverRole)) throw new Error(`Invalid legacy approver_role on step ${index + 1}`);
  } else {
    if (!permissionKey || !ALL_MANAGER_PERMISSIONS.includes(permissionKey)) throw new Error(`A valid permission is required on step ${index + 1}`);
    if (!scopeType || !APPROVAL_SCOPES.has(scopeType)) throw new Error(`A DEPARTMENT, ASSIGNED_DEPARTMENTS, or COMPANY scope is required on step ${index + 1}`);
    const definition = PERMISSION_DEFINITIONS[permissionKey];
    if (definition?.scopes && !definition.scopes.includes(scopeType)) throw new Error(`Permission ${permissionKey} does not support ${scopeType} scope`);
    if (authorityType === 'ORGANIZATION_ROLE' && !organizationRoleId) throw new Error(`An organization role is required on step ${index + 1}`);
  }
  if (scopeType === 'DEPARTMENT' && !step.department_id && !step.approval_department_id) {
    throw new Error(`Department scope requires a department on step ${index + 1}`);
  }
  return {
    step_order: index + 1,
    step_label: String(step.step_label).trim(),
    authority_type: authorityType,
    approver_role: authorityType === 'LEGACY_ROLE' ? approverRole : null,
    organization_role_id: authorityType === 'ORGANIZATION_ROLE' ? organizationRoleId : null,
    required_permission_key: authorityType === 'LEGACY_ROLE' ? null : permissionKey,
    required_scope_type: authorityType === 'LEGACY_ROLE' ? null : scopeType,
    department_id: step.department_id ? String(step.department_id) : null,
    approval_department_id: step.approval_department_id ? String(step.approval_department_id) : null,
  };
}

// Identity resolved via lib/resolveRequester inside withTenantContext.

async function withTenantContext(req, res) {
  const { resolveRequester } = require('../lib/resolveRequester');
  const requesterIdentity = await resolveRequester(req);
  if (!requesterIdentity?.uid) {
    res.status(401).json({ success: false, error: 'Authentication expired. Please sign in again.' });
    return null;
  }
  const { data: user } = await supabase
    .from('users')
    .select('uid, username, email, role, department, department_id, organization_role_id, company_id, name')
    .eq('uid', requesterIdentity.uid)
    .eq('is_active', true)
    .maybeSingle();
  if (!user?.company_id) {
    res.status(403).json({ success: false, error: 'Tenant scope required' });
    return null;
  }
  return { requester: user, companyId: user.company_id };
}

async function requireAdminPermission(requester, key, res) {
  return requirePermission(supabase, requester, key, res);
}

async function canViewOrApproveWorkflowRequest(requester, row, requestType, companyId) {
  const { data: employee } = await supabase
    .from('users')
    .select('uid, department, department_id')
    .eq('uid', row.employee_uid)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!employee) return false;
  const target = {
    companyId,
    targetUid: employee.uid,
    employeeUid: employee.uid,
    userUid: employee.uid,
    departmentId: employee.department_id,
    department: employee.department,
  };
  if (requester.role === ROLES.SUPER_ADMIN || await hasPermission(supabase, requester, 'view_work_mode_requests', target)) return true;
  const progress = await getApprovalProgress(supabase, requestType, row.id);
  const pending = progress.find((step) => step.action === 'pending');
  if (!pending) return false;
  return canUserActOnStep(supabase, requester, {
    ...pending,
    authority_type: pending.authority_type || (pending.required_permission_key ? 'PERMISSION' : 'LEGACY_ROLE'),
  }, employee.uid, companyId, requestType);
}

async function addWorkflowEligibility(companyId, workflow, steps) {
  const workflowDepartmentId = workflow.department_id || null;
  let subjectQuery = supabase
    .from('users')
    .select('uid, department, department_id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq('role', 'employee');
  if (workflowDepartmentId) subjectQuery = subjectQuery.eq('department_id', workflowDepartmentId);
  const { data: subject } = await subjectQuery.limit(1).maybeSingle();
  if (!subject) {
    return (steps || []).map((step) => ({ ...step, eligible_approver_count: 0, eligibility_warning: 'No active employee exists for this workflow department.' }));
  }
  return Promise.all((steps || []).map(async (step) => {
    const approvers = await resolveApproversForStep(
      supabase,
      step,
      subject.uid,
      companyId,
      step.approval_department_id || workflowDepartmentId,
      workflow.request_type
    );
    return {
      ...step,
      eligible_approver_count: approvers.length,
      eligibility_warning: approvers.length ? null : 'No eligible approver currently matches this step.',
    };
  }));
}

function requireSuperAdmin(requester, res) {
  if (requester.role !== ROLES.SUPER_ADMIN) {
    res.status(403).json({ success: false, error: 'Super admin required' });
    return false;
  }
  return true;
}

// ── Approval workflows ────────────────────────────────────────────────────────

router.get('/approval-workflows', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manage_approval_workflows', res))) return;
  try {
    await ensureDefaultWorkflows(supabase, companyId);
      const { data: workflows, error } = await supabase
        .from('approval_workflows')
        .select('id, request_type, name, is_active, department_id, version, updated_at')
      .eq('company_id', companyId)
      .order('request_type');
    if (error) throw error;

    const withSteps = await Promise.all(
      (workflows || []).map(async (wf) => {
        const { data: steps } = await supabase
          .from('approval_workflow_steps')
        .select('id, step_order, step_label, approver_role, authority_type, organization_role_id, required_permission_key, required_scope_type, department_id, approval_department_id, workflow_version')
          .eq('workflow_id', wf.id)
          .order('step_order');
        return { ...wf, steps: await addWorkflowEligibility(companyId, wf, steps || []) };
      })
    );

    res.json({ success: true, data: withSteps });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/approval-workflows/:requestType', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!requireSuperAdmin(requester, res)) return;
  if (!(await requireAdminPermission(requester, 'manage_approval_workflows', res))) return;

  const { requestType } = req.params;
  const { name, steps, department_id, department, is_active } = req.body || {};
  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ success: false, error: 'At least one approval step is required' });
  }
  if (!Object.values(REQUEST_TYPES).includes(requestType)) {
    return res.status(400).json({ success: false, error: 'Unsupported approval request type' });
  }

  try {
    const workflowDepartmentId = await resolveDepartmentId({ department_id, department }, companyId);
    if ((department_id || department) && !workflowDepartmentId) {
      return res.status(400).json({ success: false, error: 'Workflow department was not found in this company' });
    }
    const normalizedSteps = steps
      .slice()
      .sort((a, b) => Number(a.step_order || 0) - Number(b.step_order || 0))
      .map(normalizeWorkflowStep);
    for (const step of normalizedSteps) {
      if (step.department_id) {
        const resolved = await resolveDepartmentId({ department_id: step.department_id }, companyId);
        if (!resolved) return res.status(400).json({ success: false, error: 'Step department was not found in this company' });
        step.department_id = resolved;
      }
      if (step.approval_department_id) {
        const resolved = await resolveDepartmentId({ department_id: step.approval_department_id }, companyId);
        if (!resolved) return res.status(400).json({ success: false, error: 'Step approval department was not found in this company' });
        step.approval_department_id = resolved;
      }
      if (step.organization_role_id) {
        const { data: orgRole } = await supabase
          .from('organization_roles')
          .select('id')
          .eq('id', step.organization_role_id)
          .eq('company_id', companyId)
          .eq('is_active', true)
          .maybeSingle();
        if (!orgRole) return res.status(400).json({ success: false, error: 'Step organization role was not found in this company' });
      }
    }

    const rows = normalizedSteps.map((s) => ({
      step_order: s.step_order,
      step_label: s.step_label,
      approver_role: s.approver_role,
      authority_type: s.authority_type,
      organization_role_id: s.organization_role_id,
      required_permission_key: s.required_permission_key || null,
      required_scope_type: s.required_scope_type || null,
      department_id: s.department_id || null,
      approval_department_id: s.approval_department_id || workflowDepartmentId || null,
    }));

    let workflowQuery = supabase
      .from('approval_workflows')
      .select('id')
      .eq('company_id', companyId)
      .eq('request_type', requestType);
    workflowQuery = workflowDepartmentId
      ? workflowQuery.eq('department_id', workflowDepartmentId)
      : workflowQuery.is('department_id', null);
    let { data: wf } = await workflowQuery.maybeSingle();

    let newVersion = 1;
    let workflowIsActive = is_active !== undefined ? Boolean(is_active) : true;
    let createdWithRpc = false;

    if (!wf) {
      const { data: created, error: cErr } = await supabase.rpc('create_approval_workflow_with_steps', {
        p_company_id: companyId,
        p_request_type: requestType,
        p_name: name || requestType.replace(/_/g, ' '),
        p_department_id: workflowDepartmentId,
        p_is_active: is_active !== false,
        p_version: 1,
        p_steps: rows,
      });
      if (cErr) throw cErr;
      wf = { id: created?.id };
      if (!wf.id) throw new Error('Workflow creation did not return an id');
      newVersion = Number(created.version || 1);
      workflowIsActive = is_active !== false;
      createdWithRpc = true;
    } else {
      const { data: current } = await supabase
        .from('approval_workflows')
        .select('version, is_active, name')
        .eq('id', wf.id)
        .maybeSingle();
      newVersion = Number(current?.version || 1) + 1;
      workflowIsActive = is_active !== undefined ? Boolean(is_active) : current?.is_active !== false;
    }

    if (!createdWithRpc) {
      const { error: replacementError } = await supabase.rpc('replace_approval_workflow_steps', {
        p_company_id: companyId,
        p_workflow_id: wf.id,
        p_request_type: requestType,
        p_name: name || requestType.replace(/_/g, ' '),
        p_is_active: workflowIsActive,
        p_version: newVersion,
        p_steps: rows,
      });
      if (replacementError) throw replacementError;
    }

    const updated = await getWorkflowForRequestType(supabase, companyId, requestType, workflowDepartmentId);
    await writeAuthorizationAudit(supabase, {
      companyId,
      actorUid: requester.uid,
      action: 'approval_workflow_changed',
      beforeState: { request_type: requestType, department_id: workflowDepartmentId, version: newVersion - 1 },
      afterState: { request_type: requestType, department_id: workflowDepartmentId, version: newVersion, steps: normalizedSteps },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/approval-workflows/:requestType/audit', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manage_approval_workflows', res))) return;
  try {
    const { data, error } = await supabase
      .from('approval_audit_logs')
      .select('*')
      .eq('company_id', companyId)
      .eq('request_type', req.params.requestType)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Work mode requests ────────────────────────────────────────────────────────

router.get('/work-mode-requests', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const canView = await hasPermission(supabase, requester, 'view_work_mode_requests');
  const canApprove = await hasAnyPermission(supabase, requester, ['approve_work_mode', 'reject_work_mode']);
  if (!canView && !canApprove && requester.role !== ROLES.SUPER_ADMIN) {
    res.status(403).json({ success: false, error: 'Permission required: view_work_mode_requests or approval authority' });
    return;
  }
  try {
    const { data, error } = await supabase
      .from('work_mode_requests')
      .select('*')
      .eq('company_id', companyId)
      .order('requested_at', { ascending: false });
    if (error) throw error;

    const enriched = await Promise.all(
      (data || []).map(async (row) => {
        if (!(await canViewOrApproveWorkflowRequest(requester, row, REQUEST_TYPES.REMOTE_WORK, companyId))) return null;
        const progress = await getApprovalProgress(supabase, REQUEST_TYPES.REMOTE_WORK, row.id);
        const { data: emp } = await supabase
          .from('users')
          .select('name, username, email, department')
          .eq('uid', row.employee_uid)
          .maybeSingle();
        return { ...row, employee: emp, approvalProgress: progress };
      })
    );
    res.json({ success: true, data: enriched.filter(Boolean) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/work-mode-requests/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  const { status, admin_notes } = req.body;
  const permissionKey = status === 'approved' ? 'approve_work_mode' : status === 'rejected' ? 'reject_work_mode' : null;
  if (!permissionKey) return res.status(400).json({ success: false, error: 'status must be approved or rejected' });
  if (!(await requireAdminPermission(requester, permissionKey, res))) return;

  try {
    const { data: row } = await supabase
      .from('work_mode_requests')
      .select('*')
      .eq('id', req.params.id)
      .eq('company_id', companyId)
      .single();
    if (!row) return res.status(404).json({ success: false, error: 'Request not found' });
    if (row.status !== 'pending') return res.status(400).json({ success: false, error: 'Request already processed' });

    let progress = await getApprovalProgress(supabase, REQUEST_TYPES.REMOTE_WORK, row.id);
    if (!progress.length) {
      const init = await initializeApprovalSteps(supabase, {
        companyId,
        requestType: REQUEST_TYPES.REMOTE_WORK,
        requestId: row.id,
        employeeUid: row.employee_uid,
      });
      if (init.workflowId) {
        await supabase.from('work_mode_requests').update({
          workflow_id: init.workflowId,
          approval_department_id: init.steps?.[0]?.approval_department_id || null,
        }).eq('id', row.id);
      }
    }

    const action = status === 'approved' ? 'approved' : 'rejected';
    const result = await processApprovalStep(supabase, {
      companyId,
      requestType: REQUEST_TYPES.REMOTE_WORK,
      requestId: row.id,
      employeeUid: row.employee_uid,
      requester,
      action,
      notes: admin_notes,
      onFinalApprove: async () => {
        await supabase
          .from('users')
          .update({ work_mode: row.requested_work_mode, updated_at: new Date().toISOString() })
          .eq('uid', row.employee_uid)
          .eq('company_id', companyId);
      },
    });

    const finalStatus = result.status === 'approved' && result.final ? 'approved' : result.status === 'rejected' ? 'rejected' : 'pending';
    const updates = {
      status: finalStatus,
      current_step: result.currentStep,
      admin_notes: admin_notes || null,
    };
    if (result.final) {
      updates.processed_at = new Date().toISOString();
      updates.processed_by = requester.username || requester.email;
    }
    await supabase.from('work_mode_requests').update(updates).eq('id', row.id);

    res.json({ success: true, data: { ...result, status: finalStatus } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Employee site assignments ─────────────────────────────────────────────────

router.get('/employee-sites', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manage_geofencing', res))) return;
  const { employee_uid } = req.query;
  try {
    let query = supabase
      .from('employee_sites')
      .select('id, employee_uid, site_id, created_at, sites(id, name, latitude, longitude, radius, department_id, company_id)')
      .order('created_at', { ascending: false });
    if (employee_uid) query = query.eq('employee_uid', employee_uid);

    const { data, error } = await query;
    if (error) throw error;

    const filtered = (data || []).filter((row) => row.sites?.company_id === companyId);
    const scoped = requester.role === ROLES.MANAGER
      ? await (async () => {
          const managerDeptId = await resolveDepartmentId(requester, companyId);
          if (!managerDeptId) return [];
          const { data: deptUsers } = await supabase
            .from('users')
            .select('uid, department_id, department')
            .eq('company_id', companyId);
          const uidSet = new Set();
          for (const u of deptUsers || []) {
            const uDeptId = u.department_id
              ? String(u.department_id)
              : await resolveDepartmentId({ department: u.department }, companyId);
            if (uDeptId === managerDeptId) uidSet.add(String(u.uid));
          }
          return filtered.filter((r) => uidSet.has(String(r.employee_uid)));
        })()
      : filtered;

    const uids = [...new Set(scoped.map((row) => row.employee_uid).filter(Boolean))];
    let peopleByUid = new Map();
    if (uids.length) {
      const { data: people } = await supabase
        .from('users')
        .select('uid, name, username, department, department_id')
        .eq('company_id', companyId)
        .in('uid', uids);
      peopleByUid = new Map((people || []).map((person) => [String(person.uid), person]));
    }

    const payload = scoped.map((row) => {
      const person = peopleByUid.get(String(row.employee_uid));
      return {
        ...row,
        employee_name: person?.name || person?.username || null,
        employee_username: person?.username || null,
        employee_department: person?.department || null,
        employee_department_id: person?.department_id || null,
      };
    });

    res.json({ success: true, data: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/employee-sites/:employeeUid', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manage_geofencing', res))) return;
  const { site_ids: siteIds } = req.body;
  if (!Array.isArray(siteIds)) {
    return res.status(400).json({ success: false, error: 'site_ids array required' });
  }
  try {
    const { data: employee } = await supabase
      .from('users')
      .select('uid, department, department_id, company_id')
      .eq('uid', req.params.employeeUid)
      .eq('company_id', companyId)
      .single();
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });

    let managerDeptId = null;
    if (requester.role === ROLES.MANAGER) {
      managerDeptId = await resolveDepartmentId(requester, companyId);
      const employeeDeptId = await resolveDepartmentId(employee, companyId);
      if (!managerDeptId || employeeDeptId !== managerDeptId) {
        return res
          .status(403)
          .json({ success: false, error: 'Managers can only assign their department employees' });
      }
    }

    if (siteIds.length > 0) {
      let siteQuery = supabase.from('sites').select('id, department_id').eq('company_id', companyId).in('id', siteIds);
      const { data: sites } = await siteQuery;
      if ((sites || []).length !== siteIds.length) {
        return res.status(400).json({ success: false, error: 'One or more sites are invalid for this company' });
      }
      if (managerDeptId && (sites || []).some((s) => String(s.department_id) !== managerDeptId)) {
        return res
          .status(403)
          .json({ success: false, error: 'Managers can only assign employees to their department sites' });
      }
    }

    await supabase.from('employee_sites').delete().eq('employee_uid', employee.uid);
    if (siteIds.length > 0) {
      const rows = siteIds.map((site_id) => ({ employee_uid: employee.uid, site_id }));
      const { error } = await supabase.from('employee_sites').insert(rows);
      if (error) throw error;
    }

    const { data: assigned } = await supabase
      .from('employee_sites')
      .select('id, site_id, sites(id, name, latitude, longitude, radius)')
      .eq('employee_uid', employee.uid);
    res.json({ success: true, data: assigned || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/employee-sites/:id', async (req, res) => {
  const ctx = await withTenantContext(req, res);
  if (!ctx) return;
  const { requester, companyId } = ctx;
  if (!(await requireAdminPermission(requester, 'manage_geofencing', res))) return;
  try {
    const { data: row } = await supabase
      .from('employee_sites')
      .select('id, employee_uid, sites(company_id)')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!row || row.sites?.company_id !== companyId) {
      return res.status(404).json({ success: false, error: 'Assignment not found' });
    }
    await supabase.from('employee_sites').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
