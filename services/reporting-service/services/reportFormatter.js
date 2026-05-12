/**
 * Report Formatter - Aggregates and formats data into standard report schema
 */
const {
  getAllEmployees,
  getAttendanceRecords,
  getLeaveRequests,
  getTickets,
} = require('./queryService');
const { getDateRange, formatDate, getPeriodLabel } = require('../utils/dateUtils');

/**
 * Calculate attendance rate for a set of employees and records
 * @param {Array} employees - Array of employee objects
 * @param {Array} records - Array of attendance records
 * @param {Date} from - Start date
 * @param {Date} to - End date
 * @returns {string} Attendance rate as percentage
 */
function calculateAttendanceRate(employees, records, from, to) {
  if (!employees || employees.length === 0) return '0%';

  // Calculate expected work days (excluding weekends)
  const workDays = calculateWorkDays(from, to);
  const expectedCheckIns = employees.length * workDays;

  if (expectedCheckIns === 0) return '0%';

  // Build list of employee identifiers to match records
  // Attendance records use: user_uid (UUID) and username (string)
  const employeeUids = employees.map(emp => emp.uid).filter(Boolean);
  const employeeUsernames = employees.map(emp => emp.username).filter(Boolean);
  const employeeIds = employees.map(emp => emp.id).filter(Boolean);

  // Filter records to only those belonging to these employees
  // Match by user_uid, username, or id (for backward compatibility)
  const relevantRecords = records.filter(r => {
    return (
      (r.user_uid && (employeeUids.includes(r.user_uid) || employeeIds.includes(r.user_uid))) ||
      (r.username && employeeUsernames.includes(r.username)) ||
      (r.employee_uid && (employeeUids.includes(r.employee_uid) || employeeIds.includes(r.employee_uid))) ||
      (r.employee_id && (employeeIds.includes(r.employee_id) || employeeUsernames.includes(r.employee_id)))
    );
  });

  // Count actual check-ins from relevant records only
  const checkInCount = relevantRecords.filter(r => r.type === 'checkin').length;
  const rate = (checkInCount / expectedCheckIns) * 100;

  return `${Math.round(rate)}%`;
}

/**
 * Calculate work days between two dates (excluding weekends)
 * @param {Date} from - Start date
 * @param {Date} to - End date
 * @returns {number} Number of work days
 */
function calculateWorkDays(from, to) {
  let count = 0;
  const current = new Date(from);
  
  while (current <= to) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday (0) or Saturday (6)
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  
  return count;
}

/**
 * Generate report data in standard schema
 * @param {string} range - Report range type
 * @param {string} from - Custom start date (optional)
 * @param {string} to - Custom end date (optional)
 * @param {string} companyId - Tenant UUID (required)
 * @returns {Promise<Object>} Formatted report data
 */
async function generateReportData(range, from = null, to = null, companyId = null) {
  try {
    if (!companyId) {
      throw new Error('company_id is required to generate tenant-scoped reports');
    }

    // Get date range
    const dateRange = getDateRange(range, from, to);
    const { from: fromDate, to: toDate } = dateRange;

    // Fetch all data in parallel
    const [allEmployees, attendanceRecords, leaveRequests, tickets] = await Promise.all([
      getAllEmployees(companyId),
      getAttendanceRecords(fromDate, toDate, companyId),
      getLeaveRequests(fromDate, toDate, companyId),
      getTickets(fromDate, toDate, companyId),
    ]);

    // Debug logging
    console.log(`[ReportFormatter] Date range: ${fromDate.toISOString()} to ${toDate.toISOString()}`);
    console.log(`[ReportFormatter] Employees found: ${allEmployees.length}`);
    console.log(`[ReportFormatter] Attendance records found: ${attendanceRecords.length}`);
    console.log(`[ReportFormatter] Leave requests found: ${leaveRequests.length}`);
    console.log(`[ReportFormatter] Tickets found: ${tickets.length}`);
    
    if (attendanceRecords.length > 0) {
      console.log(`[ReportFormatter] Sample attendance record fields:`, Object.keys(attendanceRecords[0]));
      console.log(`[ReportFormatter] Sample attendance record:`, {
        user_uid: attendanceRecords[0].user_uid,
        username: attendanceRecords[0].username,
        type: attendanceRecords[0].type,
        timestamp: attendanceRecords[0].timestamp
      });
    }

    // Get unique departments
    const departments = [...new Set(allEmployees.map(emp => emp.department).filter(Boolean))];

    // Calculate overall statistics
    const overall = {
      totalEmployees: allEmployees.length,
      attendanceRate: calculateAttendanceRate(allEmployees, attendanceRecords, fromDate, toDate),
      pendingLeaves: leaveRequests.filter(lr => lr.status === 'pending').length,
      openTickets: tickets.filter(t => t.status === 'open' || t.status === 'pending').length,
    };

    // Calculate department-wise statistics
    const departmentStats = departments.map(dept => {
      const deptEmployees = allEmployees.filter(emp => emp.department === dept);
      
      // Build employee identifiers for matching
      // Attendance records use: user_uid (UUID) and username (string)
      const deptEmployeeUids = deptEmployees.map(emp => emp.uid).filter(Boolean);
      const deptEmployeeUsernames = deptEmployees.map(emp => emp.username).filter(Boolean);
      const deptEmployeeIds = deptEmployees.map(emp => emp.id).filter(Boolean);
      
      // Filter attendance records - match by user_uid, username, or id
      const deptAttendanceRecords = attendanceRecords.filter(ar => {
        return (
          (ar.user_uid && (deptEmployeeUids.includes(ar.user_uid) || deptEmployeeIds.includes(ar.user_uid))) ||
          (ar.username && deptEmployeeUsernames.includes(ar.username)) ||
          (ar.employee_uid && (deptEmployeeUids.includes(ar.employee_uid) || deptEmployeeIds.includes(ar.employee_uid))) ||
          (ar.employee_id && (deptEmployeeIds.includes(ar.employee_id) || deptEmployeeUsernames.includes(ar.employee_id)))
        );
      });
      
      // Filter leave requests - match by employee_uid or employee_id
      const deptLeaveRequests = leaveRequests.filter(lr => {
        return (
          (lr.employee_uid && (deptEmployeeUids.includes(lr.employee_uid) || deptEmployeeIds.includes(lr.employee_uid))) ||
          (lr.employee_id && (deptEmployeeIds.includes(lr.employee_id) || deptEmployeeUsernames.includes(lr.employee_id)))
        );
      });
      
      // Filter tickets - match by created_by_uid or created_by (username)
      const deptTickets = tickets.filter(t => {
        return (
          (t.created_by_uid && (deptEmployeeUids.includes(t.created_by_uid) || deptEmployeeIds.includes(t.created_by_uid))) ||
          (t.created_by && deptEmployeeUsernames.includes(t.created_by))
        );
      });

      return {
        name: dept,
        employees: deptEmployees.length,
        attendanceRate: calculateAttendanceRate(deptEmployees, deptAttendanceRecords, fromDate, toDate),
        leaves: deptLeaveRequests.length,
        tickets: deptTickets.length,
      };
    });

    // Build report data structure
    const reportData = {
      period: {
        type: range,
        from: formatDate(fromDate),
        to: formatDate(toDate),
        label: getPeriodLabel(range, fromDate, toDate),
      },
      overall,
      departments: departmentStats,
    };

    return reportData;
  } catch (error) {
    console.error('Error generating report data:', error);
    throw error;
  }
}

module.exports = {
  generateReportData,
  calculateAttendanceRate,
  calculateWorkDays,
};

