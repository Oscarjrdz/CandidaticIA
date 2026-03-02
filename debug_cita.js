import { getProjects } from './api/utils/storage.js';

async function run() {
    try {
        const projects = await getProjects();
        let targetProject = null;
        let citaStep = null;

        for (const p of projects) {
            if (!p.steps) continue;
            const step = p.steps.find(s => (s.name || '').toLowerCase().includes('cita'));
            if (step && step.appointmentConfirmation && step.appointmentConfirmation.length > 0) {
                targetProject = p;
                citaStep = step;
                break;
            }
        }

        if (targetProject) {
            console.log(`✅ Project Found: ${targetProject.name} (${targetProject.id})`);
            console.log(`✅ Cita Step Found: ${citaStep.name}`);
            console.log(`📦 Confirmation Modules: ${citaStep.appointmentConfirmation.length}`);
            console.log(JSON.stringify(citaStep.appointmentConfirmation, null, 2));

            const originStepNameForConfirm = (citaStep.name || '').toLowerCase();
            const isCitaStepConfirm = originStepNameForConfirm.includes('cita');
            console.log(`🧪 isCitaStepConfirm evaluates to: ${isCitaStepConfirm}`);

        } else {
            console.log('❌ No project with a Cita step and appointmentConfirmation configured was found.');
        }

    } catch (err) {
        console.error('Error:', err);
    }
    process.exit(0);
}

run();
