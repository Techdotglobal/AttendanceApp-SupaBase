import { api } from '../../../core/api/client';
import { apiUrl } from '../../../core/config/api';
import { enrichLeavesWithUsers } from '../utils/leaveDisplay';

const extractApiMessage = (error, fallbackMessage) => {
  const apiError = error?.response?.data?.error;
  if (apiError) return apiError;
  const status = error?.response?.status;
  if (status === 404) {
    return (
      fallbackMessage ||
      'Server API is missing this feature. Redeploy auth-service and api-gateway on Render from the latest code.'
    );
  }
  if (status === 503) return 'Backend is unavailable. Wait a minute and try again.';
  if (fallbackMessage) return fallbackMessage;
  return 'Request failed. Check the browser console for details.';
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
  assignEmployeeSite: async (payload) =>
    executeApiCall(async () => (await api.post(apiUrl('/api/admin/employee-sites'), payload)).data, 'Failed to assign site'),
  getAttendance: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/attendance'))).data.data, 'Failed to load attendance'),
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
  fetchReportBlob: async (reportId, mode = 'download') => {
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
  },
  downloadReportFile: async (reportId, filename = 'report.pdf') => {
    const path = `/api/reports/download/${reportId}`;
    const response = await api.get(apiUrl(path), { responseType: 'blob', timeout: 120000 });
    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('application/json') || (response.data.type && response.data.type.includes('json'))) {
      const text = await response.data.text();
      const err = JSON.parse(text);
      throw new Error(err.message || err.error || 'Unable to load report');
    }
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
};
