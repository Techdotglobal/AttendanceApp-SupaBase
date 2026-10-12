function trustedDateParts(date, timezone) {
  if (!timezone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const output = {};
    for (const part of parts) if (part.type !== 'literal') output[part.type] = Number(part.value);
    return output;
  } catch (_) {
    return null;
  }
}

function localDateKey(value, timezone = null) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const trusted = trustedDateParts(date, timezone);
  const year = trusted?.year ?? date.getFullYear();
  const month = String((trusted?.month ?? (date.getMonth() + 1))).padStart(2, '0');
  const day = String((trusted?.day ?? date.getDate())).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function deriveSelfServiceAttendanceState(records = [], now = new Date(), timezone = null) {
  const ordered = [...records]
    .filter((row) => row?.timestamp && !Number.isNaN(new Date(row.timestamp).getTime()))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp) || String(a.id || '').localeCompare(String(b.id || '')));
  const lastRecord = ordered[ordered.length - 1] || null;
  const type = String(lastRecord?.type || '').toLowerCase().replace(/_/g, '');
  const currentDate = localDateKey(now, timezone);
  const completed = type === 'checkout' && localDateKey(lastRecord.timestamp, timezone) === currentDate;
  return {
    lastRecord,
    completed,
    canCheckIn: !lastRecord || (type === 'checkout' && !completed),
    canCheckOut: type === 'checkin',
  };
}

module.exports = { localDateKey, deriveSelfServiceAttendanceState };
