import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { adminService } from '../services/adminService';
import { useAuthStore } from '../../auth/store/authStore';
import { Alert } from '../../../shared/components/ui/Alert';
import { Select } from '../../../shared/components/ui/Select';
import { EmptyStateBody } from '../../../shared/components/ui/EmptyState';
import { hasPermission, PERMISSIONS } from '../permissions';
import { useSilentPoll } from '../../../shared/hooks/useSilentPoll';
import { GeofenceMap } from '../components/GeofenceMap';
import { reverseGeocode } from '../utils/geocode';
import {
  acceptBoundedNumber,
  coordinateErrors,
  findDuplicateSiteName,
  isNullIsland,
  MAX_RADIUS_METERS,
  overlappingPartners,
  overlapMap,
  parseLatitude,
  parseLongitude,
  wrapLongitude,
} from '../utils/geofence';
import { PageActions } from '../../../shared/components/pageChrome';

const EMPTY_DRAFT = {
  name: '',
  department_id: '',
  latitude: '',
  longitude: '',
  radius: 150,
  address: '',
  assigneeUids: [],
};

const STEPS = [
  { id: 1, label: 'Details' },
  { id: 2, label: 'Position' },
  { id: 3, label: 'Radius' },
  { id: 4, label: 'People' },
  { id: 5, label: 'Review' },
];


function formatMeters(value) {
  const meters = Number(value);
  if (!Number.isFinite(meters) || meters <= 0) return '-';
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 1)} km`;
  return `${Math.round(meters)} m`;
}

function formatCoord(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(5) : '-';
}


// Not a reverse-geocode — just a display label for the centre point.
function formatCoordinateLabel(lat, lng) {
  return `${formatCoord(lat)}, ${formatCoord(lng)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_RE.test(String(value || '').trim());
}

