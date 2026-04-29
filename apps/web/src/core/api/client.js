import axios from 'axios';
import { apiUrl, IS_API_GATEWAY_CONFIGURED, IS_API_GATEWAY_LOCAL } from '../config/api';
import { useAuthStore } from '../../features/auth/store/authStore';

export const api = axios.create({
  timeout: 10000,
});

api.interceptors.request.use((config) => {
  if (!IS_API_GATEWAY_CONFIGURED) {
    console.error('[api] API base URL is missing. Set VITE_API_GATEWAY_URL or NEXT_PUBLIC_API_URL on Vercel.');
    throw new Error('Service configuration is missing. Please try again later.');
  }

  if (IS_API_GATEWAY_LOCAL && !import.meta.env.DEV) {
    console.error('[api] Local API URL detected in non-development environment.');
    throw new Error('Service endpoint is not publicly reachable. Please contact support.');
  }

  if (config.url && !/^https?:\/\//i.test(String(config.url))) {
    const full = apiUrl(config.url);
    if (import.meta.env.DEV) {
      console.log('[api] request:', (config.method || 'get').toUpperCase(), full);
    }
    config.url = full;
  }

  const user = useAuthStore.getState().user;
  if (user) {
    config.headers['x-user-context'] = JSON.stringify(user);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const endpoint = error?.config?.url || 'unknown-endpoint';
    const payload = error?.response?.data;
    console.error('[api] Request failed:', { endpoint, status, payload, message: error?.message });
    return Promise.reject(error);
  }
);
