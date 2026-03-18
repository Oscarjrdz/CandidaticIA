import { getProjectById, getVacancyById } from './api/utils/storage.js';
import { db } from './api/utils/firebase.js';

async function run() {
    const pSnap = await db.collection('projects').where('name', '==', 'AYUDANTE AISIN').get();
    const p = pSnap.docs[0].data();
    const vacId = p.vacancyIds[0];
    
    const faqSnap = await db.collection('vacancies').doc(vacId).collection('faqs').get();
    faqSnap.forEach(doc => {
        const d = doc.data();
        if (d.topic && d.topic.toLowerCase().includes('transporte')) {
            console.log(JSON.stringify({id: doc.id, ...d}, null, 2));
        }
    });
    process.exit(0);
}
run();
