-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.attendance_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  config_key character varying NOT NULL UNIQUE,
  config_value jsonb NOT NULL,
  description text,
  updated_by character varying,
  updated_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  singleton integer NOT NULL DEFAULT 1,
  CONSTRAINT attendance_config_pkey PRIMARY KEY (id)
);
CREATE TABLE public.attendance_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_uid uuid NOT NULL,
  username character varying NOT NULL,
  employee_name character varying,
  type character varying NOT NULL,
  timestamp timestamp with time zone NOT NULL DEFAULT now(),
  location jsonb,
  photo text,
  auth_method character varying,
  is_manual boolean DEFAULT false,
  created_by character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  updated_by character varying,
  location_id uuid,
  company_id uuid,
  CONSTRAINT attendance_records_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
  CONSTRAINT attendance_records_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id)
);
CREATE TABLE public.calendar_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title character varying NOT NULL,
  description text,
  date date NOT NULL,
  time time without time zone,
  type character varying DEFAULT 'other'::character varying,
  color character varying DEFAULT '#3b82f6'::character varying,
  created_by_uid uuid,
  created_by character varying,
  assigned_to jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  visibility character varying DEFAULT 'all'::character varying CHECK (visibility::text = ANY (ARRAY['all'::character varying, 'none'::character varying, 'selected'::character varying]::text[])),
  visible_to jsonb DEFAULT '[]'::jsonb,
  company_id uuid,
  CONSTRAINT calendar_events_pkey PRIMARY KEY (id),
  CONSTRAINT calendar_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.companies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT companies_pkey PRIMARY KEY (id)
);
CREATE TABLE public.company_offices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  radius_meters integer DEFAULT 100,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT company_offices_pkey PRIMARY KEY (id),
  CONSTRAINT company_offices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.departments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  company_id uuid NOT NULL,
  normalized_name text NOT NULL,
  CONSTRAINT departments_pkey PRIMARY KEY (id),
  CONSTRAINT departments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.employee_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  location_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT employee_locations_pkey PRIMARY KEY (id),
  CONSTRAINT employee_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id)
);
CREATE TABLE public.employee_sites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_uid uuid NOT NULL,
  site_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT employee_sites_pkey PRIMARY KEY (id),
  CONSTRAINT employee_sites_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id)
);
CREATE TABLE public.leave_balances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_uid uuid NOT NULL UNIQUE,
  company_id uuid NOT NULL,
  annual_leaves integer NOT NULL DEFAULT 20,
  sick_leaves integer NOT NULL DEFAULT 10,
  casual_leaves integer NOT NULL DEFAULT 5,
  is_custom boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT leave_balances_pkey PRIMARY KEY (id),
  CONSTRAINT leave_balances_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.leave_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_uid uuid NOT NULL,
  employee_id character varying NOT NULL,
  leave_type character varying NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days numeric NOT NULL,
  is_half_day boolean DEFAULT false,
  half_day_period character varying,
  reason text,
  category character varying,
  status character varying DEFAULT 'pending'::character varying,
  assigned_to character varying,
  requested_at timestamp with time zone DEFAULT now(),
  processed_at timestamp with time zone,
  processed_by character varying,
  admin_notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  company_id uuid,
  CONSTRAINT leave_requests_pkey PRIMARY KEY (id),
  CONSTRAINT leave_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.leave_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE,
  default_annual_leaves integer NOT NULL DEFAULT 20,
  default_sick_leaves integer NOT NULL DEFAULT 10,
  default_casual_leaves integer NOT NULL DEFAULT 5,
  leave_year_start character varying NOT NULL DEFAULT '01-01'::character varying,
  leave_year_end character varying NOT NULL DEFAULT '12-31'::character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT leave_settings_pkey PRIMARY KEY (id),
  CONSTRAINT leave_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.locations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  name text NOT NULL,
  latitude double precision NOT NULL CHECK (latitude >= '-90'::integer::double precision AND latitude <= 90::double precision),
  longitude double precision NOT NULL CHECK (longitude >= '-180'::integer::double precision AND longitude <= 180::double precision),
  radius integer NOT NULL DEFAULT 100 CHECK (radius > 0),
  address text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT locations_pkey PRIMARY KEY (id),
  CONSTRAINT locations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recipient_uid uuid NOT NULL,
  recipient_username character varying,
  title text NOT NULL,
  body text NOT NULL,
  type character varying DEFAULT 'general'::character varying,
  data jsonb DEFAULT '{}'::jsonb,
  read boolean DEFAULT false,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  company_id uuid,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.signup_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  username character varying NOT NULL UNIQUE,
  password text NOT NULL,
  name character varying NOT NULL,
  email character varying NOT NULL,
  role character varying DEFAULT 'employee'::character varying,
  status character varying DEFAULT 'pending'::character varying,
  requested_at timestamp with time zone DEFAULT now(),
  approved_at timestamp with time zone,
  approved_by character varying,
  rejection_reason text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT signup_requests_pkey PRIMARY KEY (id)
);
CREATE TABLE public.sites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  radius integer NOT NULL CHECK (radius > 0),
  department_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  company_id uuid,
  CONSTRAINT sites_pkey PRIMARY KEY (id),
  CONSTRAINT sites_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id),
  CONSTRAINT sites_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by_uid uuid NOT NULL,
  created_by character varying NOT NULL,
  category character varying NOT NULL,
  priority character varying NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  status character varying DEFAULT 'open'::character varying,
  assigned_to character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  resolved_at timestamp with time zone,
  closed_at timestamp with time zone,
  responses jsonb DEFAULT '[]'::jsonb,
  company_id uuid,
  CONSTRAINT tickets_pkey PRIMARY KEY (id),
  CONSTRAINT tickets_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  uid text NOT NULL UNIQUE,
  username text NOT NULL,
  email text NOT NULL UNIQUE,
  name text,
  role text NOT NULL DEFAULT 'employee'::text,
  department text,
  position text,
  work_mode text DEFAULT 'in_office'::text CHECK (work_mode = ANY (ARRAY['in_office'::text, 'semi_remote'::text, 'fully_remote'::text])),
  hire_date date,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  department_id uuid,
  company_id uuid NOT NULL,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id),
  CONSTRAINT users_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);