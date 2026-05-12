// Analytics utilities for attendance data
import { supabase } from '../core/config/supabase';
import { fetchSessionUserCompanyId, requireValidCompanyId } from '../core/tenant/tenantScope';
import { getAttendanceRecords, getUserAttendanceRecords } from './storage';

/**
 * Group attendance records by date
 * @param {Array} records - Array of attendance records
 * @returns {Object} Object with dates as keys and arrays of records as values
 */
const groupRecordsByDate = (records) => {
  const grouped = {};
  
  records.forEach(record => {
    const date = new Date(record.timestamp);
    const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD format
    
    if (!grouped[dateKey]) {
      grouped[dateKey] = [];
    }
    grouped[dateKey].push(record);
  });
  
  return grouped;
};

/**
 * Calculate hours worked for a single day
 * @param {Array} dayRecords - Array of records for a single day
 * @returns {number|null} Hours worked or null if incomplete data
 */
const calculateDayHours = (dayRecords) => {
  // Sort records by timestamp
  const sorted = dayRecords.sort((a, b) => 
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  
  let checkIn = null;
  let checkOut = null;
  
  // Find the first check-in and last check-out of the day
  for (const record of sorted) {
    if (record.type === 'checkin' && !checkIn) {
      checkIn = new Date(record.timestamp);
    }
    if (record.type === 'checkout') {
      checkOut = new Date(record.timestamp);
    }
  }
  
  // If we have both check-in and check-out, calculate hours
  if (checkIn && checkOut) {
    const diffMs = checkOut - checkIn;
    const diffHours = diffMs / (1000 * 60 * 60);
    return diffHours;
  }
  
  return null;
};

/**
 * Filter records by date range
 * @param {Array} records - Array of attendance records
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Array} Filtered records
 */
const filterByDateRange = (records, startDate, endDate) => {
  return records.filter(record => {
    const recordDate = new Date(record.timestamp);
    return recordDate >= startDate && recordDate <= endDate;
  });
};

/**
 * Get date range for a period type
 * @param {string} period - 'daily', 'weekly', 'monthly', 'yearly', or 'all'
 * @returns {Object} Object with startDate and endDate
 */
export const getDateRange = (period = 'monthly') => {
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999); // End of today
  
  let startDate = new Date();
  
  switch (period) {
    case 'daily':
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'weekly':
      // Start of current week (Monday)
      const dayOfWeek = startDate.getDay();
      const diff = startDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      startDate = new Date(startDate.setDate(diff));
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'monthly':
      startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'yearly':
      startDate = new Date(startDate.getFullYear(), 0, 1);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'all':
      startDate = new Date(0); // Beginning of time
      break;
    default:
      startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      startDate.setHours(0, 0, 0, 0);
  }
  
  return { startDate, endDate };
};

/**
 * Calculate attendance rate for a user
 * @param {string} username - Username to calculate for
 * @param {string} period - Period type ('daily', 'weekly', 'monthly', 'yearly', 'all')
 * @returns {Promise<Object>} Object with attendance rate and details
 */
export const calculateAttendanceRate = async (username, period = 'monthly') => {
  try {
    const { startDate, endDate } = getDateRange(period);
    const records = await getUserAttendanceRecords(username);
    const filteredRecords = filterByDateRange(records, startDate, endDate);
    
    if (filteredRecords.length === 0) {
      return {
        rate: 0,
        totalDays: 0,
        presentDays: 0,
        period: period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      };
    }
    
    // Group records by date
    const groupedByDate = groupRecordsByDate(filteredRecords);
    
    // Count days with complete attendance (both check-in and check-out)
    let presentDays = 0;
    const dates = Object.keys(groupedByDate).sort();
    
    dates.forEach(date => {
      const dayRecords = groupedByDate[date];
      const hasCheckIn = dayRecords.some(r => r.type === 'checkin');
      const hasCheckOut = dayRecords.some(r => r.type === 'checkout');
      
      // A day is considered "present" if it has at least a check-in
      // For more strict calculation, require both check-in and check-out
      if (hasCheckIn) {
        presentDays++;
      }
    });
    
    // Calculate total working days in the period
    let totalDays = 0;
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      // Skip weekends (Saturday = 6, Sunday = 0)
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        totalDays++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // If no working days in period, use calendar days
    if (totalDays === 0) {
      totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    }
    
    const rate = totalDays > 0 ? (presentDays / totalDays) * 100 : 0;
    
    return {
      rate: Math.round(rate * 100) / 100, // Round to 2 decimal places
      totalDays,
      presentDays,
      period: period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    };
  } catch (error) {
    console.error('Error calculating attendance rate:', error);
    return {
      rate: 0,
      totalDays: 0,
      presentDays: 0,
      period: period,
      error: error.message
    };
  }
};

