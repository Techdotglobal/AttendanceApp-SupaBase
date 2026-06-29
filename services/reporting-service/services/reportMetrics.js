/**
 * Report Metrics Engine — single source of truth for all attendance calculations.
 * Every PDF section derives from the output of buildReportMetrics().
 */
const LATE_HOUR = 9;
const LATE_MINUTE = 30;
const STANDARD_DAY_HOURS = 8;

function recordBelongsToEmployee(record, emp) {
  return (
    (record.user_uid && (record.user_uid === emp.uid || record.user_uid === emp.id)) ||
    (record.username && record.username === emp.username) ||
    (record.employee_uid && (record.employee_uid === emp.uid || record.employee_uid === emp.id)) ||
    (record.employee_id && (record.employee_id === emp.id || record.employee_id === emp.username))
  );
}

function dateKey(ts) {
  return new Date(ts).toISOString().split('T')[0];
}

function calculateWorkDays(from, to) {
  let count = 0;
  const current = new Date(from);
  const end = new Date(to);
  while (current <= end) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function isWeekday(d) {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6;
}

function isLateCheckIn(timestamp) {
  const d = new Date(timestamp);
  return d.getHours() > LATE_HOUR || (d.getHours() === LATE_HOUR && d.getMinutes() > LATE_MINUTE);
}

function lateMinutes(timestamp) {
  const d = new Date(timestamp);
  const scheduled = new Date(d);
  scheduled.setHours(LATE_HOUR, LATE_MINUTE, 0, 0);
  return Math.max(0, Math.round((d - scheduled) / 60000));
}

function leaveBelongsToEmployee(leave, emp) {
  return (
    (leave.employee_uid && (leave.employee_uid === emp.uid || leave.employee_uid === emp.id)) ||
    (leave.employee_id && (leave.employee_id === emp.id || leave.employee_id === emp.username))
  );
}

/**
 * Count approved leave weekdays overlapping the report period.
 */
function approvedLeaveDaysInPeriod(leaves, emp, fromDate, toDate) {
  let total = 0;
  for (const lr of leaves) {
    if (!leaveBelongsToEmployee(lr, emp)) continue;
    if ((lr.status || '').toLowerCase() !== 'approved') continue;

    const start = new Date(lr.start_date);
    const end = new Date(lr.end_date);
    const overlapStart = new Date(Math.max(start.getTime(), fromDate.getTime()));
    const overlapEnd = new Date(Math.min(end.getTime(), toDate.getTime()));
    if (overlapStart > overlapEnd) continue;

    let days = 0;
    const cursor = new Date(overlapStart);
    while (cursor <= overlapEnd) {
      if (isWeekday(cursor)) days++;
      cursor.setDate(cursor.getDate() + 1);
    }
    total += days;
  }
  return total;
}

function computeDayRecords(records) {
  const byDay = {};
  for (const r of records) {
    const key = dateKey(r.timestamp);
    if (!byDay[key]) byDay[key] = { checkins: [], checkouts: [] };
    if (r.type === 'checkin') byDay[key].checkins.push(new Date(r.timestamp));
    if (r.type === 'checkout') byDay[key].checkouts.push(new Date(r.timestamp));
  }
  return byDay;
}

function computeHoursAndOvertime(byDay) {
  let totalHours = 0;
  let overtime = 0;

  for (const day of Object.values(byDay)) {
    day.checkins.sort((a, b) => a - b);
    day.checkouts.sort((a, b) => a - b);
    const pairs = Math.min(day.checkins.length, day.checkouts.length);
    for (let i = 0; i < pairs; i++) {
      const hours = (day.checkouts[i] - day.checkins[i]) / 3600000;
      if (hours > 0 && hours < 24) {
        totalHours += hours;
        overtime += Math.max(0, hours - STANDARD_DAY_HOURS);
      }
    }
  }

  return {
    hoursWorked: Math.round(totalHours * 10) / 10,
    overtime: Math.round(overtime * 10) / 10,
  };
}

function avgTimeString(times) {
  if (!times.length) return '—';
  const avg = times.reduce((s, t) => s + t.getHours() * 60 + t.getMinutes(), 0) / times.length;
  const h = Math.floor(avg / 60);
  const m = Math.round(avg % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function pct(numerator, denominator) {
  if (!denominator || denominator <= 0) return '0%';
  const rate = Math.min(100, Math.max(0, Math.round((numerator / denominator) * 100)));
  return `${rate}%`;
}

function pctNum(numerator, denominator) {
  if (!denominator || denominator <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((numerator / denominator) * 100)));
}

/**
 * Compute per-employee attendance for the reporting period.
 */
function computeEmployeeMetrics(emp, attendanceRecords, leaveRequests, workingDays, fromDate, toDate) {
  const empRecords = attendanceRecords.filter((r) => recordBelongsToEmployee(r, emp));
  const checkins = empRecords.filter((r) => r.type === 'checkin');
  const checkouts = empRecords.filter((r) => r.type === 'checkout');

  const presentDates = new Set(checkins.map((r) => dateKey(r.timestamp)));
  const present = presentDates.size;

  const lateDates = new Set(
    checkins.filter((r) => isLateCheckIn(r.timestamp)).map((r) => dateKey(r.timestamp))
  );
  const late = lateDates.size;

  const leave = approvedLeaveDaysInPeriod(leaveRequests, emp, fromDate, toDate);
  const absent = Math.max(0, workingDays - present - leave);

  const byDay = computeDayRecords(empRecords);
  const { hoursWorked, overtime } = computeHoursAndOvertime(byDay);

  const lateMinutesTotal = checkins
    .filter((r) => isLateCheckIn(r.timestamp))
    .reduce((s, r) => s + lateMinutes(r.timestamp), 0);

  const attendanceRate = pct(present + leave, workingDays);

  return {
    name: emp.name || emp.username || 'Unknown',
    department: emp.department || 'Unassigned',
    workMode: (emp.work_mode || 'office').toLowerCase(),
    workingDays,
    present,
    absent,
    leave,
    late,
    lateMinutes: lateMinutesTotal,
    attendanceRate,
    attendanceRateNum: pctNum(present + leave, workingDays),
    hoursWorked,
    overtime,
    checkinTimes: checkins.map((r) => new Date(r.timestamp)),
    checkoutTimes: checkouts.map((r) => new Date(r.timestamp)),
  };
}

function aggregateDepartmentStats(employeeMetrics) {
  const deptMap = new Map();

  for (const e of employeeMetrics) {
    if (!deptMap.has(e.department)) {
      deptMap.set(e.department, {
        name: e.department,
        employees: 0,
        present: 0,
        absent: 0,
        leave: 0,
        late: 0,
        workingDays: 0,
        hoursWorked: 0,
      });
    }
    const d = deptMap.get(e.department);
    d.employees++;
    d.present += e.present;
    d.absent += e.absent;
    d.leave += e.leave;
    d.late += e.late;
    d.workingDays += e.workingDays;
    d.hoursWorked += e.hoursWorked;
  }

  return Array.from(deptMap.values()).map((d) => {
    const expected = d.workingDays;
    const avgHours = d.employees ? Math.round((d.hoursWorked / d.employees) * 10) / 10 : 0;
    return {
      ...d,
      attendanceRate: pct(d.present + d.leave, expected),
      attendanceRateNum: pctNum(d.present + d.leave, expected),
      avgHours,
    };
  }).sort((a, b) => b.attendanceRateNum - a.attendanceRateNum);
}

function buildDailyTrend(attendanceRecords, fromDate, toDate) {
  const byDay = {};
  const cursor = new Date(fromDate);
  while (cursor <= toDate) {
    byDay[dateKey(cursor)] = { checkins: 0, checkouts: 0, late: 0, employees: new Set() };
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const r of attendanceRecords) {
    const key = dateKey(r.timestamp);
    if (!byDay[key]) continue;
    if (r.type === 'checkin') {
      byDay[key].checkins++;
      byDay[key].employees.add(r.user_uid || r.username);
      if (isLateCheckIn(r.timestamp)) byDay[key].late++;
    }
    if (r.type === 'checkout') byDay[key].checkouts++;
  }

  return Object.entries(byDay).map(([date, s]) => ({
    date,
    label: date.slice(5),
    checkins: s.checkins,
    checkouts: s.checkouts,
    late: s.late,
    employeesPresent: s.employees.size,
  }));
}

function buildAttendanceStats(employeeMetrics, attendanceRecords, dailyTrend) {
  const allCheckins = attendanceRecords.filter((r) => r.type === 'checkin');
  const allCheckouts = attendanceRecords.filter((r) => r.type === 'checkout');
  const allLate = allCheckins.filter((r) => isLateCheckIn(r.timestamp));

  const totalHours = employeeMetrics.reduce((s, e) => s + e.hoursWorked, 0);
  const totalLateMinutes = employeeMetrics.reduce((s, e) => s + e.lateMinutes, 0);
  const activeEmployees = employeeMetrics.filter((e) => e.present > 0).length;

  const workModes = { office: 0, hybrid: 0, remote: 0, other: 0 };
  for (const e of employeeMetrics) {
    if (workModes[e.workMode] !== undefined) workModes[e.workMode]++;
    else workModes.other++;
  }

  const daysWithData = dailyTrend.filter((d) => d.checkins > 0).length;

  return {
    totals: {
      checkins: allCheckins.length,
      checkouts: allCheckouts.length,
      avgCheckInTime: avgTimeString(allCheckins.map((r) => new Date(r.timestamp))),
      avgCheckOutTime: avgTimeString(allCheckouts.map((r) => new Date(r.timestamp))),
      avgWorkHours: activeEmployees ? Math.round((totalHours / activeEmployees) * 10) / 10 : 0,
      avgLateMinutes: allLate.length ? Math.round(totalLateMinutes / allLate.length) : 0,
      lateArrivals: allLate.length,
      lateDays: employeeMetrics.reduce((s, e) => s + e.late, 0),
      officeDays: workModes.office,
      hybridDays: workModes.hybrid,
      remoteDays: workModes.remote,
      daysWithData,
    },
    workModes,
    daily: dailyTrend,
  };
}

function buildExecutiveSummary(employeeMetrics, leaveRequests, openTickets) {
  const totalEmployees = employeeMetrics.length;
  const totalWorkingDays = employeeMetrics.reduce((s, e) => s + e.workingDays, 0);
  const totalPresent = employeeMetrics.reduce((s, e) => s + e.present, 0);
  const totalAbsent = employeeMetrics.reduce((s, e) => s + e.absent, 0);
  const totalLeave = employeeMetrics.reduce((s, e) => s + e.leave, 0);
  const totalLate = employeeMetrics.reduce((s, e) => s + e.late, 0);
  const totalHours = employeeMetrics.reduce((s, e) => s + e.hoursWorked, 0);
  const activeCount = employeeMetrics.filter((e) => e.present > 0).length;
  const avgEmployeeRate = totalEmployees
    ? Math.round(employeeMetrics.reduce((s, e) => s + e.attendanceRateNum, 0) / totalEmployees)
    : 0;

  return {
    totalEmployees,
    present: totalPresent,
    absent: totalAbsent,
    leave: totalLeave,
    late: totalLate,
    attendanceRate: pct(totalPresent + totalLeave, totalWorkingDays),
    attendanceRateNum: pctNum(totalPresent + totalLeave, totalWorkingDays),
    avgEmployeeAttendanceRate: `${avgEmployeeRate}%`,
    avgHours: activeCount ? Math.round((totalHours / activeCount) * 10) / 10 : 0,
    employeesWithAttendance: activeCount,
    pendingLeaves: leaveRequests.filter((l) => (l.status || '').toLowerCase() === 'pending').length,
    openTickets,
    totalWorkingDays,
  };
}

function buildLeaveSummary(leaveRequests) {
  const byType = {};
  for (const lr of leaveRequests) {
    const type = lr.leave_type || lr.category || 'Other';
    if (!byType[type]) byType[type] = { pending: 0, approved: 0, rejected: 0 };
    const status = (lr.status || 'pending').toLowerCase();
    if (status === 'approved') byType[type].approved++;
    else if (status === 'rejected') byType[type].rejected++;
    else byType[type].pending++;
  }

  return {
    pending: leaveRequests.filter((l) => (l.status || '').toLowerCase() === 'pending').length,
    approved: leaveRequests.filter((l) => (l.status || '').toLowerCase() === 'approved').length,
    rejected: leaveRequests.filter((l) => (l.status || '').toLowerCase() === 'rejected').length,
    byType: Object.entries(byType).map(([type, counts]) => ({ type, ...counts })),
  };
}

function validateMetrics(employeeMetrics, executive, departments) {
  const warnings = [];

  for (const e of employeeMetrics) {
    if (e.present < 0 || e.absent < 0 || e.leave < 0 || e.late < 0) {
      warnings.push(`Negative value for ${e.name}`);
    }
    if (e.present + e.leave + e.absent > e.workingDays + 1) {
      warnings.push(`${e.name}: present(${e.present}) + leave(${e.leave}) + absent(${e.absent}) > workingDays(${e.workingDays})`);
      e.absent = Math.max(0, e.workingDays - e.present - e.leave);
    }
    if (e.present > e.workingDays) {
      warnings.push(`${e.name}: present exceeds working days`);
      e.present = e.workingDays;
    }
  }

  const deptPresent = departments.reduce((s, d) => s + d.present, 0);
  if (deptPresent !== executive.present) {
    warnings.push(`Department present total (${deptPresent}) != executive present (${executive.present})`);
  }

  if (warnings.length) {
    console.warn('[ReportMetrics] Validation warnings:', warnings);
  }

  return warnings;
}

/**
 * Build all report metrics from raw data — call once, use everywhere.
 */
function buildReportMetrics({ employees, attendanceRecords, leaveRequests, tickets, fromDate, toDate }) {
  const workingDays = calculateWorkDays(fromDate, toDate);
  const hasAttendance = attendanceRecords.some((r) => r.type === 'checkin');

  const employeeMetrics = employees.map((emp) =>
    computeEmployeeMetrics(emp, attendanceRecords, leaveRequests, workingDays, fromDate, toDate)
  );

  const departments = aggregateDepartmentStats(employeeMetrics);
  const dailyTrend = buildDailyTrend(attendanceRecords, fromDate, toDate);
  const attendanceStats = buildAttendanceStats(employeeMetrics, attendanceRecords, dailyTrend);
  const leaveSummary = buildLeaveSummary(leaveRequests);
  const openTickets = tickets.filter((t) => t.status === 'open' || t.status === 'pending').length;
  const executive = buildExecutiveSummary(employeeMetrics, leaveRequests, openTickets);

  validateMetrics(employeeMetrics, executive, departments);

  const charts = {
    attendanceTrend: dailyTrend.filter((d) => d.checkins > 0 || d.date).slice(-14).map((d) => ({
      label: d.label,
      value: d.employeesPresent || d.checkins,
    })),
    departmentComparison: departments.map((d) => ({
      label: d.name.length > 10 ? `${d.name.slice(0, 9)}…` : d.name,
      value: d.attendanceRateNum,
    })),
    leaveDistribution: leaveSummary.byType.map((l) => ({
      label: l.type.length > 8 ? `${l.type.slice(0, 7)}…` : l.type,
      value: l.approved + l.pending + l.rejected,
    })),
    workModeDistribution: Object.entries(attendanceStats.workModes)
      .filter(([, v]) => v > 0)
      .map(([label, value]) => ({ label, value })),
  };

  return {
    workingDays,
    hasAttendance,
    employeeMetrics,
    departments,
    attendanceStats,
    leaveSummary,
    executive,
    charts,
    workMode: attendanceStats.workModes,
  };
}

module.exports = {
  buildReportMetrics,
  calculateWorkDays,
  recordBelongsToEmployee,
  pct,
};
