-- ============================================
-- Update UID Column to Match Supabase Auth User IDs
-- ============================================
-- This script updates the uid column in the users table
-- to match the Supabase Auth user IDs
--
-- IMPORTANT: Before running this script:
-- 1. Go to Supabase Dashboard → Authentication → Users
-- 2. Copy the User ID (UID) for each user
-- 3. Replace the UUIDs below with the actual Supabase Auth User IDs
-- 4. Match each UUID to the correct email
-- ============================================

BEGIN;

-- ============================================
-- UPDATE UIDs FOR EACH USER
-- ============================================
-- Replace 'REPLACE_WITH_AUTH_UID' with actual Supabase Auth User IDs
-- Match each UPDATE statement to the correct user by email

-- Example format:
-- UPDATE users 
-- SET uid = 'REPLACE_WITH_AUTH_UID'
-- WHERE email = 'user@company.com';

-- ============================================
-- SUPER ADMIN
-- ============================================
UPDATE users 
SET uid = 'REPLACE_WITH_AUTH_UID'
WHERE email = 'hammad.bakhtiar@company.com';

-- ============================================
-- MANAGERS
-- ============================================
UPDATE users 
SET uid = 'REPLACE_WITH_AUTH_UID'
WHERE email = 'abdullah.bin.ali@company.com';

UPDATE users 
SET uid = 'REPLACE_WITH_AUTH_UID'
WHERE email = 'abdul.rehman.batt@company.com';

UPDATE users 
SET uid = 'REPLACE_WITH_AUTH_UID'
WHERE email = 'bilawal.cheema@company.com';

UPDATE users 
SET uid = 'REPLACE_WITH_AUTH_UID'
WHERE email = 'moiz.kazi@company.com';

UPDATE users 
SET uid = 'REPLACE_WITH_AUTH_UID'
WHERE email = 'balaj.nadeem.kiani@company.com';

-- ============================================
-- EMPLOYEES
-- ============================================
UPDATE users 
SET uid = 'REPLACE_WITH_AUTH_UID'
WHERE email = 'hasnain.ibrar@company.com';

UPDATE users 
SET uid = 'REPLACE_WITH_AUTH_UID'
WHERE email = 'abdullah.bin.umar@company.com';

UPDATE users 
SET uid = 'REPLACE_WITH_AUTH_UID'
WHERE email = 'samad.kiani@company.com';

UPDATE users 
SET uid = 'REPLACE_WITH_AUTH_UID'
WHERE email = 'zidane.asghar@company.com';

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check for users with missing UIDs
SELECT 
  'Users with missing UIDs:' as check_type,
  username,
  email,
  uid
FROM users
WHERE uid IS NULL;

-- Check for users with invalid UID format
SELECT 
  'Users with invalid UID format:' as check_type,
  username,
  email,
  uid,
  LENGTH(uid::text) as uid_length
FROM users
WHERE uid IS NOT NULL 
  AND LENGTH(uid::text) != 36;

-- Summary: Total users vs users with UIDs
SELECT 
  'Summary:' as check_type,
  COUNT(*) as total_users,
  COUNT(uid) as users_with_uid,
  COUNT(*) - COUNT(uid) as missing_uid
FROM users;

-- List all users with their UIDs
SELECT 
  'All users:' as check_type,
  username,
  email,
  uid,
  role,
  department,
  CASE 
    WHEN uid IS NULL THEN '❌ Missing UID'
    WHEN LENGTH(uid::text) != 36 THEN '❌ Invalid UID format'
    ELSE '✓ OK'
  END as status
FROM users
ORDER BY username;

COMMIT;

-- ============================================
-- NOTES
-- ============================================
-- After running this script:
-- 1. Verify all users have valid UIDs (check the verification queries above)
-- 2. Test login with a few users to ensure authentication works
-- 3. Check application logs for any errors
-- 4. If you have more users, add UPDATE statements for each one

