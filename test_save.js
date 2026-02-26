import fetch from 'node-fetch';

async function testSave() {
    console.log('--- Testing /api/bot-ia/settings ---');
    try {
        const res1 = await fetch('http://localhost:3000/api/bot-ia/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemPrompt: 'Test prompt',
                extractionRules: 'Test rules',
                cerebro1Rules: 'Test cerebro',
                aiModel: 'gpt-4o-mini',
                isActive: true
            })
        });
        console.log('Status:', res1.status);
        const data1 = await res1.json();
        console.log('Response:', data1);
    } catch (e) {
        console.error('Error 1:', e.message);
    }

    console.log('\n--- Testing /api/settings (ai_config) ---');
    try {
        const res2 = await fetch('http://localhost:3000/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'ai_config',
                data: {
                    openaiApiKey: 'test-key',
                    openaiModel: 'gpt-4o-mini',
                    gptHostEnabled: false,
                    gptHostPrompt: 'Test host'
                }
            })
        });
        console.log('Status:', res2.status);
        const data2 = await res2.json();
        console.log('Response:', data2);
    } catch (e) {
        console.error('Error 2:', e.message);
    }
}

testSave();
