/**
 * 🧪 INFRASTRUCTURE VERIFICATION (Meta-Level)
 * Tests the AIGuard and Orchestrator logic in isolation.
 */
import { AIGuard } from './api/utils/ai-guard.js';
import { Orchestrator } from './api/utils/orchestrator.js';

async function testGuard() {
    console.log("--- Testing AI Guardrail ---");

    // Test Case 1: Silence on Incomplete Profile
    const context1 = { isProfileComplete: false, missingFields: ['edad', 'municipio'], lastInput: 'hola' };
    const result1 = AIGuard.validate({ response_text: "" }, context1);
    console.log("Empty Response + Incomplete Profile:", result1.recovery_active ? "✅ RECOVERY TRIGGERED" : "❌ FAILED (Silence Not Caught)");

    // Test Case 2: Silence on Complete Profile (Allowed, usually silent close)
    const context2 = { isProfileComplete: true, missingFields: [], lastInput: 'gracias' };
    const result2 = AIGuard.validate({ response_text: "" }, context2);
    console.log("Empty Response + Complete Profile:", result2.recovery_active ? "❌ WRONG RECOVERY" : "✅ SILENCE ALLOWED");
}

async function testJSONSanitizer() {
    console.log("\n--- Testing JSON Sanitizer ---");
    const dirtyJSON = '```json\n{"response_text": "Hello World", "extracted_data": {}}\n```';
    const clean = AIGuard.sanitizeJSON(dirtyJSON);
    console.log("Sanitized JSON:", clean && clean.response_text === "Hello World" ? "✅ CLEANED" : "❌ FAILED");
}

// Note: Test Orchestrator requires Redis/DB connection. 
// We will skip actual DB writes in this simple dry-run.

async function run() {
    await testGuard();
    await testJSONSanitizer();
}

run();
