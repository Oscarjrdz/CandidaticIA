import fs from 'fs';
import path from 'path';

const filePath = path.resolve('api/ai/agent.js');
const content = fs.readFileSync(filePath, 'utf8');

let balance = 0;
let inString = null;
let inTemplate = false;

const lines = content.split('\n');
lines.forEach((line, i) => {
    let lineText = line;
    for (let j = 0; j < lineText.length; j++) {
        const char = lineText[j];
        if (inString) {
            if (char === inString && lineText[j - 1] !== '\\') inString = null;
            continue;
        }
        if (inTemplate) {
            if (char === '`' && lineText[j - 1] !== '\\') inTemplate = false;
            continue;
        }
        if (char === '"' || char === "'") {
            inString = char;
            continue;
        }
        if (char === '`') {
            inTemplate = true;
            continue;
        }
        if (char === '{') {
            balance++;
        } else if (char === '}') {
            balance--;
        }
    }

    const lineNum = i + 1;
    if (lineNum >= 680 && lineNum <= 1010) {
        console.log(`${lineNum < 100 ? ' ' : ''}${lineNum}: bal=${balance} | ${lineText.trim().substring(0, 30)}`);
    }
});
