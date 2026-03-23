import { getRedisClient } from './api/utils/storage.js';
import { getUltraMsgConfig, getUltraMsgContact } from './api/whatsapp/utils.js';

async function testCurrentPic() {
    const config = await getUltraMsgConfig();
    console.log("Current Config:", config);
    if(config) {
        const contact = await getUltraMsgContact(config.instanceId, config.token, '5218116038195');
        console.log("Contact API Response:", contact);
    }
    process.exit(0);
}
testCurrentPic();
