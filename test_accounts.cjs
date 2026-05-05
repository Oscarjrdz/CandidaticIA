const fs = require('fs');
const dotenv = require('dotenv');

const envLocal = dotenv.parse(fs.readFileSync('.env.local'));

async function testAccounts() {
    const token = envLocal.META_ACCESS_TOKEN;
    
    const res = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`);
    const data = await res.json();
    
    console.log("Accounts Response:", JSON.stringify(data, null, 2));
}

testAccounts();
