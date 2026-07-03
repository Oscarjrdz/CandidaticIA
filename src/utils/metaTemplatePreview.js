const MEDIA_LABELS = {
    image: '[Imagen]',
    video: '[Video]',
    document: '[Documento]',
};

function resolveTemplateValue(key, templateParams = {}, fallbackName = 'Candidato') {
    const cleanKey = String(key || '').trim();
    const directValue = templateParams?.[cleanKey];
    if (directValue) return directValue;
    if (cleanKey === 'candidato' || cleanKey === 'nombre' || cleanKey === 'name') return fallbackName;
    return templateParams?.['1'] || fallbackName;
}

export function renderMetaTemplatePreviewText(templateData = {}, templateParams = {}, fallbackName = 'Candidato') {
    const components = templateData?.components || [];
    const parts = [];

    const renderText = (text = '') => text.replace(/\{\{([^}]+)\}\}/g, (_match, key) => {
        return resolveTemplateValue(key, templateParams, fallbackName);
    }).trim();

    const header = components.find(c => (c.type || '').toUpperCase() === 'HEADER');
    if (header) {
        if ((header.format || '').toUpperCase() === 'TEXT' && header.text) {
            parts.push(renderText(header.text));
        } else if (header.format) {
            parts.push(MEDIA_LABELS[String(header.format).toLowerCase()] || `[${header.format}]`);
        }
    }

    const body = components.find(c => (c.type || '').toUpperCase() === 'BODY');
    if (body?.text) parts.push(renderText(body.text));

    const footer = components.find(c => (c.type || '').toUpperCase() === 'FOOTER');
    if (footer?.text) parts.push(renderText(footer.text));

    const buttons = components.find(c => (c.type || '').toUpperCase() === 'BUTTONS');
    const buttonLabels = (buttons?.buttons || [])
        .map(btn => btn.text || btn.url || btn.phone_number)
        .filter(Boolean);
    if (buttonLabels.length > 0) {
        parts.push(buttonLabels.map(label => `> ${renderText(label)}`).join('\n'));
    }

    return parts.filter(Boolean).join('\n\n') || '[Plantilla sin texto visible]';
}

export function extractTemplateVariables(templateData = {}) {
    const vars = [];
    (templateData?.components || []).forEach(comp => {
        const type = (comp.type || '').toUpperCase();
        if (type !== 'BODY' && type !== 'HEADER') return;
        const matches = (comp.text || '').match(/\{\{[^}]+\}\}/g) || [];
        matches.forEach(match => {
            const key = match.replace(/[{}]/g, '');
            if (!vars.includes(key)) vars.push(key);
        });
    });
    return vars;
}
