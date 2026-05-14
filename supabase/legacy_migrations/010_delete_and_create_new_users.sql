-- ============================================
-- Delete All Users and Create New Users
-- ============================================
-- This script deletes all existing users and creates new users
-- based on the list provided in new_users.txt
-- 
-- IMPORTANT: Before running this script:
-- 1. Create users in Supabase Auth first for each user
-- 2. Replace 'REPLACE_WITH_AUTH_ID' with actual Supabase Auth User IDs
-- 3. Or use a script that creates Auth users and gets their UIDs automatically
-- ============================================

-- ============================================
-- DELETE ALL EXISTING USERS
-- ============================================
-- WARNING: This will delete ALL users from the users table
-- Make sure you have backups if needed
--
-- Note: This will NOT delete related records in:
-- - attendance_records (uses user_uid which references auth.uid(), not users table)
-- - leave_requests (uses employee_uid which references auth.uid(), not users table)
-- - tickets (uses created_by_uid which references auth.uid(), not users table)
-- - calendar_events (uses created_by_uid which references auth.uid(), not users table)
--
-- If you want to clean up related data, you can optionally run:
-- DELETE FROM attendance_records;
-- DELETE FROM leave_requests;
-- DELETE FROM tickets;
-- DELETE FROM calendar_events;
-- (Uncomment the lines above if you want to delete related data)

DELETE FROM users;

-- ============================================
-- CREATE NEW USERS
-- ============================================

-- ============================================
-- SUPER ADMIN
-- ============================================
INSERT INTO users (uid, username, email, name, role, department, position, work_mode, hire_date, is_active)
VALUES (
  'REPLACE_WITH_AUTH_ID',  -- Replace with Supabase Auth User ID for hammad.bakhtiar
  'hammad.bakhtiar',
  'hammad.bakhtiar@company.com',
  'Hammad Bakhtiar',
  'super_admin',
  'Management',
  'Super Admin',
  'in_office',
  '2024-01-01',
  true
);

-- ============================================
-- MANAGERS
-- ============================================
INSERT INTO users (uid, username, email, name, role, department, position, work_mode, hire_date, is_active)
VALUES 
  -- Engineering Manager
  ('REPLACE_WITH_AUTH_ID', 'abdullah.bin.ali', 'abdullah.bin.ali@company.com', 'Abdullah Bin Ali', 'manager', 'Engineering', 'Engineering Manager', 'in_office', '2024-01-15', true),
  
  -- Technical Manager (Technical department - separate from Engineering)
  ('REPLACE_WITH_AUTH_ID', 'abdul.rehman.batt', 'abdul.rehman.batt@company.com', 'Abdul Rehman Batt', 'manager', 'Technical', 'Technical Manager', 'in_office', '2024-01-20', true),
  
  -- Sales Manager
  ('REPLACE_WITH_AUTH_ID', 'bilawal.cheema', 'bilawal.cheema@company.com', 'Bilawal Cheema', 'manager', 'Sales', 'Sales Manager', 'in_office', '2024-01-25', true),
  
  -- HR Manager
  ('REPLACE_WITH_AUTH_ID', 'moiz.kazi', 'moiz.kazi@company.com', 'Moiz Kazi', 'manager', 'HR', 'HR Manager', 'in_office', '2024-01-30', true),
  
  -- Finance Manager
  ('REPLACE_WITH_AUTH_ID', 'balaj.nadeem.kiani', 'balaj.nadeem.kiani@company.com', 'Balaj Nadeem Kiani', 'manager', 'Finance', 'Finance Manager', 'in_office', '2024-02-01', true);

-- ============================================
-- EMPLOYEES
-- ============================================
INSERT INTO users (uid, username, email, name, role, department, position, work_mode, hire_date, is_active)
VALUES 
  -- Engineering Department (under Engineering Manager)
  ('REPLACE_WITH_AUTH_ID', 'hasnain.ibrar', 'hasnain.ibrar@company.com', 'Hasnain Ibrar', 'employee', 'Engineering', 'Associate Engineer', 'in_office', '2024-02-10', true),
  
  -- Technical Department (under Technical Manager - separate from Engineering)
  ('REPLACE_WITH_AUTH_ID', 'abdullah.bin.umar', 'abdullah.bin.umar@company.com', 'Abdullah Bin Umar', 'employee', 'Technical', 'Senior Technical Associate', 'in_office', '2024-02-15', true),
  ('REPLACE_WITH_AUTH_ID', 'samad.kiani', 'samad.kiani@company.com', 'Samad Kiani', 'employee', 'Technical', 'Technical Associate', 'in_office', '2024-02-20', true),
  
  -- Sales Department
  ('REPLACE_WITH_AUTH_ID', 'zidane.asghar', 'zidane.asghar@company.com', 'Zidane Asghar', 'employee', 'Sales', 'Sales Associate', 'in_office', '2024-02-25', true);

-- ============================================
-- Verification Queries
-- ============================================
-- Run these after inserting to verify all users were created:

-- View all users by role
SELECT 
  username,
  email,
  name,
  role,
  department,
  position,
  work_mode,
  is_active,
  hire_date
FROM users
ORDER BY 
  CASE role
    WHEN 'super_admin' THEN 1
    WHEN 'manager' THEN 2
    WHEN 'employee' THEN 3
  END,
  department,
  username;

-- Count by role
SELECT role, COUNT(*) as count FROM users GROUP BY role ORDER BY role;

-- Count by department
SELECT department, COUNT(*) as count FROM users GROUP BY department ORDER BY department;

-- List managers and their departments
SELECT username, name, department, position 
FROM users 
WHERE role = 'manager' 
ORDER BY department;

-- List employees by department
SELECT username, name, department, position 
FROM users 
WHERE role = 'employee' 
ORDER BY department, name;