function personLookupKeys(person) {
  return [person?.uid, person?.id, person?.username, person?.employee_uid, person?.employeeUid]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function resolveDepartmentLabel(person, departmentsById) {
  const named = String(person?.department || person?.employee_department || '').trim();
  if (named && !isUuid(named)) return named;
  return (
    departmentsById.get(String(person?.department_id || person?.employee_department_id || named || '')) ||
    named ||
    ''
  );
}

function displayPersonName(person, fallback) {
  const name = String(person?.name || person?.username || person?.employee_name || person?.employeeName || '').trim();
  if (name && !isUuid(name)) return name;
  const fallbackName = String(fallback || '').trim();
  if (fallbackName && !isUuid(fallbackName)) return fallbackName;
  return 'Unknown person';
}

export function SitesPage() {
  const { user } = useAuthStore();
  const [sites, setSites] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [coordinateLabels, setCoordinateLabels] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [assignEmployeeUid, setAssignEmployeeUid] = useState('');
  const [assignSiteIds, setAssignSiteIds] = useState([]);
  const [assignSaving, setAssignSaving] = useState(false);
  const [siteAssignSaving, setSiteAssignSaving] = useState(false);
  const [focusNonce, setFocusNonce] = useState(0);
  const listRef = useRef(null);

  const canManage = hasPermission(user, PERMISSIONS.MANAGE_GEOFENCING);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError('');
    try {
      const [sitesData, departmentsData, usersData, assignmentData] = await Promise.all([
        adminService.getSites(),
        adminService.getDepartments().catch(() => []),
        adminService.getUsers().catch(() => []),
        canManage ? adminService.getEmployeeSites().catch(() => []) : Promise.resolve([]),
      ]);
      setSites(sitesData || []);
      setDepartments(departmentsData || []);
      setUsers(usersData || []);
      setAssignments(assignmentData || []);
    } catch (err) {
      if (!silent) setError(err?.response?.data?.error || err?.message || 'Failed to load sites');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    load();
  }, [load]);

  useSilentPoll(load, 30000);

  // Seed labels from the stored address (or a coordinate fallback) immediately,
  // then resolve real addresses in the background for sites that don't have
  // one saved yet — sequentially, so we don't burst Nominatim's free API.
  useEffect(() => {
    if (!sites.length) {
      setCoordinateLabels({});
      return undefined;
    }
    setCoordinateLabels((current) => {
      const next = {};
      let changed = false;
      for (const site of sites) {
        const label = site.address || current[site.id] || formatCoordinateLabel(site.latitude, site.longitude);
        next[site.id] = label;
        if (current[site.id] !== label) changed = true;
      }
      if (Object.keys(current).length !== sites.length) changed = true;
      return changed ? next : current;
    });

    let cancelled = false;
    const pending = sites.filter(
      (site) => !site.address && parseLatitude(site.latitude) != null && parseLongitude(site.longitude) != null
    );

    (async () => {
      for (const site of pending) {
        if (cancelled) return;
        // eslint-disable-next-line no-await-in-loop
        const resolved = await reverseGeocode(site.latitude, site.longitude);
        if (cancelled) return;
        setCoordinateLabels((current) => ({ ...current, [site.id]: resolved }));
        const isRealAddress = resolved !== formatCoordinateLabel(site.latitude, site.longitude);
        if (isRealAddress) {
          // Persist so future loads skip the lookup; leave unsaved on failure
          // (resolved === coordinate fallback) so we retry next time instead
          // of caching "no address found" forever.
          adminService.updateSite(site.id, { address: resolved }).catch(() => {
            /* best-effort cache; UI already has the label for this session */
          });
        }
        if (pending.length > 1) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 1100));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sites]);

  const assignableUsers = useMemo(
    () => users.filter((row) => row.role === 'employee' || row.role === 'manager'),
    [users]
  );

  const peopleBySite = useMemo(() => {
    const departmentsById = new Map(departments.map((row) => [String(row.id), row.name]));
    const usersByKey = new Map();
    for (const row of users) {
      for (const key of personLookupKeys(row)) {
        if (!usersByKey.has(key)) usersByKey.set(key, row);
      }
    }
    const map = new Map();
    for (const row of assignments) {
      const siteId = row.site_id;
      if (!map.has(siteId)) map.set(siteId, []);
      const uid = String(row.employee_uid || row.employeeUid || '');
      const person =
        usersByKey.get(uid.toLowerCase()) ||
        usersByKey.get(String(row.employee_username || row.username || '').toLowerCase()) ||
        null;
      const resolved = person || row;
      map.get(siteId).push({
        uid: person?.uid || row.employee_uid,
        name: displayPersonName(resolved, row.employee_name || row.employeeName),
        department: resolveDepartmentLabel(resolved, departmentsById),
      });
    }
    return map;
  }, [assignments, departments, users]);

  const filteredSites = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sites.filter((site) => {
      if (!q) return true;
      const label = coordinateLabels[site.id] || '';
      return `${site.name} ${label}`.toLowerCase().includes(q);
    });
  }, [sites, coordinateLabels, query]);

  const overlapsBySite = useMemo(() => overlapMap(sites), [sites]);
  const overlappingIds = useMemo(() => Array.from(overlapsBySite.keys()), [overlapsBySite]);

  const selected = sites.find((site) => site.id === selectedId) || null;

  // Uniqueness rule mirrors the DB: UNIQUE(company_id, department_id, name).
  const duplicateName = useMemo(
    () =>
      findDuplicateSiteName(sites, draft.name, {
        departmentId: draft.department_id || null,
        ignoreId: editingId,
      }),
    [sites, draft.name, draft.department_id, editingId]
  );
  const nameError = duplicateName
    ? 'An active location with this name already exists in this department.'
    : '';
  const coordErrors = useMemo(
    () => (draft.latitude === '' && draft.longitude === '' ? {} : coordinateErrors(draft.latitude, draft.longitude)),
    [draft.latitude, draft.longitude]
  );

  const mapPreview = useMemo(() => {
    const lat = parseLatitude(draft.latitude);
    const lng = parseLongitude(draft.longitude);
    if (!wizard || lat == null || lng == null) return null;
    const preview = {
      id: 'preview',
      latitude: lat,
      longitude: lng,
      radius: Number(draft.radius) || 150,
      name: draft.name || 'New location',
    };
    return {
      ...preview,
      overlapping: overlappingPartners(sites, preview).length > 0,
    };
  }, [wizard, draft.latitude, draft.longitude, draft.radius, draft.name, sites]);

  const draftOverlapPartners = useMemo(
    () => (mapPreview ? overlappingPartners(sites, mapPreview) : []),
    [sites, mapPreview]
  );

  useEffect(() => {
    if (selectedId && !sites.some((site) => site.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, sites]);

  const fitKey = wizard && mapPreview
    ? `preview:${mapPreview.latitude}:${mapPreview.longitude}:${mapPreview.radius}`
    : selectedId
      ? `site:${selectedId}:${focusNonce}`
      : `all:${sites.map((site) => site.id).join(',')}`;

  const selectSite = (id) => {
    setSelectedId(id);
    setFocusNonce((n) => n + 1);
  };

  const departmentName = (id) => departments.find((row) => String(row.id) === String(id))?.name || '-';

  const startWizard = () => {
    setEditingId(null);
    setWizard(true);
    setStep(1);
    setDraft({
      ...EMPTY_DRAFT,
      department_id: departments[0]?.id || '',
    });
    setNotice('');
    setError('');
  };

  const startEdit = (site) => {
    if (!site) return;
    setEditingId(site.id);
    setWizard(true);
    setStep(1);
    setDraft({
      name: site.name || '',
      department_id: site.department_id ? String(site.department_id) : '',
      latitude: site.latitude != null ? String(site.latitude) : '',
      longitude: site.longitude != null ? String(site.longitude) : '',
      radius: Number(site.radius) || EMPTY_DRAFT.radius,
      address: site.address || '',
      assigneeUids: [],
    });
    setNotice('');
    setError('');
  };

  const closeWizard = () => {
    setWizard(false);
    setEditingId(null);
    setStep(1);
    setDraft(EMPTY_DRAFT);
    setCreating(false);
  };

  const canAdvance = () => {
    if (step === 1) return Boolean(draft.name.trim() && draft.department_id && !nameError);
    if (step === 2) {
      return (
        parseLatitude(draft.latitude) != null &&
        parseLongitude(draft.longitude) != null &&
        !isNullIsland(draft.latitude, draft.longitude)
      );
    }
    if (step === 3) return Number(draft.radius) > 0 && Number(draft.radius) <= MAX_RADIUS_METERS;
    if (step === 5) {
      return (
        Boolean(draft.name.trim() && draft.department_id && !nameError) &&
        parseLatitude(draft.latitude) != null &&
        parseLongitude(draft.longitude) != null &&
        !isNullIsland(draft.latitude, draft.longitude) &&
        Number(draft.radius) > 0 &&
        Number(draft.radius) <= MAX_RADIUS_METERS
      );
    }
    return true;
  };

  const createSite = async () => {
    if (nameError) {
      setError(nameError);
      return;
    }
    const lat = parseLatitude(draft.latitude);
    const lng = parseLongitude(draft.longitude);
    if (lat == null || lng == null) {
      setError('Latitude must be between -90 and 90, and longitude between -180 and 180.');
      return;
    }
    if (isNullIsland(lat, lng)) {
      setError('Coordinates (0, 0) are not a valid location. Pick a point on the map.');
      return;
    }
    const radiusValue = Number(draft.radius);
    if (!Number.isFinite(radiusValue) || radiusValue <= 0 || radiusValue > MAX_RADIUS_METERS) {
      setError(`Radius must be between 1 and ${MAX_RADIUS_METERS} metres.`);
      return;
    }
    if (creating) return; // guard rapid double-submit
    setCreating(true);
    setError('');
    try {
      const payload = {
        name: draft.name.trim(),
        latitude: lat,
        longitude: lng,
        radius: Number(draft.radius),
        department_id: draft.department_id,
        address: draft.address || null,
      };
      let siteId;
      if (editingId) {
        const updated = await adminService.updateSite(editingId, payload);
        siteId = (updated?.data || updated)?.id || editingId;
      } else {
        const created = await adminService.createSite(payload);
        const site = created?.data || created;
        siteId = site?.id;
        if (siteId && draft.assigneeUids.length) {
          await Promise.all(
            draft.assigneeUids.map(async (uid) => {
              const current = await adminService.getEmployeeSites(uid).catch(() => []);
              const ids = Array.from(new Set([...(current || []).map((row) => row.site_id), siteId]));
              await adminService.setEmployeeSites(uid, ids);
            })
          );
        }
      }
      setNotice(editingId ? 'Location updated.' : 'Location created.');
      closeWizard();
      await load();
      if (siteId) setSelectedId(siteId);
    } catch (err) {
      console.error('[SitesPage] Failed to save site:', err);
      setError(err?.response?.data?.error || err?.message || 'Failed to save site');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSite = async (site) => {
    if (!site?.id || deletingId) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${site.name}"? This also removes its people assignments.`)) {
      return;
    }
    setDeletingId(site.id);
    setError('');
    try {
      await adminService.deleteSite(site.id);
      setNotice('Location deleted.');
      if (selectedId === site.id) setSelectedId(null);
      if (editingId === site.id) closeWizard();
      await load();
    } catch (err) {
      console.error('[SitesPage] Failed to delete site:', err);
      setError(err?.response?.data?.error || err?.message || 'Failed to delete site');
    } finally {
      setDeletingId(null);
    }
  };

  const loadEmployeeAssignments = async (uid) => {
    setAssignEmployeeUid(uid);
    if (!uid) {
      setAssignSiteIds([]);
      return;
    }
    const rows = await adminService.getEmployeeSites(uid).catch(() => []);
    setAssignSiteIds((rows || []).map((row) => row.site_id));
  };

  const saveAssignments = async () => {
    setAssignSaving(true);
    setError('');
    try {
      await adminService.setEmployeeSites(assignEmployeeUid, assignSiteIds);
      setNotice('Assignments saved.');
      const rows = await adminService.getEmployeeSites().catch(() => []);
      setAssignments(rows || []);
    } catch (err) {
      setError(err.message || 'Failed to save assignments');
    } finally {
      setAssignSaving(false);
    }
  };

  const toggleSite = (siteId) => {
    setAssignSiteIds((prev) => (prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId]));
  };

  const toggleAssignee = (uid) => {
    setDraft((current) => ({
      ...current,
      assigneeUids: current.assigneeUids.includes(uid)
        ? current.assigneeUids.filter((id) => id !== uid)
        : [...current.assigneeUids, uid],
    }));
  };

  const togglePersonOnSite = async (siteId, uid, assigned) => {
    setSiteAssignSaving(true);
    setError('');
    try {
      const current = await adminService.getEmployeeSites(uid);
      const ids = (current || []).map((row) => row.site_id);
      const next = assigned ? Array.from(new Set([...ids, siteId])) : ids.filter((id) => id !== siteId);
      await adminService.setEmployeeSites(uid, next);
      const rows = await adminService.getEmployeeSites().catch(() => []);
      setAssignments(rows || []);
    } catch (err) {
      setError(err.message || 'Failed to update assignment');
    } finally {
      setSiteAssignSaving(false);
    }
  };

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const row = listRef.current.querySelector(`[data-geofence-id="${selectedId}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  return (
    <div className="geofencing-directory admin-page admin-page-locked gap-4 animate-fade-up">
      {canManage && !wizard && (
        <PageActions>
          <button type="button" onClick={startWizard} className="ui-btn-primary ui-btn-sm">
            Add location
          </button>
        </PageActions>
      )}

      {error && <Alert type="error">{error}</Alert>}
      {notice && (
        <Alert type="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      <div className="geofencing-main-wrapper geofencing-workspace admin-fill">
        <aside className="geofencing-sidebar">
          {wizard ? (
            <WizardPanel
              step={step}
              draft={draft}
              departments={departments}
              users={assignableUsers}
              creating={creating}
              canAdvance={canAdvance()}
              departmentName={departmentName}
              nameError={nameError}
              coordErrors={coordErrors}
              onDraft={setDraft}
              onStep={setStep}
              onCancel={closeWizard}
              onToggleAssignee={toggleAssignee}
              onCreate={createSite}
              editing={Boolean(editingId)}
            />
          ) : (
            <>
              <div className="filter-action-bar border-b border-slate-200 px-3 py-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search locations"
                  aria-label="Search locations"
                  className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#00B0FF] focus:outline-none focus:ring-2 focus:ring-[#00B0FF]/20"
                />
              </div>
              <div className="geofencing-master" data-lenis-prevent ref={listRef}>
                {loading && (
                  <div className="space-y-2 p-3">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="skeleton h-14 rounded-xl" />
                    ))}
                  </div>
                )}
                {!loading && filteredSites.length === 0 && (
                  <EmptyStateBody
                    icon={MapPin}
                    title="No geofence sites yet"
                    description="Add a site with a centre point and radius, then assign people so mobile check-ins can be verified."
                    action={
                      canManage ? (
                        <button type="button" onClick={startWizard} className="ui-btn-primary ui-btn-sm">
                          Add location
                        </button>
                      ) : null
                    }
                    className="px-4 py-12"
                  />
                )}
                {!loading && filteredSites.length > 0 && (
                  <div className="space-y-2 p-3">
                    {filteredSites.map((site) => {
                      const people = peopleBySite.get(site.id) || [];
                      const expanded = selected?.id === site.id;
                      return (
                        <div
                          key={site.id}
                          data-geofence-id={site.id}
                          className={`geofence-card rounded-xl border transition-colors ${
                            expanded
                              ? 'border-sky-500 bg-sky-50/40'
                              : 'border-slate-200 bg-white hover:bg-slate-50'
                          }`}
                        >
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => selectSite(site.id)}
                            className="w-full px-3.5 py-2.5 text-left"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="min-w-0 truncate text-sm font-semibold text-slate-800">{site.name}</p>
                              <QuietStatus active label="Active" />
                            </div>
                            <p className="mt-1 truncate text-xs text-slate-500">
                              {coordinateLabels[site.id] || formatCoordinateLabel(site.latitude, site.longitude)}
                              <span className="text-slate-300"> • </span>
                              {formatMeters(site.radius)}
                              <span className="text-slate-300"> • </span>
                              {people.length} {people.length === 1 ? 'person' : 'people'} assigned
                            </p>
                          </button>
                          {expanded && (
                            <LocationDetail
                              site={site}
                              people={people}
                              users={assignableUsers}
                              assignedUids={new Set(people.map((row) => String(row.uid)))}
                              departmentName={departmentName(site.department_id)}
                              canManage={canManage}
                              saving={siteAssignSaving}
                              onTogglePerson={togglePersonOnSite}
                              assignEmployeeUid={assignEmployeeUid}
                              assignSiteIds={assignSiteIds}
                              assignSaving={assignSaving}
                              sites={sites}
                              onPickEmployee={loadEmployeeAssignments}
                              onToggleSite={toggleSite}
                              onSaveAssignments={saveAssignments}
                              onEdit={startEdit}
                              onDelete={handleDeleteSite}
                              deleting={deletingId === site.id}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>

        <div className="geofence-map-container geofencing-map-pane">
          <GeofenceMap
            sites={sites}
            selectedId={wizard ? null : selected?.id}
            fitKey={fitKey}
            overlappingIds={
              wizard
                ? Array.from(new Set([...overlappingIds, ...draftOverlapPartners.map((site) => site.id)]))
                : overlappingIds
            }
            preview={mapPreview}
            pickMode={wizard && (step === 2 || step === 3)}
            onSelect={(id) => {
              if (wizard) return;
              selectSite(id);
            }}
            onResetView={() => {
              if (!wizard) setSelectedId(null);
            }}
            onPick={({ lat, lng }) => {
              const nextLat = parseLatitude(Math.min(90, Math.max(-90, Number(lat))));
              const nextLng = wrapLongitude(lng);
              if (nextLat == null || nextLng == null) return;
              setDraft((current) => ({ ...current, latitude: String(nextLat), longitude: String(nextLng) }));
            }}
            className="h-full w-full"
          />
        </div>
      </div>
    </div>
  );
}

function WizardPanel({
  step,
  draft,
  departments,
  users,
  creating,
  canAdvance,
  departmentName,
  nameError,
  coordErrors = {},
  onDraft,
  onStep,
  onCancel,
  onToggleAssignee,
  onCreate,
  editing = false,
}) {
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const lat = parseLatitude(draft.latitude);
  const lng = parseLongitude(draft.longitude);

  // Debounced address preview as the pin/coordinates move — never blocks
  // saving; if the lookup fails or is slow, the form still submits with
  // whatever coordinates are set and the list falls back to showing those.
  useEffect(() => {
    if (lat == null || lng == null || isNullIsland(lat, lng)) return undefined;
    let cancelled = false;
    setResolvingAddress(true);
    const timer = setTimeout(async () => {
      const resolved = await reverseGeocode(lat, lng);
      if (!cancelled) {
        onDraft((current) => ({ ...current, address: resolved }));
        setResolvingAddress(false);
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">{editing ? 'Edit location' : 'Add location'}</p>
        <ol className="mt-2 flex gap-1">
          {STEPS.map((item) => (
            <li
              key={item.id}
              className={`h-1 flex-1 rounded-full ${item.id <= step ? 'bg-[#00B0FF]' : 'bg-slate-200'}`}
            />
          ))}
        </ol>
        <p className="mt-2 text-xs text-slate-400">
          Step {step} of {STEPS.length} / {STEPS[step - 1].label}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" data-lenis-prevent>
        {step === 1 && (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-[0.06em] text-slate-400">Location name</span>
              <input
                value={draft.name}
                onChange={(e) => onDraft((current) => ({ ...current, name: e.target.value }))}
                className="ui-input"
                placeholder="Headquarters"
                autoFocus
              />
            </label>
            {nameError && <p className="text-xs text-amber-700">{nameError}</p>}
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-[0.06em] text-slate-400">Department</span>
              <Select
                value={draft.department_id}
                onChange={(e) => onDraft((current) => ({ ...current, department_id: e.target.value }))}
              >
                <option value="">Select department</option>
                {departments.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>Click the map to place the centre, or enter coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium uppercase tracking-[0.06em] text-slate-400">Latitude</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="-90"
                  max="90"
                  step="any"
                  value={draft.latitude}
                  onChange={(e) => {
                    const next = acceptBoundedNumber(e.target.value, -90, 90);
                    if (next == null) return;
                    onDraft((current) => ({ ...current, latitude: next }));
                  }}
                  className="ui-input tabular-nums"
                  placeholder="24.86070"
                />
                {coordErrors.latitude && <p className="text-xs text-rose-600">{coordErrors.latitude}</p>}
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium uppercase tracking-[0.06em] text-slate-400">Longitude</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="-180"
                  max="180"
                  step="any"
                  value={draft.longitude}
                  onChange={(e) => {
                    const next = acceptBoundedNumber(e.target.value, -180, 180);
                    if (next == null) return;
                    onDraft((current) => ({ ...current, longitude: next }));
                  }}
                  className="ui-input tabular-nums"
                  placeholder="67.00110"
                />
                {coordErrors.longitude && <p className="text-xs text-rose-600">{coordErrors.longitude}</p>}
              </label>
            </div>
            <p className="text-xs text-slate-400">
              {resolvingAddress ? 'Resolving address…' : draft.address || 'Address will show once coordinates are set.'}
            </p>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <label className="block space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.06em] text-slate-400">Radius</span>
              <input
                type="range"
                min="25"
                max="2000"
                step="25"
                value={draft.radius}
                onChange={(e) => onDraft((current) => ({ ...current, radius: Number(e.target.value) }))}
                className="w-full accent-[#00B0FF]"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="10"
                  value={draft.radius}
                  onChange={(e) => onDraft((current) => ({ ...current, radius: Number(e.target.value) }))}
                  className="ui-input w-28"
                />
                <span className="text-sm text-slate-500">meters</span>
              </div>
            </label>
            <p className="text-sm text-slate-500">Attendance can be recorded inside this circle.</p>
          </div>
        )}
        {step === 4 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">Optional. Assign people now, or do it after the site exists.</p>
            {users.length === 0 ? (
              <p className="text-sm text-slate-500">No employees available to assign.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {users.map((row) => (
                  <li key={row.uid}>
                    <label className="flex cursor-pointer items-center gap-2 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="ui-checkbox"
                        checked={draft.assigneeUids.includes(row.uid)}
                        onChange={() => onToggleAssignee(row.uid)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-slate-800">{row.name || row.username}</span>
                        <span className="block truncate text-xs text-slate-400">{row.department}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {step === 5 && (
          <dl className="text-sm">
            <ReviewRow label="Name">{draft.name}</ReviewRow>
            <ReviewRow label="Department">{departmentName(draft.department_id)}</ReviewRow>
            <ReviewRow label="Location">
              {draft.address || formatCoordinateLabel(draft.latitude, draft.longitude)}
            </ReviewRow>
            <ReviewRow label="Centre">
              {formatCoord(draft.latitude)}, {formatCoord(draft.longitude)}
            </ReviewRow>
            <ReviewRow label="Radius">{formatMeters(draft.radius)}</ReviewRow>
            <ReviewRow label="People">{draft.assigneeUids.length} assigned</ReviewRow>
          </dl>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-200 p-3">
        <button type="button" onClick={onCancel} className="ui-btn-ghost ui-btn-sm" disabled={creating}>
          Cancel
        </button>
        <div className="flex gap-2">
          {step > 1 && (
            <button type="button" onClick={() => onStep(step - 1)} className="ui-btn-secondary ui-btn-sm" disabled={creating}>
              Back
            </button>
          )}
          {step < 5 ? (
            <button type="button" onClick={() => onStep(step + 1)} disabled={!canAdvance} className="ui-btn-primary ui-btn-sm">
              Continue
            </button>
          ) : (
            <button type="button" onClick={onCreate} disabled={creating || !canAdvance} className="ui-btn-primary ui-btn-sm">
              {creating ? 'Saving...' : editing ? 'Save changes' : 'Create location'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LocationDetail({
  site,
  people,
  users,
  assignedUids,
  departmentName,
  canManage,
  saving,
  onTogglePerson,
  assignEmployeeUid,
  assignSiteIds,
  assignSaving,
  sites,
  onPickEmployee,
  onToggleSite,
  onSaveAssignments,
  onEdit,
  onDelete,
  deleting = false,
}) {
  return (
    <div className="geofence-accordion-panel border-t border-sky-100 px-3.5 pb-3 pt-1.5">
      <dl>
        <DetailField label="Department">{departmentName}</DetailField>
        <DetailField label="Location">
          {site.address || formatCoordinateLabel(site.latitude, site.longitude)}
        </DetailField>
        <DetailField label="Centre">
          {formatCoord(site.latitude)}, {formatCoord(site.longitude)} • {formatMeters(site.radius)}
        </DetailField>
        <DetailField label="Attendance">Check-in must be inside this geofence.</DetailField>
      </dl>

      {canManage && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onEdit?.(site)}
            disabled={deleting}
            className="ui-btn-secondary ui-btn-sm"
          >
            Edit location
          </button>
          <button
            type="button"
            onClick={() => onDelete?.(site)}
            disabled={deleting}
            className="ui-btn-ghost ui-btn-sm text-rose-600 hover:text-rose-700"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}

      <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">Assigned workforce</p>
      {people.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">No one is assigned to this location.</p>
      ) : (
        <ul className="mt-0.5">
          {people.map((person) => (
            <li key={person.uid} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 break-words text-sm text-slate-800">
                {person.name}
                {person.department ? (
                  <span className="text-slate-400"> • {person.department}</span>
                ) : null}
              </span>
              {canManage && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onTogglePerson(site.id, person.uid, false)}
                  className="shrink-0 text-xs font-medium text-slate-400 hover:text-rose-500"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <details className="geofence-advanced mt-1.5">
          <summary>Assign people</summary>
          <ul className="mt-1">
            {users.map((row) => {
              const checked = assignedUids.has(String(row.uid));
              return (
                <li key={row.uid}>
                  <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      disabled={saving}
                      checked={checked}
                      onChange={() => onTogglePerson(site.id, row.uid, !checked)}
                    />
                    <span className="truncate text-slate-700">
                      {displayPersonName(row)}
                      {row.department ? <span className="text-slate-400"> • {row.department}</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {canManage && (
        <details className="geofence-advanced mt-1">
          <summary>Assign sites to an employee</summary>
          <div className="mt-1.5 space-y-2">
            <Select
              value={assignEmployeeUid}
              onChange={(e) => onPickEmployee(e.target.value)}
            >
              <option value="">Select employee</option>
              {users.map((row) => (
                <option key={row.uid} value={row.uid}>
                  {displayPersonName(row)}
                  {row.department ? ` (${row.department})` : ''}
                </option>
              ))}
            </Select>
            {assignEmployeeUid && (
              <div className="flex flex-wrap gap-1.5">
                {sites.map((item) => (
                  <label
                    key={item.id}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1 text-xs ${
                      assignSiteIds.includes(item.id)
                        ? 'border-[#00B0FF]/40 bg-[#F0FAFF] text-slate-800'
                        : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={assignSiteIds.includes(item.id)}
                      onChange={() => onToggleSite(item.id)}
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            )}
            <button
              type="button"
              disabled={!assignEmployeeUid || assignSaving}
              onClick={onSaveAssignments}
              className="ui-btn-primary ui-btn-sm"
            >
              {assignSaving ? 'Saving...' : 'Save assignments'}
            </button>
          </div>
        </details>
      )}
    </div>
  );
}

function QuietStatus({ active, label }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden />
      {label}
    </span>
  );
}

function DetailField({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5">
      <dt className="shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">{label}</dt>
      <dd className="min-w-0 text-right text-sm leading-5 text-slate-800">{children || '-'}</dd>
    </div>
  );
}

function ReviewRow({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-right text-slate-800">{children}</dd>
    </div>
  );
}