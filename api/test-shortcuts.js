import { substituteVariables } from './utils/shortcuts.js';

const mockCandidate = {
    nombre: 'Oscar',
    whatsapp: '5218116038195',
    nombreReal: 'Oscar Rodriguez',
    municipio: 'Monterrey',
    customField: 'Something'
};

const tests = [
    {
        name: 'Simple replacement',
        template: 'Hola {{nombre}}, ¿cómo estás?',
        expected: 'Hola Oscar, ¿cómo estás?'
    },
    {
        name: 'Multiple replacements',
        template: '{{nombre}} ({{whatsapp}}) vive en {{municipio}}',
        expected: 'Oscar (5218116038195) vive en Monterrey'
    },
    {
        name: 'Case insensitive replacement',
        template: 'Hola {{NOMBRE}}, ¿eres de {{Municipio}}?',
        expected: 'Hola Oscar, ¿eres de Monterrey?'
    },
    {
        name: 'Missing field (returns as is or empty depending on logic)',
        template: 'Tu edad es {{edad}}',
        expected: 'Tu edad es {{edad}}' // Our current logic doesn't replace if key not in object
    },
    {
        name: 'Custom field replacement',
        template: 'Dato: {{customField}}',
        expected: 'Dato: Something'
    },
    {
        name: 'Alias {{name}}',
        template: 'Hi {{name}}!',
        expected: 'Hi Oscar!'
    }
];

console.log('🧪 Running Shortcut Tests...\n');

let passed = 0;
tests.forEach(t => {
    const result = substituteVariables(t.template, mockCandidate);
    if (result === t.expected) {
        console.log(`✅ PASSED: ${t.name}`);
        passed++;
    } else {
        console.log(`❌ FAILED: ${t.name}`);
        console.log(`   Expected: "${t.expected}"`);
        console.log(`   Got:      "${result}"`);
    }
});

console.log(`\n📊 Results: ${passed}/${tests.length} tests passed.`);

if (passed === tests.length) {
    process.exit(0);
} else {
    process.exit(1);
}
