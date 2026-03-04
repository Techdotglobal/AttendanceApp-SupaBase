import { supabase } from '../../../core/config/supabase';

const BUCKET_NAME = 'company-logos';

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
 * Upload logo file to storage and return public URL.
 * Uses versioned filenames (company-{companyId}-{timestamp}.{ext}) to avoid CDN caching issues.
 * Uses ArrayBuffer for reliable binary upload in React Native / Expo.
 * Does NOT use upsert; each upload creates a new file.
 *
 * @param {string} companyId - UUID of company
 * @param {object} file - { uri: string, mimeType?: string, type?: string } from ImagePicker
 * @returns {Promise<string>} Public URL of uploaded file
 */
export async function uploadLogo(companyId, file) {
  // 1. Validate input
  if (!file) {
    const err = new Error('uploadLogo: file is required');
    console.error('[companyService]', err.message);
    throw err;
  }
  if (!file.uri) {
    const err = new Error('uploadLogo: file.uri is required');
    console.error('[companyService]', err.message);
    throw err;
  }
  if (!file.mimeType && !file.type) {
    const err = new Error('uploadLogo: file.mimeType or file.type is required');
    console.error('[companyService]', err.message);
    throw err;
  }

  // 2. Extract extension safely
  let fileExt = (
    file.mimeType?.split('/').pop() ||
    file.type?.split('/').pop() ||
    file.uri.split('.').pop() ||
    'png'
  )
    .toLowerCase()
    .split('?')[0];

  // 3. Normalize
  if (fileExt === 'jpg') fileExt = 'jpeg';

  // 4. Versioned filename (no upsert, no reuse – prevents CDN caching issues)
  const version = Date.now();
  const fileName = `company-${companyId}-${version}.${fileExt}`;
  const contentType = `image/${fileExt}`;

  console.log('[companyService] uploadLogo: starting', {
    fileName,
    fileUri: file.uri,
    contentType,
  });

  // 5. Convert to ArrayBuffer (NOT blob)
  let arrayBuffer;
  try {
    const response = await fetch(file.uri);
    if (!response.ok) {
      throw new Error(`uploadLogo: failed to fetch image URI (status ${response.status})`);
    }
    arrayBuffer = await response.arrayBuffer();
  } catch (e) {
    console.error('[companyService] uploadLogo: fetch/arrayBuffer failed', e?.message || e);
    throw e;
  }

  // Validate arrayBuffer
  if (!arrayBuffer) {
    const err = new Error('uploadLogo: arrayBuffer is null/undefined');
    console.error('[companyService]', err.message);
    throw err;
  }
  const byteLength = arrayBuffer.byteLength ?? 0;
  if (byteLength === 0) {
    const err = new Error('uploadLogo: arrayBuffer.byteLength is 0 (will NOT upload blank file)');
    console.error('[companyService]', err.message);
    throw err;
  }

  console.log('[companyService] uploadLogo:', {
    fileName,
    fileUri: file.uri,
    contentType,
    arrayBufferByteLength: byteLength,
  });

  // 6. Upload (no upsert; new file every time)
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(fileName, arrayBuffer, {
      contentType,
      cacheControl: '3600',
    });

  if (error) {
    console.error('[companyService] uploadLogo error:', error.message);
    throw error;
  }

  // 7. Generate public URL
  const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(data.path);
  const publicUrl = urlData?.publicUrl ?? null;

  // 8. Validate publicUrl exists
  if (!publicUrl) {
    const err = new Error('uploadLogo: failed to generate public URL');
    console.error('[companyService]', err.message);
    throw err;
  }

  console.log('[companyService] uploadLogo success:', {
    fileName: data.path,
    fileUri: file.uri,
    contentType,
    arrayBufferByteLength: byteLength,
    publicUrl,
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
  let logoUrl = null;

  if (file) {
    try {
      logoUrl = await uploadLogo(companyId, file);
    } catch (e) {
      console.error('[companyService] updateCompanyLogo: upload failed, not updating DB', e?.message || e);
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
