import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT || 3000;
const INTERVAL = 60000; // 1 minute

console.log('🚀 [LIVE ENGINE] Iniciando latido autónomo de Candidatic IA...');
console.log(`🔗 Target: http://localhost:${PORT}/api/cron/process-ai-automations`);

async function pulse() {
    try {
        const res = await fetch(`http://localhost:${PORT}/api/cron/process-ai-automations`, {
            headers: {
                'Authorization': `Bearer ${process.env.CRON_SECRET || ''}`
            }
        });
        const data = await res.json();
        const now = new Date().toLocaleTimeString();
        if (data.sent > 0) {
            console.log(`[${now}] ✅ PULSO EXITOSO: ${data.sent} mensajes enviados.`);
        } else {
            console.log(`[${now}] 💤 Pulso silencioso (sin coincidencias).`);
        }
    } catch (e) {
        console.error(`[${now}] ❌ Error en el pulso:`, e.message);
    }
}

// Initial pulse
pulse();

// Start loop
setInterval(pulse, INTERVAL);
