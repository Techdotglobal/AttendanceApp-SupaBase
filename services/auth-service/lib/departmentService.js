const { supabase } = require('../config/supabase');
const { normalizeDepartmentName, toLookupKey } = require('./orgNormalize');

/**
 * List departments for a tenant (ordered by name).
 * @param {string} companyId
 * @returns {Promise<Array<{ id: string, name: string, company_id: string, created_at?: string }>>}
 */
async function listDepartmentsForCompany(companyId) {
  const { data, error } = await supabase
    .from('departments')
    .select('id, name, company_id, created_at, normalized_name')
    .eq('company_id', companyId)
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }
  return data || [];
}

/**
 * Find department by case-insensitive name within tenant.
 * @param {string} companyId
 * @param {string} rawName
 * @returns {Promise<{ id: string, name: string }|null>}
 */
async function findDepartmentByName(companyId, rawName) {
  const key = toLookupKey(rawName);
  if (!key || !companyId) return null;

  const { data: byKey, error: keyErr } = await supabase
    .from('departments')
    .select('id, name')
    .eq('company_id', companyId)
    .eq('normalized_name', key)
    .maybeSingle();

  if (keyErr) throw keyErr;
  if (byKey) return byKey;

  const display = normalizeDepartmentName(rawName);
  if (!display) return null;

  const { data: byName, error: nameErr } = await supabase
    .from('departments')
    .select('id, name')
    .eq('company_id', companyId)
    .eq('name', display)
    .maybeSingle();

  if (nameErr) throw nameErr;
  return byName || null;
}

/**
 * Find or create a tenant-scoped department (case-insensitive, no duplicates).
 * @param {string} companyId
 * @param {string} rawName
 * @returns {Promise<{ id: string, name: string, created: boolean }|null>}
 */
async function ensureDepartmentForCompany(companyId, rawName) {
  const displayName = normalizeDepartmentName(rawName);
  const key = toLookupKey(rawName);
  if (!displayName || !key || !companyId) return null;

  const existing = await findDepartmentByName(companyId, rawName);
  if (existing) {
    return { id: existing.id, name: existing.name, created: false };
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('departments')
    .insert({
      name: displayName,
      normalized_name: key,
      company_id: companyId,
    })
    .select('id, name')
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      const raced = await findDepartmentByName(companyId, rawName);
      if (raced) {
        return { id: raced.id, name: raced.name, created: false };
      }
    }
    throw insertErr;
  }

  return { id: inserted.id, name: inserted.name, created: true };
}

module.exports = {
  listDepartmentsForCompany,
  findDepartmentByName,
  ensureDepartmentForCompany,
};
