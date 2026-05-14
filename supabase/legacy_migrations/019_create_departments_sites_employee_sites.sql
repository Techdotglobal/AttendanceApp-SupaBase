CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius INTEGER NOT NULL CHECK (radius > 0),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_uid UUID NOT NULL,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_uid, site_id)
);

CREATE INDEX IF NOT EXISTS idx_sites_department_id ON sites(department_id);
CREATE INDEX IF NOT EXISTS idx_employee_sites_employee_uid ON employee_sites(employee_uid);
CREATE INDEX IF NOT EXISTS idx_employee_sites_site_id ON employee_sites(site_id);
