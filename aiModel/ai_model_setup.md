# 🚀 AI Model & Reporting System Setup

هذا الملف يحتوي على التوثيق الكامل والأكواد المحدثة (Production-Grade) لتشغيل نظام تحليل الثغرات بالذكاء الاصطناعي وتوليد تقارير PDF، مع دعم البيانات الخام (Raw Data) وبدون فقدان للتفاصيل.

---

## 📂 1. أدوات الفحص (Shared Utilities)

### 📄 المسار: `../utils/scan.utils.js`

**الوظيفة:** تشغيل سكربتات البايثون وإدارة العمليات.

```javascript
const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");

const SCRIPTS_DIR = path.join(__dirname, "../vulnerabilityFiles");
const OUTPUT_DIR = path.join(__dirname, "../scan_results");
const TEMP_DIR = path.join(__dirname, "../temp_payloads");

// التأكد من وجود المجلدات
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

let cachedPythonCommand = null;

exports.getPythonCommand = () => {
  if (cachedPythonCommand) return cachedPythonCommand;
  const commandsToCheck = ["python3", "python", "py"];
  for (const cmd of commandsToCheck) {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore" });
      cachedPythonCommand = cmd;
      return cmd;
    } catch (error) {
      continue;
    }
  }
  cachedPythonCommand = process.platform === "win32" ? "py" : "python3";
  return cachedPythonCommand;
};

exports.createTempPayload = (targetUrl, vulnId) => {
  const filename = `payload_${vulnId}_${Date.now()}.json`;
  const filePath = path.join(TEMP_DIR, filename);
  const taskData = {
    task_id: `scan-${vulnId}`,
    target: { url: targetUrl },
    base_url: targetUrl,
    options: { non_destructive: true },
  };
  fs.writeFileSync(filePath, JSON.stringify(taskData, null, 2));
  return filePath;
};

exports.runScriptWorker = (scriptFileName, payloadPath, pythonCmd) => {
  return new Promise((resolve) => {
    const scriptFullPath = path.join(SCRIPTS_DIR, scriptFileName);

    if (!fs.existsSync(scriptFullPath)) {
      return resolve({ error: "Script file missing", vulnerable: false });
    }

    const cmd = pythonCmd || "python";
    const python = spawn(cmd, [
      "-u",
      scriptFullPath,
      "--payload",
      payloadPath,
      "--outdir",
      OUTPUT_DIR,
    ]);

    const TIMEOUT_MS = 7 * 60 * 1000;
    const timeout = setTimeout(() => {
      python.kill();
      console.error(`[Timeout] Script took too long: ${scriptFullPath}`);
      resolve({ error: "Scan timeout exceeded", vulnerable: false });
    }, TIMEOUT_MS);

    let outputData = "";
    python.stdout.on("data", (data) => {
      outputData += data.toString();
    });
    python.stderr.on("data", (err) => console.error(`[Py Log]: ${err}`));

    python.on("close", (code) => {
      clearTimeout(timeout);
      try {
        fs.unlinkSync(payloadPath);
      } catch (e) {}
      try {
        const firstBrace = outputData.indexOf("{");
        const lastBrace = outputData.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1) {
          resolve(JSON.parse(outputData.substring(firstBrace, lastBrace + 1)));
        } else {
          resolve({ error: "No JSON output", vulnerable: false });
        }
      } catch (e) {
        resolve({ error: "JSON Parse Error", vulnerable: false });
      }
    });
  });
};
```

---

## 🧠 2. وحدة الذكاء الاصطناعي (AI Model Module)

### 📄 المسار: `aiModel/src/utils/prompts.js`

**الوظيفة:** القالب (Prompt) المحدث ليفهم البيانات الخام ويستخرج منها الأدلة دون تجاهل الأخطاء.

```javascript
exports.REPORT_PROMPT = `
ROLE:
You are an Expert Senior Security Researcher preparing a deep-dive technical assessment report
based on automated testing results and structured technical observations.

You are NOT confirming exploitation.
You are documenting observed behaviors and assessing potential security relevance
based on the strength of available evidence.

OBJECTIVE:
Generate a clear, conservative, and professional security report that can be
understood by non-technical stakeholders while remaining technically credible
to security professionals.

INPUT DATA (RAW SCANNER OUTPUT):
{{DATA}}

MANDATORY RULES (STRICT):
1. Use ONLY the provided input data. Do NOT invent findings, endpoints, or impacts.
2. Describe findings strictly as OBSERVED BEHAVIOR, not confirmed vulnerabilities.
3. NEVER claim successful exploitation.
4. Adjust language based on evidence_confidence:
   - High: Use phrases like "strong indicators suggest".
   - Low: Use phrases like "observed behavior is inconclusive and requires manual validation".
