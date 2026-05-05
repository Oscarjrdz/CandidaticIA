const fs = require('fs');

async function testPage() {
    const res = await fetch(`https://graph.facebook.com/v21.0/1123920160801797?access_token=1061455557054529|candidatic_webhook_2026`); // invalid token, but maybe we can just hit public graph
    const data = await res.json();
    console.log(data);
}

testPage();
