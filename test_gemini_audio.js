
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

async function testGeminiAudio() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY missing');
        return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // Attempting to use a model that might support multimodal output
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash-exp",
    });

    try {
        console.log('🤖 Solicitando a Gemini que genere audio...');
        // Note: Standard SDK might not support 'audio' output type in the simple .generateContent() call yet
        // but let's see if we can request a specific response mime type if applicable.
        const result = await model.generateContent([
            "Responde con una nota de voz breve de 5 segundos saludando como Brenda la reclutadora. (Si puedes generar audio, hazlo; si no, solo texto).",
        ]);

        const response = await result.response;
        console.log('Response Type:', typeof response.text() === 'string' ? 'Text' : 'Other');
        console.log('Text Content:', response.text());

        // Checking candidate fields for audio data
        const candidates = response.candidates[0];
        console.log('Candidates content parts:', JSON.stringify(candidates.content.parts, null, 2));

    } catch (error) {
        console.error('❌ Error testing Gemini Audio:', error.message);
    }
}

testGeminiAudio();
