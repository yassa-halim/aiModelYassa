// services/ollama.service.js

const axios = require('axios');
const logger = require('../../../utils/logger.utils');
const { REPORT_PROMPT } = require('./prompts');

// Queue to prevent concurrent AI executions
// NOTE: This global queue serializes all AI requests. 
// Ideally, use a job queue system (like BullMQ) for production scalability.
let requestQueue = Promise.resolve();

exports.generateReportContent = async (targetUrl, cleanedData) => {
    const currentTask = async () => {

     
        // 🔥 تعديل: السماح بالقائمة الفارغة لكي يكتب الموديل تقرير "النظام آمن" بدلاً من الخطأ
        if (!cleanedData || !Array.isArray(cleanedData)) {
            throw new Error("No valid scan data provided to AI");
        }

        const prompt = REPORT_PROMPT
            .replace('{{DATA}}', JSON.stringify(cleanedData, null, 2))
            .replace('{{TARGET_URL}}', targetUrl)
            .replace('{{DATE}}', new Date().toISOString().split('T')[0]);

        try {
            logger?.info(`🤖 Generating Security Report for ${targetUrl}`);

            const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';

            const response = await axios.post(
                `${ollamaHost}/api/generate`,
                {
                    model: "llama3.1:8b-instruct-q4_0",
                    prompt,
                    stream: false,
                    options: {
                        num_ctx: 16384,
                        num_gpu: 18,
                        num_thread: 10,
                        num_batch: 256,
                        num_predict: 2048,
                        temperature: 0.15,
                        top_p: 0.9,
                        repeat_penalty: 1.15,
                        use_mmap: true
                    }
                },
                {
                    timeout: 1200000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                }
            );

            if (!response.data || !response.data.response) {
                throw new Error("Empty AI response received");
            }

            return response.data.response;

        } catch (err) {
            logger?.error(`⚠️ AI Generation Failed: ${err.message}`);
            return `# REPORT GENERATION FAILED

Reason:
${err.message}

Recommendation:
Ensure scan data contains valid findings before generating the report.
`;
        }
    };

    const result = requestQueue.then(currentTask);
    requestQueue = result.catch(() => {});
    return result;
};
