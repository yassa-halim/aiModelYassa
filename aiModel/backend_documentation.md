<!-- npm install express mongoose dotenv cors winston winston-mongodb nodemailer bcrypt jsonwebtoken multer fs-extra axios puppeteer marked express-rate-limit -->
# 🚀 AI Model & Reporting System Setup

# 📘 Backend System Documentation & Data Flow

هذا الملف يوثق الأكواد الأساسية للمشروع (خارج مجلد `aiModel`) ويشرح دورة حياة البيانات (Data Flow) بالتفصيل.

---

## 🔄 مسار البيانات (Data Flow)

إليك رحلة البيانات من لحظة إدخال الرابط وحتى استلام ملف الـ PDF:

### 1. إدخال الرابط (Input Phase)

- **المستخدم:** يقوم بإدخال الرابط في الواجهة الأمامية.
- **API:** يتم استدعاء `POST /api/urls/url`.
- **Controller:** `url.controller.js` يحفظ الرابط في قاعدة البيانات (Collection: `Url`) ويربطه بالمستخدم الحالي.

### 2. بدء الفحص (Scanning Phase)

- **المستخدم:** يضغط على زر "Scan".
- **API:** يتم استدعاء `POST /api/results/scan-all` مع `urlId`.
- **Controller:** `results.controller.js` يقوم بالخطوات التالية:
  1.  تحديث حالة الرابط إلى `Scanning`.
  2.  جلب جميع الثغرات النشطة (`isActive: true`) من قاعدة البيانات (`Vulnerability`).
  3.  لكل ثغرة، يتم استدعاء دالة `runScriptWorker` (من `utils/scan.utils.js`).

### 3. تنفيذ السكربتات (Execution Phase)

- **Utils:** `scan.utils.js` يقوم بتشغيل ملفات البايثون (`.py`) الموجودة في `vulnerabilityFiles/` كعمليات فرعية (Child Processes).
- **Python:** السكربتات تقوم بفحص الهدف وتخرج النتائج بصيغة **JSON** (تحتوي على `findings`, `details`).
- **Aggregation:** يتم تجميع نتائج كل السكربتات في مصفوفة واحدة (`resultsArray`).

### 4. التحليل والتوليد (AI & Reporting Phase)

- **AI Integration:** يتم تمرير `resultsArray` إلى موديل الذكاء الاصطناعي (عبر `ollama.service.js`).
- **Report Generation:** الموديل يحلل النتائج ويكتب تقريرًا بصيغة **Markdown**.
- **Database:** يتم حفظ النتائج الخام + تقرير الـ AI في قاعدة البيانات (Collection: `Report`).

### 5. الإخراج (Output Phase)

- **PDF:** يتم تحويل نص الـ Markdown إلى ملف PDF وحفظه في السيرفر (`aiModel/ai_PDF`).
- **Email:** يتم إرسال بريد إلكتروني للمستخدم بملخص النتائج.
- **Download:** المستخدم يطلب `GET /api/report/:scanId` لتحميل الملف.

---

## 📂 التوثيق التقني (Core Backend Components)

### 1. المتحكم الرئيسي للفحص (`results.controller.js`)

**المسار:** `controller/results.controller.js`
هذا هو "العقل المدبر" الذي ينسق العملية بالكامل.

```javascript
// [Lines 116-308] Main Scan Function
exports.scanAll = async (req, res) => {
  // [Line 125] 1. التحقق من الرابط وتحديث حالته
  let urlDoc = await Url.findById(urlId).populate("user");
  urlDoc.status = "Scanning";
  await urlDoc.save();

  // [Line 140] 2. جلب الثغرات وتشغيل السكربتات
  const vulnerabilities = await Vulnerability.find({ isActive: true });

  // [Line 151] بدء حلقة الفحص
  const scanPromises = vulnerabilities.map(async (vuln) => {
    // ... تحديد مسار السكربت
    // [Line 158] تشغيل السكربت وانتظار النتيجة
    const scriptResult = await runScriptWorker(
      scriptFullPath,
      payloadPath,
      pythonCommand
    );
    return {
      /* ... results ... */
    };
  });

  const resultsArray = await Promise.all(scanPromises);

  // [Line 198] 3. التكامل مع AI (يتم استدعاء دوال من aiModel)
  let aiMarkdownContent = "";
  try {
    // [Line 201] تجهيز البيانات وتنظيفها
    const cleanedData = prepareDataForAI(resultsArray);
    // [Line 202] توليد التقرير عبر Ollama
    aiMarkdownContent = await generateReportContent(
      targetUrlString,
      cleanedData
    );
  } catch (aiError) {
    /* ... */
  }

  // [Line 214] 4. حفظ التقرير في قاعدة البيانات
  const newReport = new Report({
    // ...
    aiReportContent: aiMarkdownContent,
  });
  await newReport.save();

  // [Line 227] 5. توليد ملف PDF وحفظه
  try {
    const { filename } = await generateAndSavePDF(
      aiMarkdownContent,
      targetUrlString
    );
    newReport.pdfFilename = filename;
    await newReport.save();
  } catch (pdfError) {
    /* ... */
  }

  // [Line 248] 6. إرسال الإيميل وإنهاء العملية
  if (urlDoc.user && urlDoc.user.email) {
    await sendEmail({
      /* ... */
    });
  }
};
```

