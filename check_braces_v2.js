import fs from 'fs';
const content = fs.readFileSync('api/ai/agent.js', 'utf8');
let depth = 0;
let inString = false;
let stringChar = '';
let inTemplate = false;

for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const prev = content[i - 1];

    if (!inString && !inTemplate) {
        if (char === "'" || char === '"') {
            inString = true;
            stringChar = char;
        } else if (char === '`') {
            inTemplate = true;
        } else if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
        }
    } else if (inString) {
        if (char === stringChar && prev !== '\\') {
            inString = false;
        }
    } else if (inTemplate) {
        if (char === '`' && prev !== '\\') {
            inTemplate = false;
        }
    }
}
console.log(`Final Depth (String Aware): ${depth}`);
