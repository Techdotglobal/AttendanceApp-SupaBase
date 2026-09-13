import { api } from '../../../core/api/client';
import { apiUrl } from '../../../core/config/api';
import { enrichLeavesWithUsers } from '../utils/leaveDisplay';

const extractApiMessage = (error, fallbackMessage) => {
  const apiError = error?.response?.data?.error;
  if (typeof apiError === 'string' && apiError.trim()) return apiError;

  const status = error?.response?.status;
  const data = error?.response?.data;
  const rawBody = typeof data === 'string' ? data : '';
  if (/service suspended/i.test(rawBody)) {
    return 'API gateway URL points to a suspended host. Update VITE_API_GATEWAY_URL to the Coolify HTTPS domain and redeploy the web app.';
  }
  if (status === 401) return 'Authentication expired or missing. Sign out and sign in again.';
  if (status === 403) {
    return (
      (typeof data?.error === 'string' && data.error) ||
      'Permission denied for this action.'
    );
  }
  if (status === 404) {
    return (
      fallbackMessage ||
      'Server API is missing this feature. Redeploy gateway and auth-service from the latest code.'
    );
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'Backend is unavailable (gateway or upstream service). Check Coolify health and try again.';
  }
  if (
    error?.code === 'ERR_NETWORK' ||
    /network error|fetch failed|failed to fetch|econnrefused|eacces/i.test(String(error?.message || ''))
  ) {
    return 'Cannot reach the API gateway. Verify VITE_API_GATEWAY_URL / NEXT_PUBLIC_API_URL and network connectivity.';
  }
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message || ''))) {
    return 'The API request timed out. The gateway or backend may be overloaded.';
  }
  if (fallbackMessage) return fallbackMessage;
  return error?.message || 'Request failed. Check the browser console for details.';
};

const executeApiCall = async (call, fallbackMessage) => {
  try {
    return await call();
  } catch (error) {
    console.error('[adminService] API call failed:', {
      message: error?.message,
      status: error?.response?.status,
      data: error?.response?.data,
    });
    throw new Error(extractApiMessage(error, fallbackMessage));
  }
};

async function trySaveEmail(uid, email, originalUsername) {
  try {
    await api.patch(apiUrl(`/api/auth/users/uid/${uid}/email`), { email });
    return;
  } catch (emailErr) {
    if (emailErr?.response?.status === 404 && originalUsername) {
      await api.patch(apiUrl(`/api/auth/users/${encodeURIComponent(originalUsername)}/email`), { email });
      return;
    }
    throw new Error(extractApiMessage(emailErr, 'Failed to update email'));
  }
}

async function fetchReportBlob(reportId, mode = 'download') {
  const path = mode === 'preview' ? `/api/reports/preview/${reportId}` : `/api/reports/download/${reportId}`;
  try {
    const response = await api.get(apiUrl(path), { responseType: 'blob', timeout: 120000 });
    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
      const text = await response.data.text();
      const err = JSON.parse(text);
      throw new Error(err.message || err.error || 'Unable to load report');
    }
    if (!contentType.includes('pdf') && response.data.type && !response.data.type.includes('pdf')) {
      throw new Error('Unable to load report. Invalid response format.');
    }
    return response.data;
  } catch (error) {
    if (error.response?.data instanceof Blob) {
      try {
        const text = await error.response.data.text();
        const err = JSON.parse(text);
        throw new Error(err.message || err.error || 'Unable to load report');
      } catch {
        throw new Error('Unable to load report');
      }
    }
    throw new Error(extractApiMessage(error, 'Unable to load report'));
  }
}

