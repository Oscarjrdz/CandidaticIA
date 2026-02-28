import dotenv from 'dotenv';
dotenv.config({ path: '.env.vercel.local' });
import { getUltraMsgConfig, sendUltraMsgMessage } from './api/whatsapp/utils.js';

async function run() {
    const config = await getUltraMsgConfig();
    const phone = "5218116038195";
    
    const part1 = "¡Listo Oscar rodriguez! \u23ec Te propongo entrevista el d\u00eda **[LUNES 23 DE FEBRERO]** a las **[8:00 DE LA MA\u00d1ANA]**.";
    const part2 = "\u00bfTe queda bien? \ud83d\ude0a";
    
    console.log("Sending Part 1...");
    await sendUltraMsgMessage(config.instanceId, config.token, phone, part1, 'chat');
    
    console.log("Sending Part 2...");
    await sendUltraMsgMessage(config.instanceId, config.token, phone, part2, 'chat');
    
    console.log("Done");
    process.exit(0);
}
run();
