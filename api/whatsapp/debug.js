import { getRedisClient } from '../utils/storage.js';

export default async function handler(req, res) {
    const report = {
        success: false,
        step: 'init',
        timestamp: new Date().toISOString()
    };

    try {
        report.step = 'connecting_redis';
        const client = getRedisClient();
        if (!client) {
            report.error = 'No Redis client initialized';
            return res.status(200).json(report);
        }

        report.step = 'ping_redis';
        const ping = await client.ping().catch(e => `ping_failed: ${e.message}`);
        report.ping = ping;

        report.step = 'checking_active_config';
        const config = await client.get('ultramsg_config').catch(e => `get_failed: ${e.message}`);
        report.hasConfig = !!config;

        report.step = 'finalizing';
        report.success = true;
        return res.status(200).json(report);

    } catch (error) {
        report.error = error.message;
        report.stack = error.stack;
        return res.status(200).json(report);
    }
}
