import fs from 'fs';
const content = fs.readFileSync('api/ai/agent.js', 'utf8');
const lines = content.split('\n');
let depth = 0;
let inTemplate = false;

lines.forEach((line, i) => {
    let oldDepth = depth;
    for (let char of line) {
        if (char === '`') inTemplate = !inTemplate;
        if (!inTemplate) {
            if (char === '{') depth++;
            if (char === '}') depth--;
        }
    }
    console.log(`${i + 1}: [${depth}] ${line.substring(0, 50)}`);
});
