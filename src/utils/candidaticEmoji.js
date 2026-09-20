// Look NATIVO de Candidatic para emoji-picker-react (usado en el chat y en el drawer de Flujos):
// paleta emerald, esquinas redondeadas, sin borde pelón, y dark/light que coincide con la app
// (que usa dark-mode por clase en <html>). Trae TODOS los emojis (categorías + buscador) — aquí
// solo lo vestimos. Devuelve los props para pasar directo al <EmojiPicker {...props} />.
export function candidaticEmojiPickerProps() {
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const vars = isDark ? {
        '--epr-bg-color': '#1f2937',                 // gray-800
        '--epr-category-label-bg-color': '#1f2937',
        '--epr-text-color': '#e5e7eb',
        '--epr-hover-bg-color': '#374151',           // gray-700
        '--epr-focus-bg-color': '#374151',
        '--epr-highlight-color': '#10b981',          // emerald-500 (acento Candidatic)
        '--epr-search-input-bg-color': '#111827',    // gray-900
        '--epr-search-input-border-color': '#374151',
        '--epr-picker-border-color': 'transparent',
        '--epr-category-icon-active-color': '#10b981',
    } : {
        '--epr-bg-color': '#ffffff',
        '--epr-category-label-bg-color': '#ffffff',
        '--epr-text-color': '#111827',
        '--epr-hover-bg-color': '#ecfdf5',           // emerald-50
        '--epr-focus-bg-color': '#d1fae5',           // emerald-100
        '--epr-highlight-color': '#10b981',
        '--epr-search-input-bg-color': '#f9fafb',    // gray-50
        '--epr-search-input-border-color': '#e5e7eb',
        '--epr-picker-border-color': 'transparent',
        '--epr-category-icon-active-color': '#10b981',
    };
    const common = {
        '--epr-picker-border-radius': '16px',
        '--epr-search-input-border-radius': '10px',
        '--epr-emoji-size': '22px',
        '--epr-header-padding': '12px',
        '--epr-category-navigation-button-size': '22px',
    };
    return {
        theme: isDark ? 'dark' : 'light',
        searchPlaceholder: 'Buscar emoji…',
        previewConfig: { showPreview: false },
        lazyLoadEmojis: true,
        skinTonesDisabled: true,
        style: { ...vars, ...common, border: 'none' },
    };
}
