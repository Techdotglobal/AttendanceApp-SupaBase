-- Phase 5 administrative transaction helpers.
-- Additive only: no historical attendance, leave, workflow, or authorization
-- data is rewritten by this migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.replace_user_department_assignments(
  p_company_id uuid,
  p_user_uid text,
  p_department_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_primary_department_id uuid DEFAULT NULL,
  p_actor_uid text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_actor_company uuid;
  v_requested_count integer;
  v_distinct_count integer;
  v_primary_count integer;
  v_primary_name text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'department assignment replacement is service-role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_user
    FROM public.users
   WHERE uid = p_user_uid
     AND company_id = p_company_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'target user is not in the requested company'; END IF;
  IF v_user.role = 'super_admin' THEN RAISE EXCEPTION 'super-admin department assignments are protected'; END IF;
  IF v_user.is_active IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'inactive users cannot receive department assignments'; END IF;

  IF p_actor_uid IS NOT NULL THEN
    SELECT company_id INTO v_actor_company FROM public.users WHERE uid = p_actor_uid;
    IF v_actor_company IS DISTINCT FROM p_company_id THEN
      RAISE EXCEPTION 'assignment actor must belong to the target company';
    END IF;
  END IF;

  v_requested_count := COALESCE(array_length(p_department_ids, 1), 0);
  SELECT count(DISTINCT department_id), count(*)
    INTO v_distinct_count, v_requested_count
    FROM unnest(COALESCE(p_department_ids, ARRAY[]::uuid[])) AS ids(department_id);
  IF EXISTS (
    SELECT 1
      FROM unnest(COALESCE(p_department_ids, ARRAY[]::uuid[])) AS ids(department_id)
     WHERE ids.department_id IS NULL
  ) THEN
    RAISE EXCEPTION 'department assignments cannot contain NULL identifiers';
  END IF;
  IF v_requested_count <> v_distinct_count THEN
    RAISE EXCEPTION 'duplicate department assignments are not allowed';
  END IF;

  IF p_primary_department_id IS NOT NULL
     AND NOT (p_primary_department_id = ANY(COALESCE(p_department_ids, ARRAY[]::uuid[]))) THEN
    RAISE EXCEPTION 'primary department must be assigned';
  END IF;
  IF v_requested_count = 0 AND p_primary_department_id IS NOT NULL THEN
    RAISE EXCEPTION 'an empty assignment cannot have a primary department';
  END IF;

  SELECT count(*) INTO v_primary_count
    FROM public.departments d
   WHERE d.company_id = p_company_id
     AND d.id = ANY(COALESCE(p_department_ids, ARRAY[]::uuid[]));
  IF v_primary_count <> v_requested_count THEN
    RAISE EXCEPTION 'all assigned departments must belong to the target company';
  END IF;

  DELETE FROM public.user_department_assignments
   WHERE company_id = p_company_id AND user_uid = p_user_uid;

  INSERT INTO public.user_department_assignments
    (company_id, user_uid, department_id, is_primary, is_active, assigned_by_uid)
  SELECT p_company_id, p_user_uid, ids.department_id,
         ids.department_id = p_primary_department_id, true, p_actor_uid
    FROM unnest(COALESCE(p_department_ids, ARRAY[]::uuid[])) AS ids(department_id);

  SELECT name INTO v_primary_name FROM public.departments
   WHERE id = p_primary_department_id AND company_id = p_company_id;
  UPDATE public.users
     SET department_id = p_primary_department_id,
         department = v_primary_name,
         updated_at = now()
   WHERE uid = p_user_uid AND company_id = p_company_id;

  RETURN jsonb_build_object(
    'user_uid', p_user_uid,
    'company_id', p_company_id,
    'department_ids', COALESCE(to_jsonb(p_department_ids), '[]'::jsonb),
    'primary_department_id', p_primary_department_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_approval_workflow_with_steps(
  p_company_id uuid,
  p_request_type text,
  p_name text,
  p_department_id uuid,
  p_is_active boolean,
  p_version integer,
  p_steps jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workflow_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'workflow creation is service-role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(COALESCE(p_steps, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_steps, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'workflow must contain at least one step';
  END IF;
  IF p_department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments
     WHERE id = p_department_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'workflow department is not in the requested company';
  END IF;

  INSERT INTO public.approval_workflows
    (company_id, request_type, name, department_id, is_active, version)
  VALUES
    (p_company_id, p_request_type, COALESCE(NULLIF(p_name, ''), p_request_type),
     p_department_id, COALESCE(p_is_active, true), COALESCE(p_version, 1))
  RETURNING id INTO v_workflow_id;

  INSERT INTO public.approval_workflow_steps (
    workflow_id, step_order, step_label, approver_role, authority_type,
    organization_role_id, required_permission_key, required_scope_type,
    department_id, approval_department_id, workflow_version
  )
  SELECT v_workflow_id, step_order, step_label, approver_role, authority_type,
         organization_role_id, required_permission_key, required_scope_type,
         department_id, approval_department_id, COALESCE(p_version, 1)
    FROM jsonb_to_recordset(p_steps) AS s(
      step_order integer,
      step_label text,
      approver_role text,
      authority_type text,
      organization_role_id uuid,
      required_permission_key text,
      required_scope_type text,
      department_id uuid,
      approval_department_id uuid
    );

  RETURN jsonb_build_object('id', v_workflow_id, 'version', COALESCE(p_version, 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_approval_workflow_steps(
  p_company_id uuid,
  p_workflow_id uuid,
  p_request_type text,
  p_name text,
  p_is_active boolean,
  p_version integer,
  p_steps jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workflow public.approval_workflows%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'workflow replacement is service-role only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_workflow
    FROM public.approval_workflows
   WHERE id = p_workflow_id
     AND company_id = p_company_id
     AND request_type = p_request_type
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow is not in the requested company'; END IF;
  IF jsonb_typeof(COALESCE(p_steps, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_steps, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'workflow must contain at least one step';
  END IF;

  UPDATE public.approval_workflows
     SET name = COALESCE(NULLIF(p_name, ''), name),
         is_active = COALESCE(p_is_active, is_active),
         version = p_version,
         updated_at = now()
   WHERE id = p_workflow_id;

  DELETE FROM public.approval_workflow_steps WHERE workflow_id = p_workflow_id;
  INSERT INTO public.approval_workflow_steps (
    workflow_id, step_order, step_label, approver_role, authority_type,
    organization_role_id, required_permission_key, required_scope_type,
    department_id, approval_department_id, workflow_version
  )
  SELECT p_workflow_id, step_order, step_label, approver_role, authority_type,
         organization_role_id, required_permission_key, required_scope_type,
         department_id, approval_department_id, p_version
    FROM jsonb_to_recordset(p_steps) AS s(
      step_order integer,
      step_label text,
      approver_role text,
      authority_type text,
      organization_role_id uuid,
      required_permission_key text,
      required_scope_type text,
      department_id uuid,
      approval_department_id uuid
    );

  RETURN jsonb_build_object('id', p_workflow_id, 'version', p_version);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_user_department_assignments(uuid, text, uuid[], uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_department_assignments(uuid, text, uuid[], uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.create_approval_workflow_with_steps(uuid, text, text, uuid, boolean, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_approval_workflow_with_steps(uuid, text, text, uuid, boolean, integer, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.replace_approval_workflow_steps(uuid, uuid, text, text, boolean, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_approval_workflow_steps(uuid, uuid, text, text, boolean, integer, jsonb)
  TO service_role;

COMMIT;
