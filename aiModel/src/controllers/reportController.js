const fs = require('fs-extra');
const path = require('path');
const ScanResult = require('../../../model/results.model');
const logger = require('../../../utils/logger.utils');
const { prepareDataForAI } = require('../utils/ai-cleaner.utils');
const { generateReportContent } = require('../utils/ollama.service');
const { generateAndSavePDF } = require('../services/pdf.service');

exports.generateAndDownloadPDF = async (req, res) => {
    const { scanId } = req.params;
    const { regenerate, reanalyze } = req.query;

    try {
        logger?.info(`📄 Report request | ScanID=${scanId}`);

        /* ===============================
           1️⃣ Load Scan + Authorization
           =============================== */
        // const scan = await ScanResult.findById(scanId).populate('url');

        // if (!scan) {
        //     return res.status(404).json({ message: 'Scan not found' });
        // }

        // // 🔐 Authorization (IDOR Protection)
        // if (scan.user && scan.user.toString() !== req.user.id) {
        //     return res.status(403).json({
        //         message: 'You are not authorized to access this report'
        //     });
        // }


        // داخل دالة generateAndDownloadPDF في reportController.js
const scan = await ScanResult.findById(scanId).populate('url');

if (!scan) {
    return res.status(404).json({ message: 'Scan not found' });
}

// 🔐 الآن هذا الفحص سيعمل بشكل صحيح لأن الحقل أصبح موجوداً في الموديل
if (scan.user && scan.user.toString() !== req.user.id) {
    return res.status(403).json({
        message: 'You are not authorized to access this report'
    });
}

        const targetUrl = scan.url?.originalUrl || 'Target Website';

        /* ===============================
           2️⃣ Decide AI Cache Strategy
           =============================== */
        let markdownContent = scan.aiReportContent || '';

        const shouldReanalyze = reanalyze === true || reanalyze === 'true';

        if (!markdownContent || markdownContent.length < 200 || shouldReanalyze) {
            logger?.info('🤖 Running AI analysis');

            const scanDetails = Array.isArray(scan.details)
                ? scan.details
                : [];

            const cleanedData = prepareDataForAI(scanDetails);

            markdownContent = await generateReportContent(
                targetUrl,
                cleanedData
            );

            // Validation
            if (
                !markdownContent ||
                markdownContent.includes('REPORT GENERATION FAILED')
            ) {
                throw new Error('AI report generation failed');
            }

            scan.aiReportContent = markdownContent;
            await scan.save();
        } else {
            logger?.info('🚀 Using cached AI report');
        }

        /* ===============================
           3️⃣ PDF Cache Strategy
           =============================== */
        const reportsDir = path.join(__dirname, '../../ai_PDF');
        let reportPath = null;

        if (scan.pdfFilename) {
            reportPath = path.join(reportsDir, scan.pdfFilename);
        }

        const shouldRegeneratePDF =
            regenerate === true ||
            regenerate === 'true' ||
            shouldReanalyze ||
            !reportPath ||
            !(await fs.pathExists(reportPath));

        if (shouldRegeneratePDF) {
            logger?.info('📄 Generating PDF');

            const result = await generateAndSavePDF(
                markdownContent,
                targetUrl
            );

            scan.pdfFilename = result.filename;
            await scan.save();

            reportPath = result.reportPath;
        }

        /* ===============================
           4️⃣ Final Safety Check
           =============================== */
        if (!reportPath || !(await fs.pathExists(reportPath))) {
            throw new Error('PDF file not found after generation');
        }

        logger?.info(`⬇️ Downloading PDF | ${scan.pdfFilename}`);
        return res.download(reportPath);

    } catch (error) {
        logger?.error(`💥 Report Error | ${error.message}`);
        return res.status(500).json({
            message: 'Report generation failed',
            error: error.message
        });
    }
};
