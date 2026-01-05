const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
    url: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Url',
        required: true
    },
    // 🔥 الحقل الجديد: ربط التقرير باليوزر مباشرة
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    scanDate: {
        type: Date,
        default: Date.now
    },
    summary: {
        totalVulnerabilities: { type: Number, default: 0 },
        highestSeverity: { 
            type: String, 
            enum: ['safe', 'Low', 'Medium', 'High', 'Critical'],
            default: 'safe'
        }
    },
    details: [
        {
            vulnerabilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vulnerability' },
            vulnerabilityName: String,
            severity: String,
            isDetected: Boolean,
            technicalDetail: Object
        }
    ],
    aiReportContent: String,
    pdfFilename: String
    
}, { timestamps: true });

module.exports = mongoose.model('Report', reportSchema);