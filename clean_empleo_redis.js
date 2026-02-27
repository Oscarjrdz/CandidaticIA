import { getRedisClient } from './api/utils/storage.js';

async function cleanRedis() {
    try {
        const redis = getRedisClient();
        console.log('Cleaning automation_rules...');
        const rulesJson = await redis.get('automation_rules');
        if (rulesJson) {
            let rules = JSON.parse(rulesJson);
            const originalLength = rules.length;
            rules = rules.filter(r => r.id !== 'auto_empleo' && r.field !== 'tieneEmpleo');
            if (rules.length !== originalLength) {
                await redis.set('automation_rules', JSON.stringify(rules));
                console.log(`Removed ${originalLength - rules.length} rules related to empleo.`);
            } else {
                console.log('No employment rules found in Redis.');
            }
        }

        console.log('Cleaning custom_fields...');
        const fieldsJson = await redis.get('custom_fields');
        if (fieldsJson) {
            let fields = JSON.parse(fieldsJson);
            const originalLength = fields.length;
            fields = fields.filter(f => f.value !== 'empleo' && f.value !== 'tieneEmpleo');
            if (fields.length !== originalLength) {
                await redis.set('custom_fields', JSON.stringify(fields));
                console.log(`Removed ${originalLength - fields.length} custom fields related to empleo.`);
            } else {
                console.log('No employment custom fields found in Redis.');
            }
        }

        console.log('Done cleaning redis.');
    } catch (e) {
        console.error('Error cleaning redis:', e);
    } finally {
        process.exit(0);
    }
}

cleanRedis();