5. Wrap EACH finding section inside the following HTML container exactly:
   <div class="finding-block">
   ...
   </div>
6. DO NOT IGNORE ERRORS: If the raw data contains "Request error", "timeout", or connection issues, document them as "Inconclusive - Technical Error".
7. ANALYZE the payloads: If a payload caused a delay, describe it as "Time-Based".
8. IF INPUT DATA IS EMPTY: Explicitly state that "No automated security vulnerabilities were detected."

---

## DOCUMENT INFORMATION
| Item | Value |
|------|------|
| Report Type | Evidence-Based Security Assessment |
| Target | {{TARGET_URL}} |
| Assessment Date | {{DATE}} |
| Generated By | VulnCraft AI |

---

## 1. EXECUTIVE SUMMARY
### 1.1 Assessment Overview
Provide a concise overview including total findings and highest severity.

### 1.2 Key Observations
Summarize the most relevant security-related behaviors observed.

---

<div class="page-break-before"></div>

## 3. OBSERVED SECURITY FINDINGS

For EACH finding in the input data, generate:

<div class="finding-block">
### {{title}}
- **Finding ID:** {{id}}
- **Severity Level:** {{severity}}
- **Evidence Confidence:** {{evidence_confidence}}

#### Observation Summary
Describe the observed behavior.

#### Technical Evidence
The input data contains raw technical findings. Analyze them to extract:
- **Endpoint:** (Extract URL/Path from raw data)
- **HTTP Method:** (GET/POST/etc.)
- **Parameter:** (The vulnerable parameter)
- **Payload:** (The specific payload used)
- **Evidence:** (Key indicators from the raw response/behavior)
</div>

---

<div class="page-break-before"></div>

## 4. FINDINGS SUMMARY
Provide a table listing all findings.

---

## 5. REMEDIATION & VALIDATION GUIDANCE
Provide specific and targeted actions for each finding.

---

## 6. OVERALL ASSESSMENT VERDICT
State whether immediate remediation is required or manual validation is recommended.

---

END OF REPORT
`;
```

### 📄 المسار: `aiModel/src/utils/ai-cleaner.utils.js`

**الوظيفة:** تنظيف وتجهيز البيانات قبل إرسالها للـ AI.

```javascript
exports.prepareDataForAI = (scanDetails) => {
  if (!scanDetails || !Array.isArray(scanDetails)) return [];

  return scanDetails.map((vuln) => {
    const techSummary = vuln.technicalDetail || {};

    // استخراج قائمة الثغرات المكتشفة
    let findings = [];
    if (techSummary.findings && Array.isArray(techSummary.findings)) {
      findings = techSummary.findings;
    }

    return {
      title: vuln.vulnerabilityName || "Unknown Vulnerability",
      severity: vuln.severity || "Low",
      count: findings.length > 0 ? findings.length : vuln.isDetected ? 1 : 0,
      // 🔥 السرعة هنا: نأخذ أول 5 أمثلة فقط بدلاً من الملف بالكامل
      samples: findings.slice(0, 5).map((f) => ({
        url: f.detail?.url || f.url || "N/A",
        param: f.detail?.param || f.param || "N/A",
      })),
    };
  });
};
```

### 📄 المسار: `aiModel/src/utils/ollama.service.js`

**الوظيفة:** الاتصال بخدمة Ollama وتوليد التقرير.

