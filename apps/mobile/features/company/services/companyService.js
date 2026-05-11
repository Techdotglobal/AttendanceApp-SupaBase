import { supabase } from '../../../core/config/supabase';

const BUCKET_NAME = 'company-logos';

/** UUID pattern — storage object prefix must be the company id only (no path segments). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

const ALLOWED_LOGO_EXT = new Set(Object.values(MIME_TO_EXT));

/**
 * @param {string} companyId
 * @returns {void}
 */
function assertValidCompanyId(companyId) {
  if (companyId == null || String(companyId).trim() === '') {
    const err = new Error('Company ID is required');
    console.error('[companyService]', err.message);
    throw err;
  }
  const id = String(companyId).trim();
  if (!UUID_REGEX.test(id)) {
    const err = new Error('Invalid company ID format');
    console.error('[companyService]', err.message, { companyId: id });
    throw err;
  }
}

/**
 * Resolve a safe file extension for `logo.{ext}` from picker asset (mime, type, or URI).
 * @param {object} file
 * @returns {string} lowercase extension without dot
 */
function resolveLogoFileExtension(file) {
  const mimeRaw = (file.mimeType || file.type || '').trim().toLowerCase();
  const mime = mimeRaw.split(';')[0].trim();

  if (mime && MIME_TO_EXT[mime]) {
    return MIME_TO_EXT[mime];
  }
  if (mime && mime.startsWith('image/')) {
    const sub = mime.split('/')[1]?.split('+')[0];
    if (sub === 'jpg') return 'jpeg';
    if (sub && ALLOWED_LOGO_EXT.has(sub)) return sub;
  }

  const uri = file.uri || '';
  const pathPart = uri.split('?')[0] || '';
  const last = pathPart.split('/').pop() || '';
  const fromUri = last.includes('.') ? last.split('.').pop()?.toLowerCase().split('?')[0] : null;
  if (fromUri === 'jpg') return 'jpeg';
  if (fromUri && ALLOWED_LOGO_EXT.has(fromUri)) {
    return fromUri;
  }

  const err = new Error(
    'Invalid image: use PNG, JPEG, WebP, or GIF (HEIC supported where the picker provides type).'
  );
  console.error('[companyService] resolveLogoFileExtension: could not infer extension', {
    mimeType: file.mimeType,
    type: file.type,
    uriSample: uri ? `${uri.slice(0, 80)}…` : null,
  });
  throw err;
}

/**
 * @param {object} error
 * @param {string} context
 */
function logStorageError(error, context) {
  if (!error) return;
  const msg = error.message || String(error);
  const status = error.statusCode ?? error.status;
  const name = error.name;
  console.error(`[companyService] ${context}: Supabase storage error`, {
    message: msg,
    statusCode: status,
    name,
    error,
  });
}

/**
 * Get the single company record (first row).
 * @returns {Promise<{ id: string, name: string, logo_url: string | null, created_at: string, updated_at: string } | null>}
 */
export async function getCompany() {
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, logo_url, created_at, updated_at')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[companyService] getCompany error:', error.message);
    throw error;
  }
  return data;
}

/**
 * Upload company logo to `{companyId}/logo.{ext}` (upsert) and return the public URL.
 * Uses ArrayBuffer for reliable binary upload in React Native / Expo.
 *
 * @param {string} companyId - UUID of company
 * @param {object} file - { uri: string, mimeType?: string, type?: string } from ImagePicker
 * @returns {Promise<string>} Public URL of uploaded file
 */
async function uploadLogoToStorage(companyId, file) {
  assertValidCompanyId(companyId);

  if (!file) {
    const err = new Error('No image selected');
    console.error('[companyService]', err.message);
    throw err;
  }
  if (!file.uri) {
    const err = new Error('Invalid image selection: missing file location');
    console.error('[companyService]', err.message);
    throw err;
  }

  let fileExt;
  try {
    fileExt = resolveLogoFileExtension(file);
  } catch (e) {
    console.error('[companyService] uploadLogoToStorage: invalid image selection', e?.message || e);
    throw e;
  }

  const storagePath = `${companyId}/logo.${fileExt}`;
  const contentType = `image/${fileExt === 'jpeg' ? 'jpeg' : fileExt}`;

  console.log('[companyService] uploadLogoToStorage: starting', {
    storagePath,
    bucket: BUCKET_NAME,
    contentType,
  });

  let arrayBuffer;
  try {
    const response = await fetch(file.uri);
    if (!response.ok) {
      const err = new Error(`Could not read selected image (HTTP ${response.status})`);
      console.error('[companyService] uploadLogoToStorage: fetch failed', {
        status: response.status,
        storagePath,
      });
      throw err;
    }
    arrayBuffer = await response.arrayBuffer();
  } catch (e) {
    if (e.message?.startsWith('Could not read selected image')) throw e;
    console.error('[companyService] uploadLogoToStorage: fetch/arrayBuffer failed', e?.message || e);
    throw new Error('Could not read the selected image. Try another photo or format.');
  }

  if (!arrayBuffer) {
    const err = new Error('Invalid image: empty file');
    console.error('[companyService]', err.message);
    throw err;
  }
  const byteLength = arrayBuffer.byteLength ?? 0;
  if (byteLength === 0) {
    const err = new Error('Invalid image: empty file (will not upload)');
    console.error('[companyService]', err.message);
    throw err;
  }

  console.log('[companyService] uploadLogoToStorage: uploading', {
    storagePath,
    contentType,
    arrayBufferByteLength: byteLength,
  });

  const { data, error } = await supabase.storage.from(BUCKET_NAME).upload(storagePath, arrayBuffer, {
    contentType,
    cacheControl: '3600',
    upsert: true,
  });

  if (error) {
    logStorageError(error, 'uploadLogoToStorage');
    const friendly =
      error.message?.includes('JWT') || error.message?.includes('row-level security')
        ? 'Upload denied. Check you are signed in as a super admin.'
        : error.message || 'Logo upload failed';
    throw new Error(friendly);
  }

  const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(data.path);
  const publicUrl = urlData?.publicUrl ?? null;

  if (!publicUrl) {
    const err = new Error('Could not build public URL for uploaded logo');
    console.error('[companyService]', err.message, { path: data.path });
    throw err;
  }

  console.log('[companyService] uploadLogoToStorage: success', {
    path: data.path,
    publicUrl,
    arrayBufferByteLength: byteLength,
  });

  return publicUrl;
}

/**
 * Update company logo: upload new file then update companies.logo_url.
 * If upload fails, DB is NOT updated.
 *
 * @param {string} companyId - UUID of company
 * @param {object|null} file - { uri, mimeType?, type? } from ImagePicker, or null to clear logo
 * @returns {Promise<{ logo_url: string | null }>}
 */
export async function updateCompanyLogo(companyId, file) {
  assertValidCompanyId(companyId);

  let logoUrl = null;

  if (file) {
    try {
      logoUrl = await uploadLogoToStorage(companyId, file);
    } catch (e) {
      console.error('[companyService] updateCompanyLogo: upload failed, DB not updated', e?.message || e);
      throw e;
    }
  }

  const { data, error } = await supabase
    .from('companies')
    .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
    .eq('id', companyId)
    .select('logo_url')
    .single();

  if (error) {
    console.error('[companyService] updateCompanyLogo error:', error.message);
    throw error;
  }

  return { logo_url: data.logo_url };
}
