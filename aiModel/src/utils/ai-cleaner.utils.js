// utils/ai-cleaner.utils.js
const logger = require('../../../utils/logger.utils');

exports.prepareDataForAI = (scanDetails) => {
    if (!scanDetails || !Array.isArray(scanDetails)) {
        return [];
    }

    return scanDetails
        .filter(vuln => vuln.isDetected)
        .map((vuln, index) => {
            const tech = vuln.technicalDetail || {};
            
            // 🔥 تحسين: استخراج الرابط الأساسي كاحتياطي في حال عدم وجوده في التفاصيل الفرعية
            const globalUrl = tech.target || tech.url || tech.base_url || "Target Endpoint";

            // 1. تحديد مصدر البيانات (Findings Array) من داخل الـ Object في MongoDB
            let sourceData = [];
            
            if (Array.isArray(tech.findings)) {
                sourceData = tech.findings; // للسكربتات الكبيرة (Scanner)
            } else if (tech.summary && Array.isArray(tech.summary.findings)) {
                sourceData = tech.summary.findings;
            } else if (Array.isArray(tech.details)) {
                sourceData = tech.details; // للسكربتات الصغيرة (Headers/Cookies)
            } else {
                sourceData = [tech.details || tech];
            }

            // 2. ترتيب البيانات (Structuring) لتكون "نظيفة" للموديل
            // نقوم بتوحيد المسميات فقط (Mapping) دون حذف أو فلترة أي دليل
            const structuredEvidence = sourceData.map(item => {
                // التعامل مع البيانات المتداخلة (مثل تفاصيل SQLi Boolean)
                let detail = item.detail || item;
                
                // 🔥 تحسين: لو التفاصيل داخل object اسمه true (كما في بعض فحوصات SQL)
                if (detail.true && detail.true.url) {
                    detail = detail.true;
                }

                return {
                    url: detail.url || item.url || globalUrl, // استخدام الرابط الاحتياطي
                    method: detail.method || item.method || "GET",
                    param: detail.param || item.param || detail.parameter || "N/A",
                    payload: detail.payload || item.payload || "N/A",
                    evidence: detail.response || item.evidence || detail.evidence || "See technical details"
                };
            });

            if (logger) logger.info(`[AI-Cleaner] Structured ${structuredEvidence.length} items for ${vuln.vulnerabilityName}`);

            return {
                id: `V-${String(index + 1).padStart(3, "0")}`,
                title: vuln.vulnerabilityName || "Unspecified Security Finding",
                severity: vuln.severity || "Low",
                evidence: structuredEvidence // نرسل البيانات المنظمة (Clean Data)
            };
        });
};
