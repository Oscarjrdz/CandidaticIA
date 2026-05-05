const fs = require('fs');
const dotenv = require('dotenv');

const envLocal = dotenv.parse(fs.readFileSync('.env.local'));

async function testPageToken() {
    const token = envLocal.META_ACCESS_TOKEN;
    const pageId = '1123920160801797';
    
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=access_token&access_token=${token}`);
    const data = await res.json();
    
    console.log("Page Token Response:", data);
}

testPageToken();