### 2. مشغل السكربتات (`scan.utils.js`)

**المسار:** `utils/scan.utils.js`
المسؤول عن التعامل مع نظام التشغيل لتنفيذ أوامر Python.

```javascript
exports.runScriptWorker = (scriptFileName, payloadPath, pythonCmd) => {
  return new Promise((resolve) => {
    // تشغيل عملية بايثون منفصلة
    const python = spawn(pythonCmd, [
      "-u",
      scriptFullPath,
      "--payload",
      payloadPath,
      "--outdir",
      OUTPUT_DIR,
    ]);

    // التعامل مع المهلة الزمنية (Timeout)
    const TIMEOUT_MS = 7 * 60 * 1000; // 7 دقائق
    const timeout = setTimeout(() => {
      python.kill();
      resolve({ error: "Scan timeout exceeded", vulnerable: false });
    }, TIMEOUT_MS);

    // تجميع المخرجات وتحويلها لـ JSON
    python.stdout.on("data", (data) => {
      outputData += data.toString();
    });
    // ... parsing logic ...
  });
};
```

### 3. نماذج قاعدة البيانات (Models)

#### نموذج التقرير (`results.model.js`)

يخزن النتائج الخام وتقرير الذكاء الاصطناعي.

```javascript
const reportSchema = new mongoose.Schema(
  {
    url: { type: mongoose.Schema.Types.ObjectId, ref: "Url" },
    summary: {
      totalVulnerabilities: Number,
      highestSeverity: String,
    },
    details: [
      /* مصفوفة النتائج الخام من السكربتات */
    ],
    aiReportContent: String, // تقرير AI النصي
    pdfFilename: String, // اسم ملف PDF المولد
  },
  { timestamps: true }
);
```

#### نموذج الثغرة (`vulnerability.model.js`)

يخزن معلومات السكربتات المتاحة للفحص.

```javascript
const vulnerabilitySchema = new mongoose.Schema({
  name: String,
  scriptFile: String, // اسم ملف البايثون
  isActive: Boolean, // لتفعيل/تعطيل الثغرة
  severity: { type: String, enum: ["Low", "Medium", "High", "Critical"] },
});
```

### 4. المسارات (Routes)

#### مسار النتائج (`results.routes.js`)

```javascript
// بدء عملية الفحص
router.post("/scan-all", authenticate, resultController.scanAll);

// جلب التقارير السابقة لرابط معين
router.get("/url/:id/reports", authenticate, resultController.getReportsByUrl);
```

#### مسار المستخدمين والمصادقة (`user.routes.js`)

```javascript
// تسجيل الدخول مع حماية Rate Limit
router.post("/login", authLimiter, login);

// التحقق من OTP
router.post("/verify", authLimiter, verifyAccount);
```

---

## 🛠️ أدوات مساعدة (Utilities)

### `logger.utils.js`

نظام تسجيل الأحداث (Logging) باستخدام Winston، يسجل في ملفات وفي MongoDB.

```javascript
// يسجل في logs/app.log وفي قاعدة البيانات audit_logs
const logger = createLogger({
  transports: [
    new transports.File({ filename: "logs/app.log" }),
    new transports.MongoDB({ db: mongoUri, collection: "audit_logs" }),
  ],
});
```

### `email.utils.js`

إرسال الإشعارات عبر البريد الإلكتروني.

```javascript
const sendEmail = async (options) => {
  const transporter = nodemailer.createTransport({
    /* config */
  });
  await transporter.sendMail({
    to: options.email,
    subject: options.subject,
    html: options.html,
  });
};
```
