/**
 * Email Service - Sends reports via Gmail SMTP using Nodemailer
 */
const nodemailer = require('nodemailer');
const fs = require('fs');
require('dotenv').config();

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER;

let transporterInstance = null;

function createTransporter() {
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn('⚠ SMTP credentials not configured. Email sending will be disabled.');
    console.warn('⚠ Please set SMTP_USER and SMTP_PASS environment variables.');
    return null;
  }

  if (!transporterInstance) {
    transporterInstance = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }

  return transporterInstance;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate, normalize, and deduplicate recipient email addresses.
 * @param {string|string[]} recipients
 * @returns {string[]}
 */
function validateRecipients(recipients) {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  const seen = new Set();
  const valid = [];
  const invalid = [];
  const duplicates = [];

  for (const entry of list) {
    if (entry == null || String(entry).trim() === '') {
      continue;
    }

    const trimmed = String(entry).trim();
    const key = trimmed.toLowerCase();

    if (!EMAIL_RE.test(trimmed)) {
      invalid.push(trimmed);
      continue;
    }

    if (seen.has(key)) {
      duplicates.push(trimmed);
      continue;
    }

    seen.add(key);
    valid.push(trimmed);
  }

  if (invalid.length > 0) {
    console.warn('[emailService] Skipping invalid addresses:', invalid.join(', '));
  }
  if (duplicates.length > 0) {
    console.warn('[emailService] Skipping duplicate addresses:', duplicates.join(', '));
  }

  return valid;
}

/**
 * Strip HTML tags for plain-text fallback.
 * @param {string} html
 * @returns {string}
 */
function htmlToPlainText(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function logEmailResult(status, { companyId, companyName, reportType, recipients, messageId, error, timestamp }) {
  const lines = [
    `[${status}]`,
    `Company: ${companyName || 'N/A'}${companyId ? ` (${companyId})` : ''}`,
    `Recipient: ${recipients.join(', ')}`,
    `Report: ${reportType || 'N/A'}`,
    `Timestamp: ${timestamp}`,
  ];

  if (status === 'SUCCESS') {
    lines.push(`SMTP messageId: ${messageId}`);
  } else {
    lines.push(`Error: ${error}`);
  }

  const output = lines.join('\n');
  if (status === 'SUCCESS') {
    console.log(output);
  } else {
    console.error(output);
  }
}

/**
 * Send an email via Gmail SMTP.
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient email address(es)
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML body
 * @param {string} [options.text] - Plain-text body (auto-generated from html if omitted)
 * @param {Array} [options.attachments] - Nodemailer attachments
 * @param {Object} [options.context] - Logging context
 * @param {string} [options.context.companyId]
 * @param {string} [options.context.companyName]
 * @param {string} [options.context.reportType]
 * @returns {Promise<Object>}
 */
async function sendEmail({ to, subject, html, text, attachments = [], context = {} }) {
  const transporter = createTransporter();

  if (!transporter) {
    throw new Error('Email service not configured. Please set SMTP_USER and SMTP_PASS environment variables.');
  }

  const recipients = validateRecipients(to);
  if (recipients.length === 0) {
    throw new Error('sendEmail: no valid recipient email addresses provided');
  }

  const fromAddress = EMAIL_FROM
    ? `Hadir.AI Reports <${EMAIL_FROM}>`
    : `Hadir.AI Reports <${SMTP_USER}>`;
  const sentAt = new Date().toISOString();
  const { companyId, companyName, reportType } = context;

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipients.join(', '),
      subject,
      html,
      text: text || htmlToPlainText(html),
      attachments,
    });

    logEmailResult('SUCCESS', {
      companyId,
      companyName,
      reportType,
      recipients,
      messageId: info.messageId,
      timestamp: sentAt,
    });

    return { success: true, messageId: info.messageId, recipients };
  } catch (error) {
    logEmailResult('FAILURE', {
      companyId,
      companyName,
      reportType,
      recipients,
      error: error.message,
      timestamp: sentAt,
    });
    throw error;
  }
}

/**
 * Send report via Gmail SMTP.
 * @param {string|string[]} to - One or more recipient email addresses
 * @param {string} subject - Email subject
 * @param {string} body - Email body (HTML)
 * @param {string} pdfPath - Path to PDF file
 * @param {string} pdfFilename - PDF filename for attachment
 * @param {Object} [context] - Logging context (companyId, companyName, reportType)
 * @returns {Promise<Object>} Email send result
 */
async function sendReportEmail(to, subject, body, pdfPath, pdfFilename, context = {}) {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  return sendEmail({
    to,
    subject,
    html: body,
    attachments: [
      {
        filename: pdfFilename,
        path: pdfPath,
      },
    ],
    context,
  });
}

/**
 * Generate email body for monthly report
 * @param {Object} reportData - Report data (must include reportData.company)
 * @returns {string} HTML email body
 */
function generateMonthlyReportEmailBody(reportData) {
  const companyName = reportData.company?.name || 'Your Company';
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .summary { background-color: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Monthly Attendance Report</h1>
        <h2 style="margin:4px 0;">${companyName}</h2>
        <p>${reportData.period.label}</p>
      </div>
      <div class="content">
        <h2>Report Summary</h2>
        <div class="summary">
          <p><strong>Company:</strong> ${companyName}</p>
          <p><strong>Total Employees:</strong> ${reportData.overall.totalEmployees}</p>
          <p><strong>Attendance Rate:</strong> ${reportData.overall.attendanceRate}</p>
          <p><strong>Pending Leave Requests:</strong> ${reportData.overall.pendingLeaves}</p>
          <p><strong>Open Tickets:</strong> ${reportData.overall.openTickets}</p>
        </div>
        <p>Please find the detailed report attached as a PDF.</p>
        <p>This is an automated report generated by Hadir.AI Attendance Management System.</p>
      </div>
      <div class="footer">
        <p>Hadir.AI - Attendance Management System</p>
        <p>This is an automated email. Please do not reply.</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generate email body for manual report
 * @param {Object} reportData - Report data (must include reportData.company)
 * @returns {string} HTML email body
 */
function generateManualReportEmailBody(reportData) {
  const companyName = reportData.company?.name || 'Your Company';
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .header { background-color: #2196F3; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .summary { background-color: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Attendance Report</h1>
        <h2 style="margin:4px 0;">${companyName}</h2>
        <p>${reportData.period.label}</p>
      </div>
      <div class="content">
        <h2>Report Summary</h2>
        <div class="summary">
          <p><strong>Company:</strong> ${companyName}</p>
          <p><strong>Total Employees:</strong> ${reportData.overall.totalEmployees}</p>
          <p><strong>Attendance Rate:</strong> ${reportData.overall.attendanceRate}</p>
          <p><strong>Pending Leave Requests:</strong> ${reportData.overall.pendingLeaves}</p>
          <p><strong>Open Tickets:</strong> ${reportData.overall.openTickets}</p>
        </div>
        <p>Please find the detailed report attached as a PDF.</p>
        <p>This report was generated on request from the Hadir.AI Admin Dashboard.</p>
      </div>
      <div class="footer">
        <p>Hadir.AI - Attendance Management System</p>
        <p>This is an automated email. Please do not reply.</p>
      </div>
    </body>
    </html>
  `;
}

module.exports = {
  sendEmail,
  sendReportEmail,
  validateRecipients,
  generateMonthlyReportEmailBody,
  generateManualReportEmailBody,
};
