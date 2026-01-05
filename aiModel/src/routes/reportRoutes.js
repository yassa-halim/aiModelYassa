const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticate } = require('../../../middlewares/auth.middleware');

/* ===============================
   🔐 Validate MongoDB ObjectId
   =============================== */
const validateObjectId = (req, res, next) => {
    const { scanId } = req.params;

    if (!scanId) {
        return res.status(400).json({
            message: 'Scan ID is required'
        });
    }

    if (!/^[0-9a-fA-F]{24}$/.test(scanId)) {
        return res.status(400).json({
            message: 'Invalid Scan ID format'
        });
    }

    next();
};

/* ===============================
   ⚙️ Validate regenerate flag
   =============================== */
const validateRegenerateFlag = (req, res, next) => {
    if (req.query.regenerate !== undefined) {
        const value = req.query.regenerate;

        if (!['true', 'false'].includes(value)) {
            return res.status(400).json({
                message: 'Invalid regenerate flag. Use true or false.'
            });
        }

        // نحوله boolean عشان الكنترولر
        req.query.regenerate = value === 'true';
    }

    next();
};

/* ===============================
   🛡️ Safe Controller Wrapper
   =============================== */
const safeAsync = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

/* ===============================
   📄 GET Report PDF
   =============================== */
/**
 * GET /api/report/:scanId
 * Optional Query:
 *   ?regenerate=true|false
 *
 * Middlewares:
 * - authenticate: user must be logged in
 * - validateObjectId: prevent invalid Mongo IDs
 * - validateRegenerateFlag: clean regenerate logic
 */
router.get(
    '/:scanId',
    authenticate,
    validateObjectId,
    validateRegenerateFlag,
    safeAsync(reportController.generateAndDownloadPDF)
);

module.exports = router;
