const tData = {
    components: [
        { type: "HEADER", format: "DOCUMENT" },
        { type: "BODY", text: "Hola {{1}}, adios {{2}}" }
    ]
};
const candidateNameFallback = "John";
const componentsToSend = [];
tData.components.forEach(comp => {
    const cType = comp.type.toLowerCase();
    if (cType === 'body') {
        const text = comp.text || '';
        const varMatches = text.match(/\{\{\d+\}\}/g) || [];
        if (varMatches.length > 0) {
            componentsToSend.push({
                type: 'body',
                parameters: varMatches.map(() => ({ type: 'text', text: candidateNameFallback }))
            });
        }
    } else if (cType === 'header') {
        if ((comp.format || '').toLowerCase() === 'text') {
            const text = comp.text || '';
            const varMatches = text.match(/\{\{\d+\}\}/g) || [];
            if (varMatches.length > 0) {
                componentsToSend.push({
                    type: 'header',
                    parameters: varMatches.map(() => ({ type: 'text', text: candidateNameFallback }))
                });
            }
        } else if (comp.format) {
            // It's image/video/document
            const typeMap = { image: 'image', video: 'video', document: 'document' };
            const type = typeMap[comp.format.toLowerCase()] || 'document';
            componentsToSend.push({
                type: 'header',
                parameters: [
                    { 
                        type: type, 
                        [type]: { link: "https://candidatic.com/default_document.pdf" } // Placeholder
                    }
                ]
            });
        }
    } else if (cType === 'buttons') {
        if (comp.buttons) {
            comp.buttons.forEach((btn, index) => {
                if (btn.type === 'URL' && btn.url.includes('{{')) {
                    const varMatches = btn.url.match(/\{\{\d+\}\}/g) || [];
                    if (varMatches.length > 0) {
                        componentsToSend.push({
                            type: 'button',
                            sub_type: 'url',
                            index: String(index),
                            parameters: varMatches.map(() => ({ type: 'text', text: "link-id" }))
                        });
                    }
                }
            });
        }
    }
});
console.log(JSON.stringify(componentsToSend, null, 2));
