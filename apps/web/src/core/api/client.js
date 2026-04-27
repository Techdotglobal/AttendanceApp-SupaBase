import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { useAuthStore } from '../../features/auth/store/authStore';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

api.interceptors.request.use((config) => {
  const user = useAuthStore.getState().user;
  if (user) {
    config.headers['x-user-context'] = JSON.stringify(user);
  }
  return config;
});
