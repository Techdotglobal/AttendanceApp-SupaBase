const crypto = require('crypto');

const DEFAULT_LEASE_SECONDS = 900;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

function newOwnerToken() {
  return crypto.randomUUID();
}

async function rpc(supabase, functionName, args) {
  const { data, error } = await supabase.rpc(functionName, args);
  if (error) throw error;
  return data;
}

async function acquireAttendanceFinalizationLock(supabase, { companyId, workDate, mode, ownerToken = newOwnerToken(), leaseSeconds = DEFAULT_LEASE_SECONDS }) {
  const acquired = await rpc(supabase, 'try_acquire_attendance_finalization_lock', {
    p_company_id: companyId,
    p_work_date: workDate,
    p_mode: mode,
    p_owner_token: ownerToken,
    p_lease_seconds: leaseSeconds,
  });
  return { acquired: acquired === true, ownerToken, leaseSeconds };
}

async function releaseAttendanceFinalizationLock(supabase, { companyId, workDate, mode, ownerToken }) {
  if (!ownerToken) return false;
  return Boolean(await rpc(supabase, 'release_attendance_finalization_lock', {
    p_company_id: companyId,
    p_work_date: workDate,
    p_mode: mode,
    p_owner_token: ownerToken,
  }));
}

async function withAttendanceFinalizationLock(supabase, key, work, options = {}) {
  const lock = await acquireAttendanceFinalizationLock(supabase, { ...key, ...options });
  if (!lock.acquired) return { acquired: false, skipped: true, reason: 'locked' };

  let heartbeat = null;
  let heartbeatFailure = null;
  if (lock.leaseSeconds > 0) {
    heartbeat = setInterval(() => {
      rpc(supabase, 'renew_attendance_finalization_lock', {
        p_company_id: key.companyId,
        p_work_date: key.workDate,
        p_mode: key.mode,
        p_owner_token: lock.ownerToken,
        p_lease_seconds: lock.leaseSeconds,
      }).then((renewed) => {
        if (renewed !== true) heartbeatFailure = new Error('Attendance finalization lock was lost');
      }).catch((error) => { heartbeatFailure = error; });
    }, Math.min(HEARTBEAT_INTERVAL_MS, Math.max(1000, Math.floor(lock.leaseSeconds * 1000 / 3))));
    heartbeat.unref?.();
  }

  try {
    const result = await work({ ownerToken: lock.ownerToken, lockLost: () => heartbeatFailure });
    if (heartbeatFailure) throw heartbeatFailure;
    return { acquired: true, result };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await releaseAttendanceFinalizationLock(supabase, { ...key, ownerToken: lock.ownerToken });
  }
}

module.exports = {
  DEFAULT_LEASE_SECONDS,
  HEARTBEAT_INTERVAL_MS,
  newOwnerToken,
  acquireAttendanceFinalizationLock,
  releaseAttendanceFinalizationLock,
  withAttendanceFinalizationLock,
};
