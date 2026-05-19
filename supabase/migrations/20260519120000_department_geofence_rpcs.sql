-- Department-scoped geofencing: sites table + RPCs for mobile attendance validation.
-- Replaces HR-only company_offices write model with per-department sites for all managers.

-- One primary site per department.
DELETE FROM public.sites s
WHERE s.id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY created_at DESC NULLS LAST, id DESC) AS rn
    FROM public.sites
  ) ranked
  WHERE ranked.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS sites_one_per_department
  ON public.sites (department_id);

-- Read geofence for a department (employees: own dept only; managers: own dept; super_admin: company).
CREATE OR REPLACE FUNCTION public.get_department_geofence(p_department_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  department_id uuid,
  department_name text,
  site_name text,
  latitude double precision,
  longitude double precision,
  radius_meters integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_role text;
  v_caller_department_id uuid;
  v_target_department_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_company_id := public.rls_caller_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'User is not bound to a company.';
  END IF;

  SELECT u.role, u.department_id
  INTO v_role, v_caller_department_id
  FROM public.users u
  WHERE u.uid = auth.uid()::text
    AND COALESCE(u.is_active, false)
  LIMIT 1;

  v_target_department_id := COALESCE(
    p_department_id,
    v_caller_department_id,
    (
      SELECT d.id
      FROM public.departments d
      JOIN public.users u ON u.uid = auth.uid()::text
      WHERE d.company_id = v_company_id
        AND (
          lower(d.normalized_name) = lower(trim(COALESCE(u.department, '')))
          OR lower(d.name) = lower(trim(COALESCE(u.department, '')))
        )
      LIMIT 1
    )
  );

  IF v_target_department_id IS NULL THEN
    RETURN;
  END IF;

  IF v_role = 'super_admin' THEN
    NULL;
  ELSIF v_role = 'manager' THEN
    IF NOT (
      v_caller_department_id = v_target_department_id
      OR EXISTS (
        SELECT 1
        FROM public.departments d
        JOIN public.users u ON u.uid = auth.uid()::text
        WHERE d.id = v_target_department_id
          AND d.company_id = v_company_id
          AND (
            lower(d.normalized_name) = lower(trim(COALESCE(u.department, '')))
            OR lower(d.name) = lower(trim(COALESCE(u.department, '')))
          )
      )
    ) THEN
      RAISE EXCEPTION 'Insufficient permissions to view this department geofence.';
    END IF;
  ELSIF v_role = 'employee' THEN
    IF NOT (
      v_caller_department_id = v_target_department_id
      OR EXISTS (
        SELECT 1
        FROM public.departments d
        JOIN public.users u ON u.uid = auth.uid()::text
        WHERE d.id = v_target_department_id
          AND d.company_id = v_company_id
          AND (
            lower(d.normalized_name) = lower(trim(COALESCE(u.department, '')))
            OR lower(d.name) = lower(trim(COALESCE(u.department, '')))
          )
      )
    ) THEN
      RAISE EXCEPTION 'Insufficient permissions to view this department geofence.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Insufficient permissions.';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.department_id,
    d.name::text AS department_name,
    s.name::text AS site_name,
    s.latitude,
    s.longitude,
    s.radius AS radius_meters,
    s.created_at AS updated_at
  FROM public.sites s
  JOIN public.departments d ON d.id = s.department_id
  WHERE s.department_id = v_target_department_id
    AND s.company_id = v_company_id
  ORDER BY s.created_at DESC
  LIMIT 1;
END;
$$;

-- Upsert department geofence (managers: own department; super_admin: any department in company).
CREATE OR REPLACE FUNCTION public.set_department_geofence(
  p_department_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_radius_meters integer DEFAULT 1000,
  p_site_name text DEFAULT 'Office'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_role text;
  v_caller_department_id uuid;
  v_site_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_department_id IS NULL THEN
    RAISE EXCEPTION 'Department is required.';
  END IF;

  v_company_id := public.rls_caller_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'User is not bound to a company.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = p_department_id AND d.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'Department not found in your company.';
  END IF;

  SELECT u.role, u.department_id
  INTO v_role, v_caller_department_id
  FROM public.users u
  WHERE u.uid = auth.uid()::text
    AND COALESCE(u.is_active, false)
  LIMIT 1;

  IF v_role = 'super_admin' THEN
    NULL;
  ELSIF v_role = 'manager' THEN
    IF NOT (
      v_caller_department_id = p_department_id
      OR EXISTS (
        SELECT 1
        FROM public.departments d
        JOIN public.users u ON u.uid = auth.uid()::text
        WHERE d.id = p_department_id
          AND d.company_id = v_company_id
          AND (
            lower(d.normalized_name) = lower(trim(COALESCE(u.department, '')))
            OR lower(d.name) = lower(trim(COALESCE(u.department, '')))
          )
      )
    ) THEN
      RAISE EXCEPTION 'Insufficient permissions. Managers can only update their own department geofence.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Insufficient permissions.';
  END IF;

  IF p_latitude < -90 OR p_latitude > 90 THEN
    RAISE EXCEPTION 'Latitude must be between -90 and 90';
  END IF;
  IF p_longitude < -180 OR p_longitude > 180 THEN
    RAISE EXCEPTION 'Longitude must be between -180 and 180';
  END IF;
  IF p_radius_meters IS NULL OR p_radius_meters <= 0 THEN
    RAISE EXCEPTION 'Radius must be greater than 0';
  END IF;

  INSERT INTO public.sites (
    company_id,
    department_id,
    name,
    latitude,
    longitude,
    radius
  )
  VALUES (
    v_company_id,
    p_department_id,
    COALESCE(NULLIF(trim(p_site_name), ''), 'Office'),
    p_latitude,
    p_longitude,
    p_radius_meters
  )
  ON CONFLICT (department_id) DO UPDATE
  SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    radius = EXCLUDED.radius,
    name = EXCLUDED.name,
    company_id = EXCLUDED.company_id
  RETURNING id INTO v_site_id;

  RETURN v_site_id;
END;
$$;

-- Allow any department manager to update legacy company office (fallback) — not only HR.
CREATE OR REPLACE FUNCTION public.set_office_location(
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_radius_meters INTEGER DEFAULT 1000
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location_id UUID;
  v_company_id UUID;
  v_username TEXT;
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required. Please log in.';
  END IF;

  SELECT u.company_id, u.username, u.role
  INTO v_company_id, v_username, v_role
  FROM public.users u
  WHERE u.uid = auth.uid()::text
    AND COALESCE(u.is_active, false)
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'User is not bound to a company.';
  END IF;

  IF v_role NOT IN ('super_admin', 'manager') THEN
    RAISE EXCEPTION 'Insufficient permissions. Only managers and super admins can update office location.';
  END IF;

  IF p_latitude < -90 OR p_latitude > 90 THEN
    RAISE EXCEPTION 'Latitude must be between -90 and 90';
  END IF;
  IF p_longitude < -180 OR p_longitude > 180 THEN
    RAISE EXCEPTION 'Longitude must be between -180 and 180';
  END IF;
  IF p_radius_meters <= 0 THEN
    RAISE EXCEPTION 'Radius must be greater than 0';
  END IF;

  INSERT INTO public.company_offices (
    company_id,
    name,
    latitude,
    longitude,
    radius_meters,
    updated_by,
    updated_at
  )
  VALUES (
    v_company_id,
    'Office',
    p_latitude,
    p_longitude,
    p_radius_meters,
    v_username,
    now()
  )
  ON CONFLICT (company_id) DO UPDATE
  SET latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      radius_meters = EXCLUDED.radius_meters,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  RETURNING id INTO v_location_id;

  RETURN v_location_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_department_geofence(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_department_geofence(uuid, double precision, double precision, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_department_geofence(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_department_geofence(uuid, double precision, double precision, integer, text) TO authenticated;
