const test = async () => {
    try {
        const res = await fetch('http://localhost:3000/api/candidates?limit=10&offset=0');
        const data = await res.json();

        console.log("Found candidates: ", data.candidates.length);
        for (const c of data.candidates) {
            if (c.nombreReal && c.nombreReal.toLowerCase().includes('oscar')) {
                console.log(JSON.stringify({
                    id: c.id,
                    nombreReal: c.nombreReal,
                    tieneEmpleo: c.tieneEmpleo,
                    whatsapp: c.whatsapp,
                    auditStatus: c.statusAudit
                }, null, 2));
            }
        }
    } catch (e) {
        console.error(e);
    }
};
test();
