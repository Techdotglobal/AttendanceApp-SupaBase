import { api } from '../../../core/api/client';

export const adminService = {
  getStats: async () => (await api.get('/api/admin/dashboard/stats')).data.data,
  getUsers: async () => (await api.get('/api/admin/users')).data.data,
  updateUser: async (uid, payload) => (await api.patch(`/api/admin/users/${uid}`, payload)).data,
  getDepartments: async () => (await api.get('/api/admin/departments')).data.data,
  getDepartmentsOverview: async () => (await api.get('/api/admin/departments/overview')).data.data,
  createDepartment: async (payload) => (await api.post('/api/admin/departments', payload)).data,
  renameDepartment: async (id, payload) => (await api.patch(`/api/admin/departments/${id}`, payload)).data,
  deleteDepartment: async (id) => (await api.delete(`/api/admin/departments/${id}`)).data,
  getSites: async () => (await api.get('/api/admin/sites')).data.data,
  createSite: async (payload) => (await api.post('/api/admin/sites', payload)).data,
  assignEmployeeSite: async (payload) => (await api.post('/api/admin/employee-sites', payload)).data,
  getAttendance: async () => (await api.get('/api/admin/attendance')).data.data,
  getLeaves: async () => (await api.get('/api/admin/leaves')).data.data,
  processLeave: async (id, payload) => (await api.patch(`/api/admin/leaves/${id}`, payload)).data,
};
