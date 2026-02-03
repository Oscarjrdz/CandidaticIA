import { getAITelemetry, getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const telemetry = await getAITelemetry();

        // Add some derived insights
        if (telemetry.stats) {
            const total = parseInt(telemetry.stats.total_calls || 0);
            const totalLatency = parseInt(telemetry.stats.total_latency_ms || 0);
            telemetry.insights = {
                avgLatency: total > 0 ? (totalLatency / total).toFixed(2) : 0,
                successRate: total > 0 ? ((parseInt(telemetry.stats.successful_calls || 0) / total) * 100).toFixed(1) : 100,
                estimatedCostUSD: total > 0 ? ((parseInt(telemetry.stats.total_tokens || 0) / 1000000) * 0.15).toFixed(4) : 0 // Very rough estimate for Flash
            };
        }

        return res.status(200).json(telemetry);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
