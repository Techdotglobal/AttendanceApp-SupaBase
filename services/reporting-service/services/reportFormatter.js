/**
 * Report Formatter - Aggregates and formats data into standard report schema
 */
const {
  getAllEmployees,
  getAttendanceRecords,
  getLeaveRequests,
  getTickets,
  getCompany,
} = require('./queryService');
const { getDateRange, formatDate, getPeriodLabel } = require('../utils/dateUtils');

const LATE_HOUR = 9;
const LATE_MINUTE = 30;

function recordBelongsToEmployee(record, emp) {
  return (
    (record.user_uid && (record.user_uid === emp.uid || record.user_uid === emp.id)) ||
    (record.username && record.username === emp.username) ||
    (record.employee_uid && (record.employee_uid === emp.uid || record.employee_uid === emp.id)) ||
    (record.employee_id && (record.employee_id === emp.id || record.employee_id === emp.username))
  );
}

function filterRecordsForEmployee(records, emp) {
  return records.filter((r) => recordBelongsToEmployee(r, emp));
}

function filterLeavesForEmployee(leaves, emp) {
  return leaves.filter((lr) =>
    (lr.employee_uid && (lr.employee_uid === emp.uid || lr.employee_uid === emp.id)) ||
    (lr.employee_id && (lr.employee_id === emp.id || lr.employee_id === emp.username))
  );
}

