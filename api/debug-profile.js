
import { getUltraMsgConfig, getUltraMsgContact } from './whatsapp/utils.js';

export default async function handler(req, res) {
    const phone = req.query.phone || '5218116038195';
    // Append @c.us if not present, though utils might handle it? 
    // Actually utils takes chatId. For contacts/image it usually needs clean number or chatId?
    // Let's try both forms.

    const start = Date.now();
    try {
        const config = await getUltraMsgConfig();
        if (!config) return res.status(500).json({ error: 'No Config' });

        console.log('Testing Profile Pic Fetch for:', phone);

        // Test 1: plain phone
        const t1 = Date.now();
        const res1 = await getUltraMsgContact(config.instanceId, config.token, phone);
        const d1 = Date.now() - t1;

        // Test 2: with @c.us
        const t2 = Date.now();
        const res2 = await getUltraMsgContact(config.instanceId, config.token, `${phone}@c.us`);
        const d2 = Date.now() - t2;

        return res.json({
            phone,
            duration: `${Date.now() - start}ms`,
            test_plain: { result: res1, duration: d1 },
            test_suffix: { result: res2, duration: d2 }
        });

    } catch (e) {
        return res.status(500).json({ error: e.message, stack: e.stack });
    }
}
