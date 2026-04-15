export default {
    plugins: {
        tailwindcss: {},
        autoprefixer: {
            // Ensure prefixes for older browsers (Chrome 80+, Firefox 80+, Safari 13+, Edge 80+)
            overrideBrowserslist: [
                'Chrome >= 80',
                'Firefox >= 80',
                'Safari >= 13',
                'Edge >= 80',
                'iOS >= 13',
                'last 3 versions',
                '> 1%',
                'not dead'
            ]
        },
    },
}
