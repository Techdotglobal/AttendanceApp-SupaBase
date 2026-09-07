const WORK_MODES = Object.freeze({
  IN_OFFICE: 'in_office',
  HYBRID: 'semi_remote',
  REMOTE: 'fully_remote',
});

const WORK_MODE_ALIASES = new Map([
  ['in_office', WORK_MODES.IN_OFFICE],
  ['office', WORK_MODES.IN_OFFICE],
  ['onsite', WORK_MODES.IN_OFFICE],
  ['on_site', WORK_MODES.IN_OFFICE],
  ['hybrid', WORK_MODES.HYBRID],
  ['semi_remote', WORK_MODES.HYBRID],
  ['remote', WORK_MODES.REMOTE],
  ['fully_remote', WORK_MODES.REMOTE],
]);

function normalizeWorkMode(value, fallback = WORK_MODES.IN_OFFICE) {
  if (value == null || value === '') return fallback;
  const key = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return WORK_MODE_ALIASES.get(key) || fallback;
}

function isValidWorkMode(value) {
  return Object.values(WORK_MODES).includes(normalizeWorkMode(value, null));
}

module.exports = {
  WORK_MODES,
  normalizeWorkMode,
  isValidWorkMode,
};
