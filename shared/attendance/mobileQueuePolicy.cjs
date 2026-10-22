const NETWORK_ERROR_PATTERN = /(network|fetch|timeout|offline|connection|abort|unreachable)/i;

function errorStatus(error) {
  return Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? 0) || 0;
}

function classifyAttendanceWriteError(error) {
  const status = errorStatus(error);
  const code = String(error?.code || '').trim();
  const message = String(error?.message || error || '');
  const networkCode = /^(?:ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT)$/i.test(code);
  if (networkCode || error?.name === 'AbortError') return 'network';
  if (code || (status >= 400 && status < 500)) return 'terminal';
  return NETWORK_ERROR_PATTERN.test(message) ? 'network' : 'terminal';
}

function isDesiredStateSatisfied(type, state) {
  if (!state || typeof state !== 'object') return false;
  const normalizedType = String(type || '').toLowerCase();
  const canCheckOut = state.can_check_out ?? state.canCheckOut;
  const completed = state.completed === true;
  const latestType = state.latest_record?.type || state.lastRecord?.type;
  if (normalizedType === 'checkin') {
    // `completed` means the resolved workday is already closed. It must not
    // be treated as confirmation that a new/retried check-in succeeded.
    return canCheckOut === true || state.status === 'PRESENT' || state.status === 'LATE';
  }
  if (normalizedType === 'checkout') {
    return completed
      || (canCheckOut === false && String(latestType || '').toLowerCase() === 'checkout');
  }
  return false;
}

function hasQueueIdentity(record) {
  return Boolean(record?.user_uid && record?.company_id);
}

function queueIdentityMatches(record, userUid, companyId) {
  return hasQueueIdentity(record)
    && String(record.user_uid) === String(userUid)
    && String(record.company_id) === String(companyId);
}

module.exports = {
  classifyAttendanceWriteError,
  isDesiredStateSatisfied,
  hasQueueIdentity,
  queueIdentityMatches,
};