```javascript
const axios = require("axios");
const logger = require("../../../utils/logger.utils");
const { REPORT_PROMPT } = require("./prompts");

// 🔥 طابور الانتظار: لضمان عدم تشغيل أكثر من عملية AI في نفس الوقت
let requestQueue = Promise.resolve();

exports.generateReportContent = async (targetUrl, cleanedData) => {
  const currentTask = async () => {
    // 1. هندسة الأوامر
    const prompt = REPORT_PROMPT.replace(
      "{{DATA}}",
      JSON.stringify(cleanedData, null, 2)
    )
      .replace("{{TARGET_URL}}", targetUrl)
      .replace("{{DATE}}", new Date().toISOString().split("T")[0]);

    try {
      if (logger)
        logger.info(
          `🤖 Generating Professional Article using Hybrid Mode for: ${targetUrl}`
        );

      const response = await axios.post(
        "http://localhost:11434/api/generate",
        {
          model: "llama3.1",
          prompt: prompt,
          stream: false,
          options: {
            num_ctx: 4096,
            num_gpu: 11,
            temperature: 0.2,
            top_p: 0.9,
            repeat_penalty: 1.1,
            num_thread: 8,
            num_predict: -1,
          },
        },
        {
          timeout: 1200000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );

      if (response.data && response.data.response) {
        if (logger)
          logger.info(`✅ Article Generated Successfully (Hybrid Mode)`);
        return response.data.response;
      } else {
        throw new Error("Received empty response from AI Model");
      }
    } catch (error) {
      const errMsg = error.message;
      if (logger && logger.error) logger.error(`AI Service Error: ${errMsg}`);
      return `# Report Generation Failed\n**Error:** ${errMsg}`;
    }
  };

  const result = requestQueue.then(currentTask);
  requestQueue = result.catch(() => {});
  return result;
};
```

---

## 📄 3. خدمات التقارير (Services)

### 📄 المسار: `aiModel/src/services/pdf.service.js`

**الوظيفة:** تحويل النص إلى PDF وتسمية الملفات.

```javascript
const fs = require("fs");
const path = require("path");
const markdownpdf = require("markdown-pdf");
const logger = require("../../../utils/logger.utils");

// دالة مساعدة لاستخراج اسم الشركة
const getCompanyName = (targetUrl) => {
  try {
    const urlObj = new URL(targetUrl);
    const hostname = urlObj.hostname.replace(/^www\./, "");
    const parts = hostname.split(".");
    if (parts.length >= 2) {
      return parts.slice(0, 2).join(".");
    }
    return hostname;
  } catch (e) {
    return targetUrl.replace(/[^a-z0-9]/gi, "_");
  }
};

exports.generateAndSavePDF = (markdownContent, targetUrl) => {
  return new Promise((resolve, reject) => {
    try {
      const reportsDir = path.join(__dirname, "../../ai_PDF");
      if (!fs.existsSync(reportsDir))
        fs.mkdirSync(reportsDir, { recursive: true });

      const companyName = getCompanyName(targetUrl);
      const safeName = companyName.replace(/[^a-z0-9.-]/gi, "_").toLowerCase();

      let filename = `${safeName}.pdf`;
      let reportPath = path.join(reportsDir, filename);

      let counter = 1;
      while (fs.existsSync(reportPath)) {
        filename = `${safeName} (${counter}).pdf`;
        reportPath = path.join(reportsDir, filename);
        counter++;
      }

      const cssPath = path.join(__dirname, "../../reports/report.css");
      const options = {
        cssPath: fs.existsSync(cssPath) ? cssPath : null,
        paperFormat: "A4",
      };

      markdownpdf(options)
        .from.string(markdownContent)
        .to(reportPath, function () {
          if (logger) logger.info(`✅ PDF Saved locally: ${filename}`);
          resolve({ filename, reportPath });
        });
    } catch (error) {
      if (logger) logger.error(`❌ PDF Generation Error: ${error.message}`);
      reject(error);
    }
  });
};

exports.getCompanyName = getCompanyName;
```

---

## 🎮 4. وحدات التحكم والراوتر (Controllers & Routes)

### 📄 المسار: `aiModel/src/controllers/reportController.js`

**الوظيفة:** إدارة طلبات تحميل التقارير.

```javascript
const fs = require("fs-extra");
const path = require("path");
const ScanResult = require("../../../model/results.model");
const logger = require("../../../utils/logger.utils");
const { prepareDataForAI } = require("../utils/ai-cleaner.utils");
const { generateReportContent } = require("../utils/ollama.service");
const { generateAndSavePDF } = require("../services/pdf.service");

exports.generateAndDownloadPDF = async (req, res) => {
  const { scanId } = req.params;

  try {
    if (logger) logger.info(`📄 Requesting PDF for Scan ID: ${scanId}`);

    const scan = await ScanResult.findById(scanId).populate("url");
    if (!scan) return res.status(404).json({ message: "Scan not found" });

    const targetUrl = scan.url ? scan.url.originalUrl : "Target Website";
    let markdownContent = "";
    let filenameToDownload = scan.pdfFilename;

    if (scan.aiReportContent && scan.aiReportContent.length > 50) {
      markdownContent = scan.aiReportContent;
    } else {
      const scanDetails = scan.details ? scan.details : scan;
      const cleanedData = prepareDataForAI(scanDetails);
      markdownContent = await generateReportContent(targetUrl, cleanedData);
    }

    const reportsDir = path.join(__dirname, "../../ai_PDF");
    let reportPath = filenameToDownload
      ? path.join(reportsDir, filenameToDownload)
      : null;

    if (!filenameToDownload || !(await fs.pathExists(reportPath))) {
      const result = await generateAndSavePDF(markdownContent, targetUrl);
      filenameToDownload = result.filename;
      reportPath = result.reportPath;

      scan.pdfFilename = filenameToDownload;
      await scan.save();
    }

    res.download(reportPath);
  } catch (error) {
    console.error("💥 Report Generation Failed:", error);
    res
      .status(500)
      .json({ message: "Report Generation Failed", error: error.message });
  }
};
```

### 📄 المسار: `aiModel/src/routes/reportRoutes.js`

**الوظيفة:** تعريف رابط التحميل.

```javascript
const express = require("express");
const router = express.Router();
const reportController = require("../controllers/reportController");

