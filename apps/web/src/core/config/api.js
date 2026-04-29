const processEnvApiUrl = typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_API_URL : undefined;
const viteApiUrl = import.meta.env.VITE_API_GATEWAY_URL;

const resolvedApiBaseUrl = processEnvApiUrl || viteApiUrl || '';

export const API_BASE_URL = resolvedApiBaseUrl.replace(/\/+$/, '');
export const IS_API_GATEWAY_CONFIGURED = Boolean(API_BASE_URL);
export const IS_API_GATEWAY_LOCAL =
  /localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168/i.test(API_BASE_URL);

if (import.meta.env.DEV) {
  // Debug visibility for environment issues in development.
  console.log('[api-config] API_BASE_URL:', API_BASE_URL || '<missing>');
}
