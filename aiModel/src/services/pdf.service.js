const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { marked } = require('marked');
const logger = require('../../../utils/logger.utils');

/**
 * Extract company / target name from URL
 */
const getCompanyName = (targetUrl) => {
    try {
        const urlObj = new URL(targetUrl);
        const hostname = urlObj.hostname.replace(/^www\./, '');
        const parts = hostname.split('.');
        return parts.length >= 2 ? parts.slice(0, 2).join('.') : hostname;
    } catch {
        return targetUrl.replace(/[^a-z0-9]/gi, '_');
    }
};

// ================= GLOBAL BROWSER INSTANCE (SINGLETON) =================
let sharedBrowser = null;

const getBrowser = async () => {
    if (!sharedBrowser || !sharedBrowser.isConnected()) {
        sharedBrowser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
    }
    return sharedBrowser;
};

/**
 * Generate & Save PDF Report (FINAL STABLE VERSION)
 */
exports.generateAndSavePDF = async (markdownContent, targetUrl) => {
    let page;

    try {
        /* ================= VALIDATION ================= */
        if (
            !markdownContent ||
            markdownContent.includes('REPORT GENERATION FAILED') ||
            markdownContent.length < 500
        ) {
            throw new Error('Invalid or incomplete report content');
        }

        /* ================= DIRECTORIES ================= */
        const reportsDir = path.join(__dirname, '../../ai_PDF');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        /* ================= FILE NAME ================= */
        const companyName = getCompanyName(targetUrl);
        const safeName = companyName.replace(/[^a-z0-9.-]/gi, '_').toLowerCase();

        let filename = `${safeName}.pdf`;
        let reportPath = path.join(reportsDir, filename);
        let counter = 1;

        while (fs.existsSync(reportPath)) {
            filename = `${safeName} (${counter}).pdf`;
            reportPath = path.join(reportsDir, filename);
            counter++;
        }

        /* ================= MARKDOWN → HTML ================= */
        const reportHtml = marked.parse(markdownContent);

        const cssPath = path.join(__dirname, '../../reports/report.css');
        
        // Helper: Async Image Loader
        const loadBase64ImageAsync = async (filename) => {
            const filePath = path.join(__dirname, '../../reports', filename);
            try {
                const buffer = await fs.promises.readFile(filePath);
                return `data:image/png;base64,${buffer.toString('base64')}`;
            } catch (err) {
                return '';
            }
        };

        // Load assets in parallel (Non-Blocking)
        const [css, logoLeft, logoRight] = await Promise.all([
            fs.promises.readFile(cssPath, 'utf8').catch(() => ''),
            loadBase64ImageAsync('logo-fcis.png'),
            loadBase64ImageAsync('logo-october.png')
        ]);

        const generatedAt = new Date().toLocaleString('en-US', {
            timeZone: 'Africa/Cairo'
        });

        /* ================= FULL HTML ================= */
        const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
${css}

/* === COVER FIX === */
.cover-page {
    position: relative;
    padding-top: 40px;
    padding-bottom: 40px;
    height: 90vh; /* جعل الغلاف يأخذ طول الصفحة */
    page-break-after: always; /* إجبار الانتقال لصفحة جديدة بعد الغلاف */
}

.cover-logo {
    position: absolute;
    top: 20px;
    width: 100px;
}

.cover-logo-left { left: 20px; }
.cover-logo-right { right: 20px; }

.cover-content {
    margin-top: 200px;
    text-align: center;
}


/* === FOOTER INLINE (SAFE) === */
.report-footer {
    margin-top: 60px;
    padding-top: 8px;
    border-top: 1px solid #ddd;
    font-size: 9px;
    color: #555;
    display: flex;
    justify-content: space-between;
}
</style>
</head>

<body>

<!-- ================= COVER ================= -->
<div class="cover-page">
    <img src="${logoLeft}" class="cover-logo cover-logo-left" />
    <img src="${logoRight}" class="cover-logo cover-logo-right" />

    <div class="cover-content">
        <h1>🔒 PENETRATION TESTING REPORT</h1>
        <hr/>
        <p><strong>Client:</strong> ${companyName}</p>
        <p><strong>Target:</strong> ${targetUrl}</p>
        <p><strong>Generated:</strong> ${generatedAt}</p>
        <p><strong>Classification:</strong> CONFIDENTIAL</p>
    </div>
</div>

<!-- ================= REPORT BODY ================= -->
${reportHtml}
</body>
</html>
`;

        /* ================= PUPPETEER ================= */
        const browser = await getBrowser();
        page = await browser.newPage();

        await page.setContent(html, {
            waitUntil: 'domcontentloaded',
            timeout: 180000
        });

        await page.pdf({
            path: reportPath,
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true, // تفعيل الفوتر الأصلي
            headerTemplate: '<div></div>', // هيدر فارغ
            footerTemplate: `
                <div style="font-size: 9px; font-family: Helvetica, Arial, sans-serif; color: #555; width: 100%; border-top: 1px solid #ddd; padding-top: 5px; margin-left: 40px; margin-right: 40px; display: flex; justify-content: space-between;">
                    <span>VulnCraft – Security Assessment Project</span>
                    <span>CONFIDENTIAL | Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
                </div>
            `,
            margin: {
                top: '40px',
                bottom: '60px', // زيادة الهامش السفلي لاستيعاب الفوتر
                left: '40px',
                right: '40px'
            }
        });

        await page.close(); // Close the TAB, not the browser

        logger?.info(`📄 PDF Generated Successfully: ${filename}`);
        return { filename, reportPath };

    } catch (error) {
        if (page) await page.close().catch(() => {}); // Ensure page is closed on error

        // If browser crashed, reset singleton to force restart next time
        if (error.message.includes('Target closed') || error.message.includes('Protocol error')) {
            if (sharedBrowser) {
                try { await sharedBrowser.close(); } catch {}
                sharedBrowser = null;
            }
        }

        logger?.error(`❌ PDF Generation Error: ${error.message}`);
        throw error;
    }
};

exports.getCompanyName = getCompanyName;