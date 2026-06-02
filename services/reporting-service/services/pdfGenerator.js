/**
 * PDF Generator - Creates professional PDF reports
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate PDF report from report data
 * @param {Object} reportData - Formatted report data
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generatePDF(reportData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
      });

      const chunks = [];
      
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(24)
         .font('Helvetica-Bold')
         .text('Attendance Management Report', { align: 'center' })
         .moveDown(0.3);

      if (reportData.company?.name) {
        doc.fontSize(14)
           .font('Helvetica-Bold')
           .text(reportData.company.name, { align: 'center' })
           .moveDown(0.3);
      }

      doc.fontSize(12)
         .font('Helvetica')
         .text(`Period: ${reportData.period.label}`, { align: 'center' })
         .moveDown(1);

      // Overall Summary Section
      doc.fontSize(16)
         .font('Helvetica-Bold')
         .text('Overall Summary', { underline: true })
         .moveDown(0.5);

      doc.fontSize(11)
         .font('Helvetica')
         .text(`Total Employees: ${reportData.overall.totalEmployees}`)
         .text(`Attendance Rate: ${reportData.overall.attendanceRate}`)
         .text(`Pending Leave Requests: ${reportData.overall.pendingLeaves}`)
         .text(`Open Tickets: ${reportData.overall.openTickets}`)
         .moveDown(1);

      // Department-wise Statistics
      if (reportData.departments && reportData.departments.length > 0) {
        doc.fontSize(16)
           .font('Helvetica-Bold')
           .text('Department-wise Statistics', { underline: true })
           .moveDown(0.5);

        // Table header
        doc.fontSize(10)
           .font('Helvetica-Bold')
           .text('Department', 50, doc.y)
           .text('Employees', 200, doc.y)
           .text('Attendance', 280, doc.y)
           .text('Leaves', 360, doc.y)
           .text('Tickets', 420, doc.y)
           .moveDown(0.3);

        // Draw line
        doc.moveTo(50, doc.y)
           .lineTo(500, doc.y)
           .stroke()
           .moveDown(0.3);

        // Table rows
        doc.font('Helvetica');
        reportData.departments.forEach((dept, index) => {
          // Check if we need a new page
          if (doc.y > 700) {
            doc.addPage();
          }

          doc.fontSize(10)
             .text(dept.name || 'N/A', 50, doc.y)
             .text(String(dept.employees || 0), 200, doc.y)
             .text(dept.attendanceRate || '0%', 280, doc.y)
             .text(String(dept.leaves || 0), 360, doc.y)
             .text(String(dept.tickets || 0), 420, doc.y)
             .moveDown(0.4);
        });
      }

      // Footer
      const pageCount = doc.bufferedPageRange();
      for (let i = 0; i < pageCount.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8)
           .font('Helvetica')
           .text(
             `Generated on: ${new Date().toLocaleString()}`,
             50,
             doc.page.height - 30,
             { align: 'left' }
           );
        doc.text(
          `Page ${i + 1} of ${pageCount.count}`,
          doc.page.width - 50,
          doc.page.height - 30,
          { align: 'right' }
        );
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Save PDF to temporary file
 * @param {Buffer} pdfBuffer - PDF buffer
 * @param {string} filename - Filename
 * @returns {Promise<string>} File path
 */
async function savePDFToFile(pdfBuffer, filename) {
  return new Promise((resolve, reject) => {
    try {
      const tempDir = path.join(__dirname, '../../temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const filePath = path.join(tempDir, filename);
      fs.writeFile(filePath, pdfBuffer, (err) => {
        if (err) reject(err);
        else resolve(filePath);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Delete temporary PDF file
 * @param {string} filePath - File path
 */
function deletePDFFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Error deleting PDF file:', error);
  }
}

module.exports = {
  generatePDF,
  savePDFToFile,
  deletePDFFile,
};

