import { coalesceName, coalesceDate } from './api/utils/formatters.js';

console.log('Testing coalesceName:', typeof coalesceName);

try {
    import('./api/ai/agent.js').then(module => {
        console.log('agent.js imported successfully');
    }).catch(err => {
        console.error('Failed to import agent.js:', err);
    });
} catch (err) {
    console.log('Sync error:', err);
}
