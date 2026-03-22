import axios from 'axios';
async function test() {
    const url = 'https://api.ultramsg.com/instance159905/messages/chat';
    try {
        const res = await axios.post(url, {
            token: 'whlqepkf27wm17v9',
            to: '5218116038195@c.us',
            body: 'Mensaje de prueba desde terminal - Candidatic IA'
        });
        console.log("Success:", res.data);
    } catch(e) {
        console.log("Error:", e.response ? e.response.data : e.message);
    }
}
test();