export const adminService = {
  getStats: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/dashboard/stats'))).data.data, 'Failed to load dashboard stats'),
  getAnalytics: async () => {
    try {
      const res = await api.get(apiUrl('/api/admin/analytics'));
      return res.data?.data ?? null;
    } catch (error) {
      if (error?.response?.status === 404) {
        return null;
      }
      throw new Error(extractApiMessage(error, 'Failed to load analytics'));
    }
  },
  getPermissionMeta: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/permissions/meta'))).data.data, 'Failed to load permissions'),
  getManagers: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/managers'))).data.data, 'Failed to load managers'),
  getManagerPermissions: async (uid) =>
    executeApiCall(
      async () => (await api.get(apiUrl(`/api/admin/managers/${uid}/permissions`))).data.data,
      'Failed to load manager permissions'
    ),
  updateManagerPermissions: async (uid, permissions) =>
    executeApiCall(
      async () => (await api.put(apiUrl(`/api/admin/managers/${uid}/permissions`), { permissions })).data,
      'Failed to save manager permissions'
    ),
  getAuditLogs: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/audit-logs'))).data.data, 'Failed to load audit logs'),
  getUsers: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/users'))).data.data, 'Failed to load users'),
  getPositionSuggestions: async () =>
    executeApiCall(
      async () => (await api.get(apiUrl('/api/auth/position-suggestions'))).data.data,
      'Failed to load position suggestions'
    ),
  getUserProfile: async (uid) => {
    try {
      const res = await api.get(apiUrl(`/api/admin/users/${uid}`));
      return res.data?.data ?? null;
    } catch (error) {
      if (error?.response?.status === 404) {
        console.warn('[adminService] getUserProfile not available on API (deploy auth-service + gateway)');
        return null;
      }
      throw new Error(extractApiMessage(error, 'Failed to load user profile'));
    }
  },
  createUser: async (payload) =>
    executeApiCall(async () => (await api.post(apiUrl('/api/auth/users'), payload)).data, 'Failed to create user'),
  updateUser: async (uid, payload) =>
    executeApiCall(
      async () => (await api.patch(apiUrl(`/api/admin/users/${uid}`), payload)).data,
      'Failed to update user'
    ),
  updateUserRole: async (uid, role, username) => {
    try {
      const res = await api.patch(apiUrl(`/api/auth/users/uid/${uid}/role`), { role });
      return res.data;
    } catch (error) {
      if (error?.response?.status === 404 && username) {
        const res = await api.patch(
          apiUrl(`/api/auth/users/${encodeURIComponent(username)}/role`),
          { role }
        );
        return res.data;
      }
      throw new Error(extractApiMessage(error, 'Failed to update user role'));
    }
  },
  /**
   * @param {string} uid
   * @param {object} payload — username, name, email, department, leave fields (no password)
   * @param {{ originalUsername?: string, originalEmail?: string }} [context]
   */
  updateUserProfile: async (uid, payload, context = {}) => {
    const { originalUsername, originalEmail } = context;
    const trimmedUsername =
      payload.username !== undefined ? String(payload.username).trim() : undefined;
    const usernameChanged =
      trimmedUsername !== undefined &&
      originalUsername != null &&
      trimmedUsername !== String(originalUsername).trim();
    const emailChanged =
      payload.email !== undefined &&
      originalEmail != null &&
      String(payload.email).trim() !== String(originalEmail).trim();

    let usernameSaved = false;
    if (usernameChanged) {
      try {
        await api.patch(apiUrl(`/api/auth/users/uid/${uid}/username`), {
          username: trimmedUsername,
        });
        usernameSaved = true;
      } catch (uidUserErr) {
        if (uidUserErr?.response?.status !== 404) {
          throw new Error(extractApiMessage(uidUserErr, 'Failed to update username'));
        }
      }
      if (!usernameSaved && originalUsername) {
        try {
          await api.patch(apiUrl(`/api/auth/users/${encodeURIComponent(originalUsername)}`), {
            username: trimmedUsername,
          });
          usernameSaved = true;
        } catch (legacyUserErr) {
          throw new Error(extractApiMessage(legacyUserErr, 'Failed to update username'));
        }
      }
      if (!usernameSaved) {
        throw new Error(
          'Username could not be saved. Redeploy auth-service and api-gateway on Render from the latest code.'
        );
      }
    }

    if (emailChanged) {
      await trySaveEmail(uid, payload.email, originalUsername);
    }

    const adminPayload = { ...payload };
    delete adminPayload.password;
    if (emailChanged) delete adminPayload.email;
    if (usernameSaved) delete adminPayload.username;

    try {
      const res = await api.patch(apiUrl(`/api/admin/users/${uid}`), adminPayload);
      const data = res.data?.data ?? res.data;
      if (usernameSaved && trimmedUsername) {
        return { ...data, uid, username: trimmedUsername };
      }
      return data;
    } catch (error) {
      if (error?.response?.status !== 404) {
        throw new Error(extractApiMessage(error, 'Failed to update user profile'));
      }

      console.warn('[adminService] Admin profile API not found — using legacy routes');

      if (!originalUsername) {
        throw new Error('Cannot update profile: missing username context. Refresh and try again.');
      }

      if (usernameChanged && !usernameSaved) {
        try {
          await api.patch(apiUrl(`/api/auth/users/${encodeURIComponent(originalUsername)}`), {
            username: trimmedUsername,
          });
          usernameSaved = true;
        } catch (legacyErr) {
          throw new Error(extractApiMessage(legacyErr, 'Failed to update username'));
        }
      }

      const infoUpdates = {};
      if (adminPayload.name !== undefined) {
        infoUpdates.name = adminPayload.name;
      }
      if (adminPayload.department !== undefined) {
        infoUpdates.department = adminPayload.department;
      }

      if (Object.keys(infoUpdates).length > 0) {
        const lookupName = usernameSaved ? trimmedUsername : originalUsername;
        try {
          await api.patch(apiUrl(`/api/auth/users/${encodeURIComponent(lookupName)}`), infoUpdates);
        } catch (legacyErr) {
          throw new Error(extractApiMessage(legacyErr, 'Failed to update profile fields'));
        }
      }

      const leaveTouched =
        adminPayload.annual_leaves !== undefined ||
        adminPayload.sick_leaves !== undefined ||
        adminPayload.casual_leaves !== undefined;
      if (leaveTouched) {
        throw new Error(
          'Leave allocation could not be saved. Redeploy auth-service and api-gateway on Render, or run them locally.'
        );
      }

      return {
        uid,
        username: usernameSaved ? trimmedUsername : adminPayload.username ?? originalUsername,
        name: adminPayload.name,
        email: payload.email,
        department: adminPayload.department,
      };
    }
  },
  getDepartments: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/departments'))).data.data, 'Failed to load departments'),
  getDepartmentsOverview: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/departments/overview'))).data.data, 'Failed to load departments overview'),
  createDepartment: async (payload) =>
    executeApiCall(async () => (await api.post(apiUrl('/api/admin/departments'), payload)).data, 'Failed to create department'),
  renameDepartment: async (id, payload) =>
    executeApiCall(async () => (await api.patch(apiUrl(`/api/admin/departments/${id}`), payload)).data, 'Failed to rename department'),
  deleteDepartment: async (id) =>
    executeApiCall(async () => (await api.delete(apiUrl(`/api/admin/departments/${id}`))).data, 'Failed to delete department'),
  getSites: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/sites'))).data.data, 'Failed to load sites'),
  createSite: async (payload) =>
    executeApiCall(async () => (await api.post(apiUrl('/api/admin/sites'), payload)).data, 'Failed to create site'),
  updateSite: async (id, payload) =>
    executeApiCall(
      async () => (await api.patch(apiUrl(`/api/admin/sites/${id}`), payload)).data,
      'Failed to update site'
    ),
  deleteSite: async (id) =>
    executeApiCall(
      async () => (await api.delete(apiUrl(`/api/admin/sites/${id}`))).data,
      'Failed to delete site'
    ),
  assignEmployeeSite: async (payload) =>
    executeApiCall(async () => (await api.post(apiUrl('/api/admin/employee-sites'), payload)).data, 'Failed to assign site'),
  getAttendance: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/attendance'))).data.data, 'Failed to load attendance'),
  createManualAttendance: async (payload) =>
    executeApiCall(async () => (await api.post(apiUrl('/api/admin/attendance'), payload)).data.data, 'Failed to create attendance record'),
  updateAttendance: async (id, payload) =>
    executeApiCall(async () => (await api.patch(apiUrl(`/api/admin/attendance/${id}`), payload)).data.data, 'Failed to update attendance record'),
  deleteAttendance: async (id) =>
    executeApiCall(async () => (await api.delete(apiUrl(`/api/admin/attendance/${id}`))).data, 'Failed to delete attendance record'),
  getLeaves: async () => {
    const leaves = await executeApiCall(
      async () => (await api.get(apiUrl('/api/admin/leaves'))).data.data,
      'Failed to load leaves'
    );
    if (!leaves?.length) return leaves || [];
    const needsEnrichment = leaves.some((row) => !row.employee_name && !row.employeeName);
    if (!needsEnrichment) return leaves;
    try {
      const users = await executeApiCall(
        async () => (await api.get(apiUrl('/api/admin/users'))).data.data,
        'Failed to load users for leave enrichment'
      );
      return enrichLeavesWithUsers(leaves, users || []);
    } catch (enrichErr) {
      console.warn('[adminService] getLeaves client enrichment skipped:', enrichErr?.message);
      return leaves;
    }
  },
  processLeave: async (id, payload) =>
    executeApiCall(async () => (await api.patch(apiUrl(`/api/admin/leaves/${id}`), payload)).data, 'Failed to process leave request'),
  createLeave: async (payload) =>
    executeApiCall(async () => (await api.post(apiUrl('/api/admin/leaves'), payload)).data.data, 'Failed to create leave request'),

  // Reports
  generateReportPdf: async (payload) =>
    executeApiCall(
      async () => (await api.post(apiUrl('/api/reports/generate-pdf'), payload, { timeout: 120000 })).data,
      'PDF generation failed'
    ),
  generateAndEmailReport: async (payload) =>
    executeApiCall(
      async () => (await api.post(apiUrl('/api/reports/generate-and-email'), payload, { timeout: 120000 })).data,
      'Failed to generate and email report'
    ),
  generateReport: async (payload) =>
    executeApiCall(
      async () => (await api.post(apiUrl('/api/reports/generate-pdf'), payload, { timeout: 120000 })).data,
      'Failed to generate report'
    ),
  getReportHistory: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/reports/history'))).data.reports, 'Failed to load report history'),
  getLatestReport: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/reports/latest'))).data.report, 'Failed to load latest report'),
  getReportRecipients: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/reports/recipients'))).data.recipients, 'Failed to load recipients'),
  resendReportEmail: async (reportId) =>
    executeApiCall(
      async () => (await api.post(apiUrl(`/api/reports/email/${reportId}`), {})).data,
      'Email failed'
    ),
  deleteReport: async (reportId) =>
    executeApiCall(
      async () => (await api.delete(apiUrl(`/api/reports/${reportId}`))).data,
      'Failed to delete report'
    ),
  fetchReportBlob,
  downloadReportFile: async (reportId, filename = 'report.pdf') => {
    const blob = await fetchReportBlob(reportId, 'download');
    if (!blob || blob.size < 100) {
      throw new Error('Downloaded file is empty or corrupted.');
    }
    const header = await blob.slice(0, 4).text();
    if (!header.startsWith('%PDF')) {
      throw new Error('Downloaded file is not a valid PDF.');
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  previewReport: async (reportId) => {
    const path = `/api/reports/preview/${reportId}`;
    const response = await api.get(apiUrl(path), { responseType: 'blob', timeout: 120000 });
    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('application/json') || (response.data.type && response.data.type.includes('json'))) {
      const text = await response.data.text();
      const err = JSON.parse(text);
      throw new Error(err.message || err.error || 'Unable to load report');
    }
    const url = URL.createObjectURL(response.data);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  sendReportNow: async () =>
    executeApiCall(async () => (await api.post(apiUrl('/api/reports/send-now'), {})).data, 'Failed to send report'),
  getReportSchedule: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/reports/schedule'))).data.schedule, 'Failed to load report schedule'),
  updateReportSchedule: async (payload) =>
    executeApiCall(async () => (await api.put(apiUrl('/api/reports/schedule'), payload)).data.schedule, 'Failed to update report schedule'),
  getReportDeliveryLogs: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/reports/delivery-logs'))).data.logs, 'Failed to load delivery logs'),

  getApprovalWorkflows: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/approval-workflows'))).data.data, 'Failed to load workflows'),
  updateApprovalWorkflow: async (requestType, payload) =>
    executeApiCall(async () => (await api.put(apiUrl(`/api/admin/approval-workflows/${requestType}`), payload)).data.data, 'Failed to save workflow'),
  getWorkModeRequests: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/work-mode-requests'))).data.data, 'Failed to load work mode requests'),
  processWorkModeRequest: async (id, payload) =>
    executeApiCall(async () => (await api.patch(apiUrl(`/api/admin/work-mode-requests/${id}`), payload)).data, 'Failed to process request'),
  getEmployeeSites: async (employeeUid) =>
    executeApiCall(async () => {
      const q = employeeUid ? `?employee_uid=${encodeURIComponent(employeeUid)}` : '';
      return (await api.get(apiUrl(`/api/admin/employee-sites${q}`))).data.data;
    }, 'Failed to load site assignments'),
  setEmployeeSites: async (employeeUid, siteIds) =>
    executeApiCall(async () => (await api.put(apiUrl(`/api/admin/employee-sites/${employeeUid}`), { site_ids: siteIds })).data.data, 'Failed to save site assignments'),
  refreshMyPermissions: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/auth/me/permissions'))).data.data, 'Failed to refresh permissions'),

  getTickets: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/tickets'))).data.data, 'Failed to load tickets'),
  createTicket: async (payload) =>
    executeApiCall(async () => (await api.post(apiUrl('/api/admin/tickets'), payload)).data.data, 'Failed to create ticket'),
  assignTicket: async (id, assigned_to) =>
    executeApiCall(async () => (await api.patch(apiUrl(`/api/admin/tickets/${id}/assign`), { assigned_to })).data.data, 'Failed to assign ticket'),
  closeTicket: async (id) =>
    executeApiCall(async () => (await api.patch(apiUrl(`/api/admin/tickets/${id}/close`), {})).data.data, 'Failed to close ticket'),
  reopenTicket: async (id) =>
    executeApiCall(async () => (await api.patch(apiUrl(`/api/admin/tickets/${id}/reopen`), {})).data.data, 'Failed to reopen ticket'),

  getCalendarEvents: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/calendar-events'))).data.data, 'Failed to load events'),
  createCalendarEvent: async (payload) =>
    executeApiCall(async () => (await api.post(apiUrl('/api/admin/calendar-events'), payload)).data.data, 'Failed to create event'),
  updateCalendarEvent: async (id, payload) =>
    executeApiCall(async () => (await api.patch(apiUrl(`/api/admin/calendar-events/${id}`), payload)).data.data, 'Failed to update event'),
  deleteCalendarEvent: async (id) =>
    executeApiCall(async () => (await api.delete(apiUrl(`/api/admin/calendar-events/${id}`))).data, 'Failed to delete event'),

  getNotifications: async (params = {}) =>
    executeApiCall(async () => {
      const q = new URLSearchParams();
      if (params.page) q.set('page', params.page);
      if (params.limit) q.set('limit', params.limit);
      if (params.read != null) q.set('read', params.read);
      if (params.type) q.set('type', params.type);
      const suffix = q.toString() ? `?${q.toString()}` : '';
      const body = (await api.get(apiUrl(`/api/admin/notifications${suffix}`))).data;
      const data = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
      const total = Number.isFinite(body?.total) ? body.total : data.length;
      return { data, total, page: body?.page, limit: body?.limit };
    }, 'Failed to load notifications'),
  getUnreadNotificationCount: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/notifications/unread-count'))).data.count, 'Failed to load count'),
  markNotificationRead: async (id) =>
    executeApiCall(async () => (await api.patch(apiUrl(`/api/admin/notifications/${id}/read`), {})).data, 'Failed to mark read'),
  markAllNotificationsRead: async () =>
    executeApiCall(async () => (await api.post(apiUrl('/api/admin/notifications/mark-all-read'), {})).data, 'Failed to mark all read'),
  deleteNotification: async (id) =>
    executeApiCall(async () => (await api.delete(apiUrl(`/api/admin/notifications/${id}`))).data, 'Failed to delete notification'),

  getSettings: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/settings'))).data.data, 'Failed to load settings'),
  saveSettingsSection: async (section, values, reset = false) =>
    executeApiCall(async () => (await api.put(apiUrl('/api/admin/settings'), { section, values, reset })).data, 'Failed to save settings'),
};
