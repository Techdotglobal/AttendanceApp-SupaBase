/**
 * Multi-step approval engine for leave and work-mode requests.
 */
const {
  REQUEST_TYPES,
  LEAVE_TYPE_TO_REQUEST_TYPE,
  APPROVER_ROLES,
  DEFAULT_WORKFLOW_TEMPLATES,
} = require('../../../shared/permissions/catalog.cjs');
const { hasPermission, getUserDepartmentIds } = require('./permissions');

async function isApprovalAuthorityV2Enabled(supabase, companyId) {
  try {
    const { data } = await supabase
      .from('companies')
      .select('app_settings')
      .eq('id', companyId)
      .maybeSingle();
    return data?.app_settings?.approval_authority_v2_enabled !== false;
  } catch (_) {
    return true;
  }
}

function normalizeAuthorityType(step) {
  if (step?.authority_type) return String(step.authority_type).toUpperCase();
  return step?.required_permission_key ? 'PERMISSION' : 'LEGACY_ROLE';
}

async function getApprovalSubject(supabase, employeeUid, companyId) {
  const { data } = await supabase
    .from('users')
    .select('uid, department, department_id, organization_role_id, company_id, is_active')
    .eq('uid', employeeUid)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!data) return null;
  const departments = await getUserDepartmentIds(supabase, employeeUid, data);
  return { ...data, departmentIds: departments };
}

async function getApprovalDepartmentId(supabase, employeeUid, companyId, fallback = null) {
  const subject = await getApprovalSubject(supabase, employeeUid, companyId);
  return subject?.departmentIds?.[0] || subject?.department_id || fallback || null;
}

async function writeApprovalAudit(supabase, entry) {
  try {
    await supabase.from('approval_audit_logs').insert({
      company_id: entry.companyId,
      request_type: entry.requestType,
      request_id: entry.requestId,
      actor_uid: entry.actorUid || null,
      actor_username: entry.actorUsername || null,
      action: entry.action,
      step_order: entry.stepOrder ?? null,
      details: entry.details || {},
    });
  } catch (err) {
    console.warn('[approvalEngine] audit write failed:', err.message);
  }
}

