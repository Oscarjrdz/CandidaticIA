import Redis from 'ioredis';

async function check() {
    const redis = new Redis(process.env.REDIS_URL);
    try {
        const keys = await redis.keys('candidate:*');
        for (const key of keys) {
            if (key.includes('message')) continue;
            const data = await redis.get(key);
            if (data) {
                const c = JSON.parse(data);
                if (c.whatsapp === '18131732903' || c.whatsapp === '+18131732903' || c.whatsapp === '18131732903@s.whatsapp.net' || c.id === '18131732903' || c.id === '18131732903@s.whatsapp.net') {
                    console.log('Candidate Data:', {
                        id: c.id,
                        whatsapp: c.whatsapp,
                        lastUserMessageAt: c.lastUserMessageAt,
                        ultimoMensajeBot: c.ultimoMensajeBot,
                        lastBotMessageAt: c.lastBotMessageAt,
                        unreadMsgCount: c.unreadMsgCount,
                        ultimoMensaje: c.ultimoMensaje,
                        mensajesTotales: c.mensajesTotales
                    });
                }
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        await redis.quit();
        process.exit(0);
    }
}
check();
