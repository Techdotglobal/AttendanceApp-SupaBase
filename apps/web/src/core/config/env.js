const rawApiBaseUrl = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:3000';
export const API_BASE_URL = rawApiBaseUrl.replace(/\/+$/, '');
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
