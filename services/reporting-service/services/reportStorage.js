/**
 * Report Storage Service
 * File-backed persistent storage with JSON index (survives restarts on single instance)
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../data/reports');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const REPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadIndex() {
  ensureDataDir();
  if (!fs.existsSync(INDEX_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  } catch (err) {
    console.error('[ReportStorage] Failed to load index, resetting:', err.message);
    return {};
  }
}

function saveIndex(index) {
  ensureDataDir();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
}

function generateReportId() {
  return uuidv4();
}

function cleanupExpiredFromIndex(index) {
  const now = Date.now();
  let changed = false;
  for (const [id, report] of Object.entries(index)) {
    if (new Date(report.expiresAt).getTime() < now) {
      if (report.filePath && fs.existsSync(report.filePath)) {
        try { fs.unlinkSync(report.filePath); } catch (_) {}
      }
      delete index[id];
      changed = true;
    }
  }
  if (changed) saveIndex(index);
  return index;
}

/**
 * Store report metadata
 */
function storeReport(metadata) {
  const index = cleanupExpiredFromIndex(loadIndex());
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REPORT_RETENTION_MS);

  const record = {
    reportId: metadata.reportId,
    companyId: metadata.companyId,
    companyName: metadata.companyName,
    generatedBy: metadata.generatedBy || 'System',
    generatedAt: now.toISOString(),
    reportType: metadata.reportType,
    periodLabel: metadata.periodLabel || null,
    filePath: metadata.filePath,
    fileSize: metadata.fileSize || 0,
    emailStatus: metadata.emailStatus || 'not_sent',
    generationStatus: metadata.generationStatus || 'completed',
    expiresAt: expiresAt.toISOString(),
    reportData: metadata.reportData || null,
  };

  index[metadata.reportId] = record;
  saveIndex(index);

  console.log(`[ReportStorage] Stored report ${metadata.reportId} (${metadata.fileSize} bytes) for ${metadata.companyName}`);
  return record;
}

function getReport(reportId) {
  const index = cleanupExpiredFromIndex(loadIndex());
  return index[reportId] || null;
}

function updateReport(reportId, updates) {
  const index = cleanupExpiredFromIndex(loadIndex());
  if (!index[reportId]) return null;
  index[reportId] = { ...index[reportId], ...updates };
  saveIndex(index);
  return index[reportId];
}

function deleteReport(reportId, deleteFileCallback = null) {
  const index = cleanupExpiredFromIndex(loadIndex());
  const report = index[reportId];
  if (!report) return false;

  if (deleteFileCallback && report.filePath) {
    try { deleteFileCallback(report.filePath); } catch (err) {
      console.error(`[ReportStorage] Error deleting file for ${reportId}:`, err.message);
    }
  } else if (report.filePath && fs.existsSync(report.filePath)) {
    try { fs.unlinkSync(report.filePath); } catch (_) {}
  }

  delete index[reportId];
  saveIndex(index);
  console.log(`[ReportStorage] Deleted report ${reportId}`);
  return true;
}

function getReportsByCompany(companyId, limit = 50) {
  const index = cleanupExpiredFromIndex(loadIndex());
  return Object.values(index)
    .filter((r) => r.companyId === companyId)
    .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))
    .slice(0, limit)
    .map(toPublicRecord);
}

function getLatestReport(companyId) {
  const reports = getReportsByCompany(companyId, 1);
  return reports[0] || null;
}

function toPublicRecord(report) {
  return {
    reportId: report.reportId,
    companyId: report.companyId,
    companyName: report.companyName,
    generatedBy: report.generatedBy,
    generatedAt: report.generatedAt,
    reportType: report.reportType,
    periodLabel: report.periodLabel,
    fileSize: report.fileSize,
    emailStatus: report.emailStatus,
    generationStatus: report.generationStatus,
    expiresAt: report.expiresAt,
  };
}

function cleanupExpiredReports(deleteFileCallback = null) {
  const index = loadIndex();
  const now = Date.now();
  let cleaned = 0;

  for (const [reportId, report] of Object.entries(index)) {
    if (new Date(report.expiresAt).getTime() < now) {
      deleteReport(reportId, deleteFileCallback);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[ReportStorage] Cleaned up ${cleaned} expired report(s)`);
  }
  return cleaned;
}

function getAllReports() {
  return Object.values(cleanupExpiredFromIndex(loadIndex()));
}

function getStorageStats() {
  const index = cleanupExpiredFromIndex(loadIndex());
  return { totalReports: Object.keys(index).length };
}

function verifyReportAccess(report, companyId) {
  return report && report.companyId === companyId;
}

module.exports = {
  generateReportId,
  storeReport,
  getReport,
  updateReport,
  deleteReport,
  getReportsByCompany,
  getLatestReport,
  cleanupExpiredReports,
  getAllReports,
  getStorageStats,
  verifyReportAccess,
  toPublicRecord,
  REPORT_RETENTION_MS,
  DATA_DIR,
};
