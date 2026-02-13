import { processRecruiterMessage } from './api/ai/recruiter-agent.js';

async function testRecruiterBrain() {
    console.log('🚀 Testing Recruiter Brain (GPT-4o)...');

    const mockCandidate = {
        id: 'cand_test_123',
        nombreReal: 'Juan Pérez',
        categoria: 'Chofer de Torton',
        municipio: 'Apodaca',
        escolaridad: 'Secundaria',
        whatsapp: '5218110000000'
    };

    const mockProject = {
        name: 'Transportes Alpha',
        vacancyName: 'Chofer'
    };

    const mockStep = {
        name: 'Entrevista Inicial',
        aiConfig: {
            enabled: true,
            prompt: 'Tu misión es preguntarle a Juan si tiene disponibilidad para una entrevista el lunes a las 10am. Si acepta, incluye { move } en tu thought_process.'
        }
    };

    const mockHistory = [
        { from: 'user', content: 'Hola Brenda.' },
        { from: 'bot', content: '¡Hola Juan! Qué gusto saludarte.' }
    ];

    const mockConfig = { instanceId: 'test', token: 'test' };

    try {
        const result = await processRecruiterMessage(mockCandidate, mockProject, mockStep, mockHistory, mockConfig);
        console.log('\n--- AI RESPONSE ---');
        console.log('Thought Process:', result.thought_process);
        console.log('Response Text:', result.response_text);

        if (result.response_text.toLowerCase().includes('lunes')) {
            console.log('\n✅ TEST PASSED: Brenda focused on the mission.');
        } else {
            console.log('\n❌ TEST FAILED: Brenda missed the mission.');
        }

    } catch (e) {
        console.error('❌ TEST ERROR:', e.message);
    }
}

testRecruiterBrain();
