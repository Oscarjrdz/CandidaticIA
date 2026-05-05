const fs = require('fs');
const dotenv = require('dotenv');

const envLocal = dotenv.parse(fs.readFileSync('.env.local'));

async function checkToken() {
    const token = envLocal.META_ACCESS_TOKEN;
    
    console.log("Token starts with:", token.substring(0, 15));
    console.log("Token length:", token.length);

    const res = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${token}`);
    const data = await res.json();
    console.log("Permissions:", JSON.stringify(data, null, 2));
}

checkToken();