async function notifyUsers(supabase, { companyId, recipientUids, title, message, type = 'approval' }) {
  if (!recipientUids?.length) return;
  const rows = recipientUids.map((uid) => ({
    company_id: companyId,
    recipient_uid: uid,
    title,
    body: message,
    type,
    read: false,
  }));
  try {
    const { error } = await supabase.from('notifications').insert(rows);
    if (error) {
      console.warn('[approvalEngine] notification insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[approvalEngine] notification insert failed:', err.message);
  }
}

async function ensureDefaultWorkflows(supabase, companyId) {
  for (const [requestType, steps] of Object.entries(DEFAULT_WORKFLOW_TEMPLATES)) {
    const { data: existing } = await supabase
      .from('approval_workflows')
      .select('id')
      .eq('company_id', companyId)
      .eq('request_type', requestType)
      .is('department_id', null)
      .maybeSingle();
    if (existing) continue;

    const name = requestType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const { data: wf, error } = await supabase
      .from('approval_workflows')
      .insert({ company_id: companyId, request_type: requestType, name, department_id: null, version: 1 })
      .select('id')
      .single();
    if (error) {
      console.warn(`[approvalEngine] default workflow ${requestType}:`, error.message);
      continue;
    }
    const stepRows = steps.map((s) => ({
      workflow_id: wf.id,
      step_order: s.step_order,
      step_label: s.step_label,
      approver_role: s.approver_role,
      authority_type: s.authority_type || 'LEGACY_ROLE',
      organization_role_id: s.organization_role_id || null,
      required_permission_key: s.required_permission_key || null,
      required_scope_type: s.required_scope_type || null,
      department_id: s.department_id || null,
      approval_department_id: s.approval_department_id || null,
      workflow_version: 1,
    }));
    await supabase.from('approval_workflow_steps').insert(stepRows);
  }
}

async function getWorkflowForRequestType(supabase, companyId, requestType, approvalDepartmentId = null) {
  await ensureDefaultWorkflows(supabase, companyId);
  const authorityV2 = await isApprovalAuthorityV2Enabled(supabase, companyId);
  const baseWorkflowQuery = () => supabase
    .from('approval_workflows')
    .select('id, request_type, name, is_active, department_id, version')
    .eq('company_id', companyId)
    .eq('request_type', requestType)
    .eq('is_active', true);

  if (authorityV2 && approvalDepartmentId) {
    const { data: departmentWorkflow } = await baseWorkflowQuery()
      .eq('department_id', approvalDepartmentId)
      .maybeSingle();
    if (departmentWorkflow) return getWorkflowSteps(supabase, departmentWorkflow, approvalDepartmentId);
  }

  const { data: wf } = await baseWorkflowQuery()
    .is('department_id', null)
    .maybeSingle();
  if (!wf) return null;

  return getWorkflowSteps(supabase, wf, approvalDepartmentId);
}

async function getWorkflowSteps(supabase, wf, approvalDepartmentId = null) {
  const { data: steps } = await supabase
    .from('approval_workflow_steps')
    .select('id, step_order, step_label, approver_role, authority_type, organization_role_id, required_permission_key, required_scope_type, department_id, approval_department_id, workflow_version')
    .eq('workflow_id', wf.id)
    .order('step_order', { ascending: true });

  return {
    ...wf,
    steps: (steps || []).map((step) => ({
      ...step,
      authority_type: normalizeAuthorityType(step),
      workflow_version: step.workflow_version || wf.version || 1,
      approval_department_id: step.approval_department_id || approvalDepartmentId || wf.department_id || null,
    })),
  };
}

async function initializeApprovalSteps(supabase, { companyId, requestType, requestId, employeeUid }) {
  const approvalDepartmentId = await getApprovalDepartmentId(supabase, employeeUid, companyId);
  const workflow = await getWorkflowForRequestType(supabase, companyId, requestType, approvalDepartmentId);
  if (!workflow?.steps?.length) return { workflowId: null, steps: [] };

  const rows = workflow.steps.map((s) => ({
    company_id: companyId,
    request_type: requestType,
    request_id: requestId,
    step_order: s.step_order,
    step_label: s.step_label,
    approver_role: s.approver_role,
    authority_type: normalizeAuthorityType(s),
    organization_role_id: s.organization_role_id || null,
    required_permission_key: s.required_permission_key || null,
    required_scope_type: s.required_scope_type || null,
    department_id: s.department_id || null,
    approval_department_id: approvalDepartmentId || s.approval_department_id || workflow.department_id || null,
    workflow_version: s.workflow_version || workflow.version || 1,
    action: 'pending',
  }));

  const { error } = await supabase.from('approval_request_actions').insert(rows);
  if (error) throw error;

  const approvers = await resolveApproversForStep(supabase, workflow.steps[0], employeeUid, companyId, approvalDepartmentId, requestType);
  if (!approvers.length) {
    await writeApprovalAudit(supabase, {
      companyId,
      requestType,
      requestId,
      action: 'no_eligible_approver',
      stepOrder: workflow.steps[0].step_order,
      details: {
        authority_type: workflow.steps[0].authority_type,
        required_permission_key: workflow.steps[0].required_permission_key,
        required_scope_type: workflow.steps[0].required_scope_type,
        department_id: workflow.steps[0].department_id,
      },
    });
    const { data: superAdmins } = await supabase
      .from('users')
      .select('uid')
      .eq('company_id', companyId)
      .eq('role', 'super_admin')
      .eq('is_active', true);
    await notifyUsers(supabase, {
      companyId,
      recipientUids: (superAdmins || []).map((user) => user.uid),
      title: 'Approval workflow needs attention',
      message: `No eligible approver is configured for step "${workflow.steps[0].step_label}".`,
      type: 'approval_configuration',
    });
  }
  await notifyUsers(supabase, {
    companyId,
    recipientUids: approvers.map((a) => a.uid),
    title: 'Approval required',
    message: `A new ${requestType.replace(/_/g, ' ')} request needs your review.`,
  });

  return { workflowId: workflow.id, steps: workflow.steps };
}

async function getApprovalProgress(supabase, requestType, requestId) {
  const { data } = await supabase
    .from('approval_request_actions')
    .select('*')
    .eq('request_type', requestType)
    .eq('request_id', requestId)
    .order('step_order', { ascending: true });
  return data || [];
}

async function resolveApproversForStep(supabase, step, employeeUid, companyId, approvalDepartmentId = null, requestType = null) {
  const authorityType = normalizeAuthorityType(step);
  const role = step.approver_role;
  const employee = await getApprovalSubject(supabase, employeeUid, companyId);
  if (!employee) return [];
  const targetDepartmentId = step.department_id || approvalDepartmentId || employee.departmentIds?.[0] || employee.department_id;
  const target = {
    companyId,
    targetUid: employeeUid,
    employeeUid,
    departmentId: targetDepartmentId,
    department: employee.department,
  };

  const { data: candidates } = await supabase
    .from('users')
    .select('uid, username, email, role, department, department_id, organization_role_id, company_id')
    .eq('company_id', companyId)
    .eq('is_active', true);

  const approvers = [];
  for (const candidate of candidates || []) {
    // Prevent ordinary users from approving their own request. The existing
    // super-admin override remains available for tenant recovery workflows.
    if (String(candidate.uid) === String(employeeUid) && candidate.role !== 'super_admin') continue;

    let eligible = false;
    if (candidate.role === 'super_admin' && role === APPROVER_ROLES.SUPER_ADMIN) {
      eligible = true;
    } else if (authorityType === 'ORGANIZATION_ROLE') {
      eligible = Boolean(step.organization_role_id) &&
        String(candidate.organization_role_id) === String(step.organization_role_id) &&
        Boolean(step.required_permission_key) &&
        await hasPermission(supabase, candidate, step.required_permission_key, target);
    } else if (authorityType === 'PERMISSION' || step.required_permission_key) {
      eligible = Boolean(step.required_permission_key) &&
        await hasPermission(supabase, candidate, step.required_permission_key, target);
    } else if (role === APPROVER_ROLES.SUPER_ADMIN) {
      eligible = candidate.role === 'super_admin';
    } else if (role === APPROVER_ROLES.DEPARTMENT_MANAGER) {
      const assignedDepartments = await getUserDepartmentIds(supabase, candidate.uid, candidate);
      const legacyDepartmentMatch = candidate.role === 'manager' &&
        ((targetDepartmentId && assignedDepartments.includes(String(targetDepartmentId))) ||
          (employee.department && candidate.department === employee.department));
      const scopedPermissionMatch = await hasPermission(supabase, candidate, requestType === REQUEST_TYPES.REMOTE_WORK ? 'approve_work_mode' : 'approve_leave', target);
      eligible = legacyDepartmentMatch || scopedPermissionMatch;
    } else if (role === APPROVER_ROLES.HR) {
      // Preserve the existing HR behavior: HR is a workflow label, while the
      // actual authority still comes from the scoped approval permission.
      eligible = await hasPermission(supabase, candidate, requestType === REQUEST_TYPES.REMOTE_WORK ? 'approve_work_mode' : 'approve_leave', target);
    }

    if (eligible) approvers.push(candidate);
  }
  return approvers;
}

async function canUserActOnStep(supabase, requester, step, employeeUid, companyId, requestType = null) {
  if (requester.role === 'super_admin') return true;
  if (String(requester.uid) === String(employeeUid)) return false;
  const employee = await getApprovalSubject(supabase, employeeUid, companyId);
  if (!employee) return false;
  const targetDepartmentId = step.department_id || step.approval_department_id || employee.departmentIds?.[0] || employee.department_id;
  const target = {
    companyId,
    targetUid: employeeUid,
    employeeUid,
    departmentId: targetDepartmentId,
    department: employee.department,
  };
  const authorityType = normalizeAuthorityType(step);
  if (authorityType === 'ORGANIZATION_ROLE' &&
      String(requester.organization_role_id || '') !== String(step.organization_role_id || '')) return false;
  if ((authorityType === 'PERMISSION' || step.required_permission_key) && step.required_permission_key) {
    return hasPermission(supabase, { ...requester, company_id: companyId }, step.required_permission_key, target);
  }
  const approvers = await resolveApproversForStep(supabase, step, employeeUid, companyId, step.approval_department_id, requestType);
  return approvers.some((a) => a.uid === requester.uid);
}

async function processApprovalStep(supabase, {
  companyId,
  requestType,
  requestId,
  employeeUid,
  requester,
  action,
  notes,
  onFinalApprove,
}) {
  const progress = await getApprovalProgress(supabase, requestType, requestId);
  const pendingStep = progress.find((p) => p.action === 'pending');
  if (!pendingStep) {
    throw new Error('No pending approval step for this request');
  }

  const stepDef = {
    approver_role: pendingStep.approver_role,
    step_order: pendingStep.step_order,
    step_label: pendingStep.step_label,
    authority_type: pendingStep.authority_type,
    organization_role_id: pendingStep.organization_role_id,
    required_permission_key: pendingStep.required_permission_key,
    required_scope_type: pendingStep.required_scope_type,
    department_id: pendingStep.department_id,
    approval_department_id: pendingStep.approval_department_id,
  };

  const allowed = await canUserActOnStep(supabase, requester, stepDef, employeeUid, companyId, requestType);
  if (!allowed) {
    throw new Error('You are not authorized to act on this approval step');
  }

  if (action === 'rejected') {
    const { data: rejectedAction, error: rejectError } = await supabase
      .from('approval_request_actions')
      .update({
        action: 'rejected',
        approver_uid: requester.uid,
        approver_username: requester.username || requester.email,
        notes: notes || null,
        acted_at: new Date().toISOString(),
      })
      .eq('id', pendingStep.id)
      .eq('action', 'pending')
      .select('id')
      .maybeSingle();
    if (rejectError) throw rejectError;
    if (!rejectedAction) throw new Error('Approval step was already processed');

    await writeApprovalAudit(supabase, {
      companyId,
      requestType,
      requestId,
      actorUid: requester.uid,
      actorUsername: requester.username,
      action: 'rejected',
      stepOrder: pendingStep.step_order,
      details: { notes },
    });

    return { final: true, status: 'rejected', currentStep: pendingStep.step_order };
  }

  const { data: approvedAction, error: approveError } = await supabase
    .from('approval_request_actions')
    .update({
      action: 'approved',
      approver_uid: requester.uid,
      approver_username: requester.username || requester.email,
      notes: notes || null,
      acted_at: new Date().toISOString(),
    })
    .eq('id', pendingStep.id)
    .eq('action', 'pending')
    .select('id')
    .maybeSingle();
  if (approveError) throw approveError;
  if (!approvedAction) throw new Error('Approval step was already processed');

  await writeApprovalAudit(supabase, {
    companyId,
    requestType,
    requestId,
    actorUid: requester.uid,
    actorUsername: requester.username,
    action: 'approved',
    stepOrder: pendingStep.step_order,
    details: { notes },
  });

  const nextPending = progress.find(
    (p) => p.step_order > pendingStep.step_order && p.action === 'pending'
  );

  if (nextPending) {
    const approvers = await resolveApproversForStep(
      supabase,
      {
        approver_role: nextPending.approver_role,
        authority_type: nextPending.authority_type,
        organization_role_id: nextPending.organization_role_id,
        required_permission_key: nextPending.required_permission_key,
        required_scope_type: nextPending.required_scope_type,
        department_id: nextPending.department_id,
        approval_department_id: nextPending.approval_department_id,
      },
      employeeUid,
      companyId,
      nextPending.approval_department_id,
      requestType
    );
    if (!approvers.length) {
      await writeApprovalAudit(supabase, {
        companyId,
        requestType,
        requestId,
        actorUid: requester.uid,
        actorUsername: requester.username,
        action: 'no_eligible_approver',
        stepOrder: nextPending.step_order,
        details: {
          authority_type: nextPending.authority_type,
          required_permission_key: nextPending.required_permission_key,
          required_scope_type: nextPending.required_scope_type,
          department_id: nextPending.department_id,
        },
      });
      const { data: superAdmins } = await supabase
        .from('users')
        .select('uid')
        .eq('company_id', companyId)
        .eq('role', 'super_admin')
        .eq('is_active', true);
      await notifyUsers(supabase, {
        companyId,
        recipientUids: (superAdmins || []).map((user) => user.uid),
        title: 'Approval workflow needs attention',
        message: `No eligible approver is configured for step "${nextPending.step_label}".`,
        type: 'approval_configuration',
      });
    }
    await notifyUsers(supabase, {
      companyId,
      recipientUids: approvers.map((a) => a.uid),
      title: 'Approval required',
      message: `Step "${nextPending.step_label}" is waiting for your review.`,
    });
    return {
      final: false,
      status: 'pending',
      currentStep: nextPending.step_order,
    };
  }

  if (typeof onFinalApprove === 'function') {
    await onFinalApprove();
  }

  return { final: true, status: 'approved', currentStep: pendingStep.step_order };
}

function mapLeaveTypeToRequestType(leaveType) {
  return LEAVE_TYPE_TO_REQUEST_TYPE[leaveType] || REQUEST_TYPES.CASUAL_LEAVE;
}

module.exports = {
  REQUEST_TYPES,
  mapLeaveTypeToRequestType,
  ensureDefaultWorkflows,
  getWorkflowForRequestType,
  initializeApprovalSteps,
  getApprovalProgress,
  resolveApproversForStep,
  canUserActOnStep,
  processApprovalStep,
  writeApprovalAudit,
};
