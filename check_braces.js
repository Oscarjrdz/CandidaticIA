import fs from 'fs';
import path from 'path';

const filePath = path.resolve('api/ai/agent.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

let balance = 0;
let stack = [];

lines.forEach((line, i) => {
    const chars = line.split('');
    chars.forEach(char => {
        if (char === '{') {
            balance++;
            stack.push(i + 1);
        } else if (char === '}') {
            balance--;
            stack.pop();
        }
    });
    if (balance < 0) {
        console.log(`❌ Line ${i + 1}: Negative balance (${balance})! - "${line.trim()}"`);
        balance = 0;
    }
});

console.log(`Final balance: ${balance}`);
if (stack.length > 0) {
    console.log(`⚠️ Unclosed braces opened at lines: ${stack.join(', ')}`);
}
