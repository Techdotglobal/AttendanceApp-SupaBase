/**
 * Date utility functions for report generation
 */

/**
 * Get date range based on report type
 * @param {string} range - 'daily', 'weekly', 'monthly', 'yearly', 'all', or 'custom'
 * @param {string} from - Custom start date (ISO format) - optional
 * @param {string} to - Custom end date (ISO format) - optional
 * @returns {Object} { from: Date, to: Date }
 */
function getDateRange(range, from = null, to = null) {
  const now = new Date();
  let fromDate;
  let toDate;

  switch (range) {
    case 'daily':
      fromDate = new Date(now);
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date(now);
      toDate.setHours(23, 59, 59, 999);
      break;

    case 'weekly':
      toDate = new Date(now);
      toDate.setHours(23, 59, 59, 999);
      fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - 7);
      fromDate.setHours(0, 0, 0, 0);
      break;

    case 'monthly':
      fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date(now.getFullYear(), now.getMonth(), 0);
      toDate.setHours(23, 59, 59, 999);
      break;

    case 'yearly':
      fromDate = new Date(now.getFullYear() - 1, 0, 1);
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date(now.getFullYear() - 1, 11, 31);
      toDate.setHours(23, 59, 59, 999);
      break;

    case 'all':
      fromDate = new Date(2000, 0, 1);
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date(now);
      toDate.setHours(23, 59, 59, 999);
      break;

    case 'custom':
      if (!from || !to) {
        throw new Error('Custom range requires both from and to dates');
      }
      fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      break;

    default:
      throw new Error(`Invalid range type: ${range}`);
  }

  return { from: fromDate, to: toDate };
}

/**
 * Format date for display
 * @param {Date} date - Date object
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Get month name from date
 * @param {Date} date - Date object
 * @returns {string} Month name
 */
function getMonthName(date) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return months[date.getMonth()];
}

/**
 * Get period label for report
 * @param {string} range - Report range type
 * @param {Date} from - Start date
 * @param {Date} to - End date
 * @returns {string} Period label
 */
function getPeriodLabel(range, from, to) {
  switch (range) {
    case 'daily':
      return formatDate(from);
    case 'weekly':
      return `Week of ${formatDate(from)} to ${formatDate(to)}`;
    case 'monthly':
      return `${getMonthName(from)} ${from.getFullYear()}`;
    case 'yearly':
      return `Year ${from.getFullYear()}`;
    case 'all':
      return 'All Time';
    case 'custom':
      return `${formatDate(from)} to ${formatDate(to)}`;
    default:
      return `${formatDate(from)} to ${formatDate(to)}`;
  }
}

module.exports = {
  getDateRange,
  formatDate,
  getMonthName,
  getPeriodLabel,
};