function calculateWorkDays(from, to) {
  let count = 0;
  const current = new Date(from);
  while (current <= to) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function dateKey(ts) {
  return new Date(ts).toISOString().split('T')[0];
}

function isLateCheckIn(timestamp) {
  const d = new Date(timestamp);
  return d.getHours() > LATE_HOUR || (d.getHours() === LATE_HOUR && d.getMinutes() > LATE_MINUTE);
}

function calculateHoursWorked(records) {
  const byDay = {};
  for (const r of records) {
    const key = dateKey(r.timestamp);
    if (!byDay[key]) byDay[key] = { checkins: [], checkouts: [] };
    if (r.type === 'checkin') byDay[key].checkins.push(new Date(r.timestamp));
    if (r.type === 'checkout') byDay[key].checkouts.push(new Date(r.timestamp));
  }

  let totalHours = 0;
  for (const day of Object.values(byDay)) {
    day.checkins.sort((a, b) => a - b);
    day.checkouts.sort((a, b) => a - b);
    const pairs = Math.min(day.checkins.length, day.checkouts.length);
    for (let i = 0; i < pairs; i++) {
      const diff = (day.checkouts[i] - day.checkins[i]) / (1000 * 60 * 60);
      if (diff > 0 && diff < 24) totalHours += diff;
    }
  }
  return Math.round(totalHours * 10) / 10;
}

function pct(numerator, denominator) {
  if (!denominator) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function buildDailyStats(attendanceRecords, fromDate, toDate) {
  const byDay = {};
  const current = new Date(fromDate);
  while (current <= toDate) {
    byDay[dateKey(current)] = { checkins: 0, checkouts: 0, late: 0 };
    current.setDate(current.getDate() + 1);
  }

  for (const r of attendanceRecords) {
    const key = dateKey(r.timestamp);
    if (!byDay[key]) byDay[key] = { checkins: 0, checkouts: 0, late: 0 };
    if (r.type === 'checkin') {
      byDay[key].checkins++;
      if (isLateCheckIn(r.timestamp)) byDay[key].late++;
    }
    if (r.type === 'checkout') byDay[key].checkouts++;
  }

  const days = Object.entries(byDay).map(([date, stats]) => ({
    date,
    checkins: stats.checkins,
    checkouts: stats.checkouts,
    late: stats.late,
    avgHours: stats.checkins > 0 ? (stats.checkouts > 0 ? 8 : 0) : 0,
  }));

  const totalCheckins = days.reduce((s, d) => s + d.checkins, 0);
  const totalCheckouts = days.reduce((s, d) => s + d.checkouts, 0);
  const totalLate = days.reduce((s, d) => s + d.late, 0);
  const activeDays = days.filter((d) => d.checkins > 0).length;

  return {
    days,
    totals: {
      checkins: totalCheckins,
      checkouts: totalCheckouts,
      lateArrivals: totalLate,
      avgCheckinsPerDay: activeDays ? Math.round((totalCheckins / activeDays) * 10) / 10 : 0,
      avgWorkHours: activeDays ? Math.round((calculateHoursWorked(attendanceRecords) / activeDays) * 10) / 10 : 0,
    },
  };
}

function buildEmployeeStats(employees, attendanceRecords, leaveRequests, fromDate, toDate) {
  const workDays = calculateWorkDays(fromDate, toDate);

  return employees.map((emp) => {
    const empRecords = filterRecordsForEmployee(attendanceRecords, emp);
    const empLeaves = filterLeavesForEmployee(leaveRequests, emp);
    const checkins = empRecords.filter((r) => r.type === 'checkin');
    const presentDays = new Set(checkins.map((r) => dateKey(r.timestamp))).size;
    const lateCount = checkins.filter((r) => isLateCheckIn(r.timestamp)).length;
    const leaveDays = empLeaves.filter((l) => l.status === 'approved').length;
    const absentDays = Math.max(0, workDays - presentDays - leaveDays);
    const hoursWorked = calculateHoursWorked(empRecords);

    return {
      name: emp.name || emp.username || 'Unknown',
      department: emp.department || 'Unassigned',
      workingDays: workDays,
      present: presentDays,
      absent: absentDays,
      late: lateCount,
      leave: leaveDays,
      attendanceRate: pct(presentDays, workDays),
      hoursWorked,
      workMode: emp.work_mode || 'office',
    };
  });
}

function buildDepartmentStats(employees, attendanceRecords, leaveRequests, tickets, fromDate, toDate) {
  const departments = [...new Set(employees.map((e) => e.department || 'Unassigned'))];

  return departments.map((dept) => {
    const deptEmployees = employees.filter((e) => (e.department || 'Unassigned') === dept);
    const deptRecords = attendanceRecords.filter((ar) =>
      deptEmployees.some((emp) => recordBelongsToEmployee(ar, emp))
    );
    const deptLeaves = leaveRequests.filter((lr) =>
      deptEmployees.some((emp) => filterLeavesForEmployee([lr], emp).length > 0)
    );
    const deptTickets = tickets.filter((t) =>
      deptEmployees.some((emp) =>
        (t.created_by_uid && (t.created_by_uid === emp.uid || t.created_by_uid === emp.id)) ||
        (t.created_by && t.created_by === emp.username)
      )
    );

    const workDays = calculateWorkDays(fromDate, toDate);
    const totalPresent = deptEmployees.reduce((sum, emp) => {
      const checkins = filterRecordsForEmployee(deptRecords, emp).filter((r) => r.type === 'checkin');
      return sum + new Set(checkins.map((r) => dateKey(r.timestamp))).size;
    }, 0);
    const expected = deptEmployees.length * workDays;
    const absent = Math.max(0, expected - totalPresent);

    return {
      name: dept,
      employees: deptEmployees.length,
      present: totalPresent,
      absent,
      attendanceRate: pct(totalPresent, expected),
      leaves: deptLeaves.length,
      tickets: deptTickets.length,
    };
  });
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
    pending: leaveRequests.filter((l) => l.status === 'pending').length,
    approved: leaveRequests.filter((l) => l.status === 'approved').length,
    rejected: leaveRequests.filter((l) => l.status === 'rejected').length,
    byType: Object.entries(byType).map(([type, counts]) => ({ type, ...counts })),
  };
}

function buildWorkModeDistribution(employees) {
  const modes = { office: 0, hybrid: 0, remote: 0, other: 0 };
  for (const emp of employees) {
    const mode = (emp.work_mode || 'office').toLowerCase();
    if (modes[mode] !== undefined) modes[mode]++;
    else modes.other++;
  }
  return modes;
}

function buildExecutiveSummary(employees, attendanceRecords, leaveRequests, fromDate, toDate) {
  const workDays = calculateWorkDays(fromDate, toDate);
  const employeeStats = buildEmployeeStats(employees, attendanceRecords, leaveRequests, fromDate, toDate);

  const present = employeeStats.reduce((s, e) => s + e.present, 0);
  const absent = employeeStats.reduce((s, e) => s + e.absent, 0);
  const late = employeeStats.reduce((s, e) => s + e.late, 0);
  const leave = employeeStats.reduce((s, e) => s + e.leave, 0);
  const expected = employees.length * workDays;

  return {
    totalEmployees: employees.length,
    present,
    absent,
    late,
    leave,
    attendanceRate: pct(present, expected),
    pendingLeaves: leaveRequests.filter((l) => l.status === 'pending').length,
    openTickets: 0,
  };
}

/**
 * Generate report data in standard schema
 */
async function generateReportData(range, from = null, to = null, companyId = null, generatedBy = null) {
  if (!companyId) {
    throw new Error('company_id is required to generate tenant-scoped reports');
  }

  const dateRange = getDateRange(range, from, to);
  const { from: fromDate, to: toDate } = dateRange;
  const startMs = Date.now();

  const [company, allEmployees, attendanceRecords, leaveRequests, tickets] = await Promise.all([
    getCompany(companyId),
    getAllEmployees(companyId),
    getAttendanceRecords(fromDate, toDate, companyId),
    getLeaveRequests(fromDate, toDate, companyId),
    getTickets(fromDate, toDate, companyId),
  ]);

  const executive = buildExecutiveSummary(allEmployees, attendanceRecords, leaveRequests, fromDate, toDate);
  executive.openTickets = tickets.filter((t) => t.status === 'open' || t.status === 'pending').length;

  const reportData = {
    company: {
      id: companyId,
      name: company?.name || `Company ${companyId.slice(0, 8)}`,
      logoUrl: company?.logo_url || null,
      primaryColor: company?.primary_color || '#2563eb',
    },
    meta: {
      generatedAt: new Date().toISOString(),
      generatedBy: generatedBy || 'Hadir.AI Reporting Service',
      preparationDurationMs: 0,
    },
    period: {
      type: range,
      from: formatDate(fromDate),
      to: formatDate(toDate),
      label: getPeriodLabel(range, fromDate, toDate),
    },
    executive,
    overall: {
      totalEmployees: executive.totalEmployees,
      attendanceRate: executive.attendanceRate,
      pendingLeaves: executive.pendingLeaves,
      openTickets: executive.openTickets,
    },
    attendanceStats: buildDailyStats(attendanceRecords, fromDate, toDate),
    departments: buildDepartmentStats(allEmployees, attendanceRecords, leaveRequests, tickets, fromDate, toDate),
    leaveSummary: buildLeaveSummary(leaveRequests),
    workMode: buildWorkModeDistribution(allEmployees),
    employees: buildEmployeeStats(allEmployees, attendanceRecords, leaveRequests, fromDate, toDate),
    charts: {
      attendanceTrend: buildDailyStats(attendanceRecords, fromDate, toDate).days.map((d) => ({
        label: d.date.slice(5),
        value: d.checkins,
      })),
      departmentComparison: buildDepartmentStats(allEmployees, attendanceRecords, leaveRequests, tickets, fromDate, toDate).map((d) => ({
        label: d.name,
        value: parseInt(d.attendanceRate, 10) || 0,
      })),
      leaveDistribution: buildLeaveSummary(leaveRequests).byType.map((l) => ({
        label: l.type,
        value: l.approved + l.pending + l.rejected,
      })),
      workModeDistribution: Object.entries(buildWorkModeDistribution(allEmployees)).map(([label, value]) => ({
        label,
        value,
      })),
    },
  };

  reportData.meta.preparationDurationMs = Date.now() - startMs;

  console.log(`[ReportFormatter] Generated ${range} report for ${reportData.company.name} in ${reportData.meta.preparationDurationMs}ms`);
  console.log(`[ReportFormatter] Employees: ${allEmployees.length}, Records: ${attendanceRecords.length}`);

  return reportData;
}

module.exports = {
  generateReportData,
  calculateWorkDays,
  recordBelongsToEmployee,
};