router.get("/:scanId", reportController.generateAndDownloadPDF);

module.exports = router;
```

---

## 🔗 5. التكامل الرئيسي (Main Integration)

### 📄 المسار: `controller/results.controller.js`

**الوظيفة:** الكنترولر الرئيسي الذي يربط الفحص بالذكاء الاصطناعي.

```javascript
const mongoose = require("mongoose");
const path = require("path");
const logger = require("../utils/logger.utils");
const sendEmail = require("../utils/email.utils");

const Url = require("../model/url.model");
const Report = require("../model/results.model");
const Vulnerability = require("../model/vulnerability.model");

const { prepareDataForAI } = require("../aiModel/src/utils/ai-cleaner.utils");
const {
  generateReportContent,
} = require("../aiModel/src/utils/ollama.service");
const { generateAndSavePDF } = require("../aiModel/src/services/pdf.service");
const {
  getPythonCommand,
  createTempPayload,
  runScriptWorker,
} = require("../utils/scan.utils");

const SEVERITY_RANK = {
  safe: 0,
  Low: 1,
  low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

exports.scanAll = async (req, res) => {
  try {
    const { urlId } = req.body;

    if (!urlId) {
      return res.status(400).json({ message: "URL ID is required" });
    }

    let urlDoc = await Url.findById(urlId).populate("user");

    if (!urlDoc) {
      return res.status(404).json({ message: "URL document not found." });
    }

    if (urlDoc.status === "Scanning") {
      return res
        .status(409)
        .json({ message: "Scan is already in progress for this URL." });
    }

    const targetUrlString = urlDoc.originalUrl;

    urlDoc.status = "Scanning";
    urlDoc.numberOfvuln = 0;
    urlDoc.severity = "safe";
    await urlDoc.save();

    const vulnerabilities = await Vulnerability.find({ isActive: true });
    if (vulnerabilities.length === 0) {
      urlDoc.status = "Finished";
      await urlDoc.save();
      return res
        .status(404)
        .json({ message: "No active vulnerabilities found." });
    }

    const pythonCommand = getPythonCommand();
    console.log(
      `🚀 Starting Scan using [${pythonCommand}] for: ${targetUrlString} (ID: ${urlId})`
    );

    const scanPromises = vulnerabilities.map(async (vuln) => {
      let scriptFileName = vuln.scriptFile
        ? vuln.scriptFile
        : vuln.name.trim() + ".py";
      scriptFileName = path.basename(scriptFileName);

      const payloadPath = createTempPayload(targetUrlString, vuln._id);

      const scriptResult = await runScriptWorker(
        scriptFileName,
        payloadPath,
        pythonCommand
      );

      let isDetected = false;
      if (scriptResult && !scriptResult.error) {
        if (scriptResult.summary && scriptResult.summary.findings_count > 0)
          isDetected = true;
        else if (scriptResult.vulnerable === true) isDetected = true;
        else if (
          Array.isArray(scriptResult.findings) &&
          scriptResult.findings.length > 0
        )
          isDetected = true;
      }

      console.log(
        `Checking ${vuln.name}: ${isDetected ? "DETECTED 🔴" : "Safe 🟢"}`
      );

      return {
        vulnerabilityId: vuln._id,
        vulnerabilityName: vuln.name,
        severity: vuln.severity,
        isDetected: isDetected,
        technicalDetail: scriptResult,
      };
    });

    const resultsArray = await Promise.all(scanPromises);

    let detectedCount = 0;
    let maxSeverityRank = 0;
    let finalSeverity = "safe";

    resultsArray.forEach((item) => {
      if (item.isDetected) {
        detectedCount++;
        const currentRank = SEVERITY_RANK[item.severity] || 0;
        if (currentRank > maxSeverityRank) {
          maxSeverityRank = currentRank;
          finalSeverity = item.severity === "Low" ? "low" : item.severity;
        }
      }
    });

    let aiMarkdownContent = "";
    try {
      logger.info("🤖 AI is analyzing scan results...");
      const cleanedData = prepareDataForAI(resultsArray);
      aiMarkdownContent = await generateReportContent(
        targetUrlString,
        cleanedData
      );
      logger.info("✅ AI Report Generated Successfully!");
    } catch (aiError) {
      logger.error(`⚠️ AI Generation Failed: ${aiError.message}`);
      aiMarkdownContent =
        "# AI Report Generation Failed\nCould not generate report at this time.";
    }

    const newReport = new Report({
      url: urlDoc._id,
      summary: {
        totalVulnerabilities: detectedCount,
        highestSeverity: finalSeverity,
      },
      details: resultsArray,
      aiReportContent: aiMarkdownContent,
    });

    await newReport.save();

    try {
      const { filename } = await generateAndSavePDF(
        aiMarkdownContent,
        targetUrlString
      );
      newReport.pdfFilename = filename;
      await newReport.save();
    } catch (pdfError) {
      logger.error(`❌ PDF Service Error: ${pdfError.message}`);
    }

    urlDoc.status = "Finished";
    urlDoc.numberOfvuln = detectedCount;
    urlDoc.severity = detectedCount > 0 ? finalSeverity : "safe";
    await urlDoc.save();

    if (logger && logger.info)
      logger.info(`Scan completed successfully for ID: ${urlDoc._id}`);

    if (urlDoc.user && urlDoc.user.email) {
      try {
        const reportLink = `http://localhost:4200/result/${urlId}`;
        const message = `Scan finished for ${urlDoc.originalUrl}. We found ${detectedCount} issues.`;

        await sendEmail({
          email: urlDoc.user.email,
          subject: "🔍 Security Scan Completed",
          message: message,
          html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #4c6ef5;">Scan Completed Successfully!</h2>
                <p>Hello,</p>
                <p>The security scan for target: <strong>${urlDoc.originalUrl}</strong> has finished.</p>
                <p style="font-size: 16px;">
                   Total Issues Found: <strong style="color: #ff003c; font-size: 18px;">${detectedCount}</strong>
                </p>
                <p>You can view the full detailed report on your dashboard.</p>
                <br>
                <div style="text-align: center; margin: 20px 0;">
                    <a href="${reportLink}" style="background: #4c6ef5; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Full Report</a>
                </div>
                <br>
                <hr style="border: 0; border-top: 1px solid #eee;">
                <p style="font-size: 12px; color: #777; text-align: center;">SecuScan Automated System</p>
              </div>
            `,
        });
        console.log(
          `✅ Email sent to ${urlDoc.user.email} with count: ${detectedCount}`
        );
      } catch (emailError) {
        console.error("❌ Failed to send email:", emailError.message);
      }
    } else {
      console.warn("⚠️ User email not found.");
    }

    return res.status(200).json({
      message: "Scan completed successfully",
      reportId: newReport._id,
      summary: newReport.summary,
      results: resultsArray,
    });
  } catch (error) {
    if (logger && logger.warn) logger.warn(`Scan Error: ${error.message}`);
    console.error("Scan Error:", error);

    if (req.body.urlId) {
      await Url.findByIdAndUpdate(req.body.urlId, { status: "Failed" });
    }
    return res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

exports.getAllReports = async (req, res) => {
  try {
    const reports = await Report.find()
      .sort({ scanDate: -1 })
      .populate("url", "originalUrl");
    res.status(200).json(reports);
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

exports.getReportsByUrl = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user._id;
    const currentUserRole = req.user.role;

    const urlDoc = await Url.findById(id);

    if (!urlDoc) {
      return res.status(404).json({ message: "URL not found" });
    }

    if (
      urlDoc.user.toString() !== currentUserId.toString() &&
      currentUserRole !== "admin"
    ) {
      return res
        .status(403)
        .json({ message: "⛔ Access Denied: You do not own this resource." });
    }

    const reports = await Report.find({ url: id })
      .sort({ scanDate: -1 })
      .populate("url", "originalUrl");

    res.status(200).json({ message: "Success", data: reports });
  } catch (err) {
    console.error("Get Reports Error:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.getReportById = async (req, res) => {
  try {
    const { reportId } = req.params;
    const report = await Report.findById(reportId).populate(
      "url",
      "originalUrl"
    );
    if (!report) return res.status(404).json({ message: "Report not found" });
    res.status(200).json({ data: report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
```
