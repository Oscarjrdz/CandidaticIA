import { getConfig, connectToDatabase } from './api/settings.js';
import mongoose from 'mongoose';

async function run() {
    await getConfig();
    await connectToDatabase();
    
    // We assume there's a Vacancy or FAQ model
    const collections = await mongoose.connection.db.listCollections().toArray();
    
    if (collections.some(c => c.name === 'vacancydescriptions')) {
       const docs = await mongoose.connection.db.collection('vacancydescriptions').find({}).limit(1).toArray();
       console.log("Sample VacancyDescription faqs structure:\n", JSON.stringify(docs[0].faqs, null, 2));
    }
    
    process.exit(0);
}
run();
