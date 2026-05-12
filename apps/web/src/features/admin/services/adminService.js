import { api } from '../../../core/api/client';
import { apiUrl } from '../../../core/config/api';

const extractApiMessage = (error, fallbackMessage) =>
  error?.response?.data?.error || error?.message || fallbackMessage;

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

export const adminService = {
  getStats: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/dashboard/stats'))).data.data, 'Failed to load dashboard stats'),
  getUsers: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/users'))).data.data, 'Failed to load users'),
  /**
   * Create a user in the caller's tenant.
   * @param {object} payload {username,email,password,name,role,department,position,workMode,hireDate}
   *   - company_id is intentionally NOT sent: the auth-service pins it from the
   *     authenticated requester (X-User-Context) to prevent cross-tenant injection.
   */
  createUser: async (payload) =>
    executeApiCall(async () => (await api.post(apiUrl('/api/auth/users'), payload)).data, 'Failed to create user'),
  updateUser: async (uid, payload) =>
    executeApiCall(async () => (await api.patch(apiUrl(`/api/admin/users/${uid}`), payload)).data, 'Failed to update user'),
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
  getLeaves: async () =>
    executeApiCall(async () => (await api.get(apiUrl('/api/admin/leaves'))).data.data, 'Failed to load leaves'),
  processLeave: async (id, payload) =>
    executeApiCall(async () => (await api.patch(apiUrl(`/api/admin/leaves/${id}`), payload)).data, 'Failed to process leave request'),
};
