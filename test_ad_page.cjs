const fs = require('fs');
const dotenv = require('dotenv');

const envLocal = dotenv.parse(fs.readFileSync('.env.local'));

async function testAdPage() {
    const adsToken = envLocal.META_ADS_TOKEN;
    const adId = '120243552649030620';
    
    const adRes = await fetch(`https://graph.facebook.com/v21.0/${adId}/adcreatives?fields=object_story_spec,instagram_actor_id&access_token=${adsToken}`);
    const adData = await adRes.json();
    console.log("Creative details:", JSON.stringify(adData, null, 2));
}

testAdPage();
