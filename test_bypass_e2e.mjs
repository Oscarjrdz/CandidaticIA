import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getRedisClient, saveCandidate, syncCandidateStats } from './api/utils/storage.js';
import { runRecruiterFlow } from './api/ai/agent.js';

async function testBypass() {
    const simId = 'sim_graftech_to_aisin_' + Date.now();
    const phone = 'sim_5215555555555';
    
    // Graftech Project ID: proj_1775062992690_xp8g45
    // Vacancy 1 in Graftech: vac_1775062024560_34c
    const graftechProjectId = 'proj_1775062992690_xp8g45';
    const graftechVacId = 'vac_1775062024560_34c';

    console.log(`🚀 Preparando test de Bypass: Graftech -> Aisin...`);
    
    // 1. Crear candidato asignado a Graftech
    const candidate = {
        id: simId,
        whatsapp: phone,
        nombreReal: 'Juan Tester',
        genero: 'Hombre',
        municipio: 'Apodaca',
        fechaNacimiento: '01/01/1990', // 36 años
        escolaridad: 'Secundaria',
        categoria: 'Ayudante General',
        step: 'step_contact', // Está en modo contacto
        proyecto: 1,
        projectId: graftechProjectId,
        currentProjectStatus: 'Contacto',
        currentVacancyIndex: 0,
        projectMetadata: {
            vacName: 'Graftech',
            citaFecha: null,
            citaHora: null,
            noInteresaFlag: false
        }
    };
    
    // Fake Redis saving
    await saveCandidate(candidate);

    console.log(`💬 Enviando mensaje de rechazo...`);
    const message = "No me interesa Graftech, pagan muy poco. Qué más tienes?";
    
    try {
        const _redis = getRedisClient();
        const result = await runRecruiterFlow(simId, candidate, message, [message], _redis);
        console.log(`\n✅ RESULTADO DEL AGENTE:\n`);
        console.log('Mensajes a Enviar:', result.messagesToSend);
        
        // Log explicitly what new project they got
        const newProjId = result.candidateUpdates?.projectId;
        console.log('🏁 Nuevo Project ID asignado:', newProjId);
        if (newProjId === 'proj_1771225156891_10ez5k') {
            console.log('🎉 ¡EXITO! Brincó a AISIN correctamente.');
        } else {
            console.log('⚠️ No brincó a Aisin. Revisar reglas.');
        }
    } catch (err) {
        console.error("Error running test:", err);
    }
    
    process.exit(0);
}

testBypass();
