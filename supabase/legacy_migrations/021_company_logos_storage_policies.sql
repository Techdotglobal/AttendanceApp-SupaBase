-- ============================================
-- Storage: company-logos bucket policies
-- ============================================
-- Run this AFTER creating the bucket "company-logos" in Supabase Dashboard (see STORAGE_SETUP.md).
-- Run in Supabase SQL Editor.
-- ============================================

-- ============================================
-- 1. Allow public read (bucket is public; objects readable by anyone)
-- ============================================

DROP POLICY IF EXISTS "Public read access for company logos" ON storage.objects;
CREATE POLICY "Public read access for company logos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'company-logos');

-- ============================================
-- 2. Only super_admin can upload/update/delete in company-logos
-- ============================================

DROP POLICY IF EXISTS "Only super_admin can upload company logos" ON storage.objects;
CREATE POLICY "Only super_admin can upload company logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'company-logos'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE (users.uid::text = auth.uid()::text)
    AND users.role = 'super_admin'
  )
);

DROP POLICY IF EXISTS "Only super_admin can update company logos" ON storage.objects;
CREATE POLICY "Only super_admin can update company logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'company-logos'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE (users.uid::text = auth.uid()::text)
    AND users.role = 'super_admin'
  )
)
WITH CHECK (
  bucket_id = 'company-logos'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE (users.uid::text = auth.uid()::text)
    AND users.role = 'super_admin'
  )
);

DROP POLICY IF EXISTS "Only super_admin can delete company logos" ON storage.objects;
CREATE POLICY "Only super_admin can delete company logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-logos'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE (users.uid::text = auth.uid()::text)
    AND users.role = 'super_admin'
  )
);
