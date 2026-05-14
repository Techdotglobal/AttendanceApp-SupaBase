-- ============================================
-- Enable RLS for Departments / Sites / Employee Sites
-- Migration: 022
-- ============================================

-- -----------------------------
-- Departments
-- -----------------------------
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_super_admin_select" ON departments;
CREATE POLICY "departments_super_admin_select"
ON departments
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
);

DROP POLICY IF EXISTS "departments_manager_select_own" ON departments;
CREATE POLICY "departments_manager_select_own"
ON departments
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'manager'
      AND u.is_active = true
      AND (
        u.department_id = departments.id
        OR u.department = departments.name
      )
  )
);

DROP POLICY IF EXISTS "departments_super_admin_insert" ON departments;
CREATE POLICY "departments_super_admin_insert"
ON departments
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
);

DROP POLICY IF EXISTS "departments_super_admin_update" ON departments;
CREATE POLICY "departments_super_admin_update"
ON departments
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
);

DROP POLICY IF EXISTS "departments_super_admin_delete" ON departments;
CREATE POLICY "departments_super_admin_delete"
ON departments
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
);

-- -----------------------------
-- Sites
-- -----------------------------
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sites_super_admin_select" ON sites;
CREATE POLICY "sites_super_admin_select"
ON sites
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
);

DROP POLICY IF EXISTS "sites_manager_select_own_department" ON sites;
CREATE POLICY "sites_manager_select_own_department"
ON sites
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'manager'
      AND u.is_active = true
      AND (
        u.department_id = sites.department_id
        OR EXISTS (
          SELECT 1
          FROM departments d
          WHERE d.id = sites.department_id
            AND d.name = u.department
        )
      )
  )
);

DROP POLICY IF EXISTS "sites_super_admin_insert" ON sites;
CREATE POLICY "sites_super_admin_insert"
ON sites
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
);

DROP POLICY IF EXISTS "sites_manager_insert_own_department" ON sites;
CREATE POLICY "sites_manager_insert_own_department"
ON sites
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'manager'
      AND u.is_active = true
      AND (
        u.department_id = sites.department_id
        OR EXISTS (
          SELECT 1
          FROM departments d
          WHERE d.id = sites.department_id
            AND d.name = u.department
        )
      )
  )
);

DROP POLICY IF EXISTS "sites_super_admin_update" ON sites;
CREATE POLICY "sites_super_admin_update"
ON sites
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
);

DROP POLICY IF EXISTS "sites_manager_update_own_department" ON sites;
CREATE POLICY "sites_manager_update_own_department"
ON sites
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'manager'
      AND u.is_active = true
      AND (
        u.department_id = sites.department_id
        OR EXISTS (
          SELECT 1
          FROM departments d
          WHERE d.id = sites.department_id
            AND d.name = u.department
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'manager'
      AND u.is_active = true
      AND (
        u.department_id = sites.department_id
        OR EXISTS (
          SELECT 1
          FROM departments d
          WHERE d.id = sites.department_id
            AND d.name = u.department
        )
      )
  )
);

DROP POLICY IF EXISTS "sites_super_admin_delete" ON sites;
CREATE POLICY "sites_super_admin_delete"
ON sites
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
);

DROP POLICY IF EXISTS "sites_manager_delete_own_department" ON sites;
CREATE POLICY "sites_manager_delete_own_department"
ON sites
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'manager'
      AND u.is_active = true
      AND (
        u.department_id = sites.department_id
        OR EXISTS (
          SELECT 1
          FROM departments d
          WHERE d.id = sites.department_id
            AND d.name = u.department
        )
      )
  )
);

-- -----------------------------
-- Employee Sites
-- -----------------------------
ALTER TABLE employee_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_sites_super_admin_select" ON employee_sites;
CREATE POLICY "employee_sites_super_admin_select"
ON employee_sites
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
);

DROP POLICY IF EXISTS "employee_sites_manager_select_own_department" ON employee_sites;
CREATE POLICY "employee_sites_manager_select_own_department"
ON employee_sites
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM users manager
    JOIN users employee ON employee.uid = employee_sites.employee_uid::text
    JOIN sites s ON s.id = employee_sites.site_id
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE manager.uid = auth.uid()::text
      AND manager.role = 'manager'
      AND manager.is_active = true
      AND (
        (manager.department_id IS NOT NULL AND manager.department_id = s.department_id)
        OR (manager.department = d.name)
      )
      AND (
        employee.department_id = s.department_id
        OR employee.department = d.name
      )
  )
);

DROP POLICY IF EXISTS "employee_sites_super_admin_insert" ON employee_sites;
CREATE POLICY "employee_sites_super_admin_insert"
ON employee_sites
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
);

DROP POLICY IF EXISTS "employee_sites_manager_insert_own_department" ON employee_sites;
CREATE POLICY "employee_sites_manager_insert_own_department"
ON employee_sites
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users manager
    JOIN users employee ON employee.uid = employee_sites.employee_uid::text
    JOIN sites s ON s.id = employee_sites.site_id
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE manager.uid = auth.uid()::text
      AND manager.role = 'manager'
      AND manager.is_active = true
      AND (
        (manager.department_id IS NOT NULL AND manager.department_id = s.department_id)
        OR (manager.department = d.name)
      )
      AND (
        employee.department_id = s.department_id
        OR employee.department = d.name
      )
  )
);

DROP POLICY IF EXISTS "employee_sites_super_admin_update" ON employee_sites;
CREATE POLICY "employee_sites_super_admin_update"
ON employee_sites
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
);

DROP POLICY IF EXISTS "employee_sites_manager_update_own_department" ON employee_sites;
CREATE POLICY "employee_sites_manager_update_own_department"
ON employee_sites
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM users manager
    JOIN users employee ON employee.uid = employee_sites.employee_uid::text
    JOIN sites s ON s.id = employee_sites.site_id
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE manager.uid = auth.uid()::text
      AND manager.role = 'manager'
      AND manager.is_active = true
      AND (
        (manager.department_id IS NOT NULL AND manager.department_id = s.department_id)
        OR (manager.department = d.name)
      )
      AND (
        employee.department_id = s.department_id
        OR employee.department = d.name
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users manager
    JOIN users employee ON employee.uid = employee_sites.employee_uid::text
    JOIN sites s ON s.id = employee_sites.site_id
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE manager.uid = auth.uid()::text
      AND manager.role = 'manager'
      AND manager.is_active = true
      AND (
        (manager.department_id IS NOT NULL AND manager.department_id = s.department_id)
        OR (manager.department = d.name)
      )
      AND (
        employee.department_id = s.department_id
        OR employee.department = d.name
      )
  )
);

DROP POLICY IF EXISTS "employee_sites_super_admin_delete" ON employee_sites;
CREATE POLICY "employee_sites_super_admin_delete"
ON employee_sites
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.uid = auth.uid()::text
      AND u.role = 'super_admin'
      AND u.is_active = true
  )
);

DROP POLICY IF EXISTS "employee_sites_manager_delete_own_department" ON employee_sites;
CREATE POLICY "employee_sites_manager_delete_own_department"
ON employee_sites
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM users manager
    JOIN users employee ON employee.uid = employee_sites.employee_uid::text
    JOIN sites s ON s.id = employee_sites.site_id
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE manager.uid = auth.uid()::text
      AND manager.role = 'manager'
      AND manager.is_active = true
      AND (
        (manager.department_id IS NOT NULL AND manager.department_id = s.department_id)
        OR (manager.department = d.name)
      )
      AND (
        employee.department_id = s.department_id
        OR employee.department = d.name
      )
  )
);