/**
 * Calculate average hours worked per day for a user
 * @param {string} username - Username to calculate for
 * @param {string} period - Period type ('daily', 'weekly', 'monthly', 'yearly', 'all')
 * @returns {Promise<Object>} Object with average hours and details
 */
export const calculateAverageHours = async (username, period = 'monthly') => {
  try {
    const { startDate, endDate } = getDateRange(period);
    const records = await getUserAttendanceRecords(username);
    const filteredRecords = filterByDateRange(records, startDate, endDate);
    
    if (filteredRecords.length === 0) {
      return {
        averageHours: 0,
        totalHours: 0,
        daysWorked: 0,
        period: period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      };
    }
    
    // Group records by date
    const groupedByDate = groupRecordsByDate(filteredRecords);
    
    let totalHours = 0;
    let daysWorked = 0;
    const dailyHours = [];
    
    // Calculate hours for each day
    Object.keys(groupedByDate).forEach(date => {
      const dayRecords = groupedByDate[date];
      const hours = calculateDayHours(dayRecords);
      
      if (hours !== null && hours > 0) {
        totalHours += hours;
        daysWorked++;
        dailyHours.push({
          date,
          hours: Math.round(hours * 100) / 100
        });
      }
    });
    
    const averageHours = daysWorked > 0 ? totalHours / daysWorked : 0;
    
    return {
      averageHours: Math.round(averageHours * 100) / 100, // Round to 2 decimal places
      totalHours: Math.round(totalHours * 100) / 100,
      daysWorked,
      period: period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      dailyHours: dailyHours.sort((a, b) => new Date(b.date) - new Date(a.date)) // Most recent first
    };
  } catch (error) {
    console.error('Error calculating average hours:', error);
    return {
      averageHours: 0,
      totalHours: 0,
      daysWorked: 0,
      period: period,
      error: error.message
    };
  }
};

/**
 * Get comprehensive analytics for a user
 * @param {string} username - Username to calculate for
 * @param {string} period - Period type ('daily', 'weekly', 'monthly', 'yearly', 'all')
 * @returns {Promise<Object>} Object with all analytics
 */
export const getUserAnalytics = async (username, period = 'monthly') => {
  try {
    const [attendanceRate, averageHours] = await Promise.all([
      calculateAttendanceRate(username, period),
      calculateAverageHours(username, period)
    ]);
    
    return {
      attendanceRate,
      averageHours,
      period
    };
  } catch (error) {
    console.error('Error getting user analytics:', error);
    return {
      attendanceRate: { rate: 0, totalDays: 0, presentDays: 0 },
      averageHours: { averageHours: 0, totalHours: 0, daysWorked: 0 },
      period,
      error: error.message
    };
  }
};

/**
 * Get analytics for all users (HR/Admin view)
 * @param {string} period - Period type ('daily', 'weekly', 'monthly', 'yearly', 'all')
 * @returns {Promise<Array>} Array of user analytics
 */
export const getAllUsersAnalytics = async (period = 'monthly', companyId = null) => {
  try {
    const tenantCid = requireValidCompanyId(companyId, 'analytics') || (await fetchSessionUserCompanyId(supabase));
    const records = await getAttendanceRecords(tenantCid);
    const { startDate, endDate } = getDateRange(period);
    const filteredRecords = filterByDateRange(records, startDate, endDate);
    
    // Get unique usernames
    const usernames = [...new Set(filteredRecords.map(r => r.username))];
    
    // Calculate analytics for each user
    const analytics = await Promise.all(
      usernames.map(async (username) => {
        const userAnalytics = await getUserAnalytics(username, period);
        return {
          username,
          ...userAnalytics
        };
      })
    );
    
    // Sort by attendance rate (descending)
    return analytics.sort((a, b) => 
      b.attendanceRate.rate - a.attendanceRate.rate
    );
  } catch (error) {
    console.error('Error getting all users analytics:', error);
    return [];
  }
};

/**
 * Format hours for display
 * @param {number|null|undefined} hours - Hours to format
 * @returns {string} Formatted string (e.g., "8.5h" or "8h 30m")
 */
export const formatHours = (hours) => {
  // Defensive: Handle null/undefined values
  if (hours == null || isNaN(hours)) {
    return '0h';
  }
  
  if (hours === 0) return '0h';
  
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  
  if (minutes === 0) {
    return `${wholeHours}h`;
  }
  
  return `${wholeHours}h ${minutes}m`;
};

/**
 * Format percentage for display
 * @param {number|null|undefined} percentage - Percentage to format
 * @returns {string} Formatted string (e.g., "85.5%")
 */
export const formatPercentage = (percentage) => {
  // Defensive: Handle null/undefined values to prevent "Cannot read property 'toFixed' of null"
  if (percentage == null || isNaN(percentage)) {
    return '0.0%';
  }
  return `${(percentage ?? 0).toFixed(1)}%`;
};

