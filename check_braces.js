import fs from 'fs';
const content = fs.readFileSync('api/ai/agent.js', 'utf8');
const lines = content.split('\n');
let depth = 0;
lines.forEach((line, i) => {
    let lineBraces = 0;
    for (let char of line) {
        if (char === '{') {
            depth++;
            lineBraces++;
        }
        if (char === '}') {
            depth--;
            lineBraces--;
        }
    }
    if (lineBraces !== 0) {
        console.log(`Line ${i + 1}: Depth ${depth} (Delta ${lineBraces}) | ${line.trim()}`);
    }
});
console.log(`Final Depth: ${depth}`);
