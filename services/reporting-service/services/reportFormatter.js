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
const { buildReportMetrics } = require('./reportMetrics');

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

  const metrics = buildReportMetrics({
    employees: allEmployees,
    attendanceRecords,
    leaveRequests,
    tickets,
    fromDate,
    toDate,
  });

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
      hasAttendance: metrics.hasAttendance,
      workingDays: metrics.workingDays,
    },
    period: {
      type: range,
      from: formatDate(fromDate),
      to: formatDate(toDate),
      label: getPeriodLabel(range, fromDate, toDate),
    },
    executive: metrics.executive,
    overall: {
      totalEmployees: metrics.executive.totalEmployees,
      attendanceRate: metrics.executive.attendanceRate,
      pendingLeaves: metrics.executive.pendingLeaves,
      openTickets: metrics.executive.openTickets,
    },
    attendanceStats: metrics.attendanceStats,
    departments: metrics.departments,
    leaveSummary: metrics.leaveSummary,
    workMode: metrics.workMode,
    employees: metrics.employeeMetrics,
    charts: metrics.charts,
  };

  reportData.meta.preparationDurationMs = Date.now() - startMs;

  console.log(`[ReportFormatter] ${range} report for ${reportData.company.name}: ${allEmployees.length} employees, ${metrics.executive.attendanceRate} attendance, ${metrics.workingDays} working days`);

  return reportData;
}

module.exports = {
  generateReportData,
};
