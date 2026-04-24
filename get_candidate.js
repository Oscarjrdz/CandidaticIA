import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./candidatic-ia-firebase-adminsdk-j6xkf-db3f7a40b3.json', 'utf8'));

try {
  initializeApp({ credential: cert(serviceAccount) });
} catch(e) {}

const db = getFirestore();

async function run() {
  const q = await db.collection('candidates').where('telefono', '==', '5218116038195').get();
  if (q.empty) {
      const q2 = await db.collection('candidates').where('telefono', '==', '+52 1 81 1603 8195').get();
      if(q2.empty) {
          console.log("No found");
          return;
      }
      q2.forEach(doc => console.log(JSON.stringify(doc.data(), null, 2)));
  } else {
      q.forEach(doc => console.log(JSON.stringify(doc.data(), null, 2)));
  }
}
run();
