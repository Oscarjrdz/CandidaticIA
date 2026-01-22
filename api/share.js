import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const { id } = req.query; // Derived from /s/:id rewrite or query param

    // Default fallback values
    let metaTitle = req.query.title || 'Candidatic IA';
    let metaDesc = req.query.description || 'Check out this post!';
    let metaImage = req.query.image || 'https://via.placeholder.com/1200x630.png?text=No+Image';
    let targetUrl = req.query.url || 'https://google.com';

    // If ID is present (short link), try to fetch from Redis
    if (id) {
        try {
            const client = getRedisClient();
            if (client) {
                const rawData = await client.get(`share:${id}`);
                if (rawData) {
                    const data = JSON.parse(rawData);
                    metaTitle = data.title || metaTitle;
                    metaDesc = data.description || metaDesc;
                    metaImage = data.image || metaImage;
                    targetUrl = data.url || targetUrl;
                }
            }
        } catch (e) {
            console.error('Share ID Lookup Error:', e);
        }
    }

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>${metaTitle}</title>
        
        <!-- Open Graph / Facebook -->
        <meta property="og:type" content="website">
        <meta property="og:url" content="${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}${req.url}">
        <meta property="og:title" content="${metaTitle}">
        <meta property="og:description" content="${metaDesc}">
        <meta property="og:image" content="${metaImage}">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">

        <!-- Twitter -->
        <meta property="twitter:card" content="summary_large_image">
        <meta property="twitter:url" content="${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}${req.url}">
        <meta property="twitter:title" content="${metaTitle}">
        <meta property="twitter:description" content="${metaDesc}">
        <meta property="twitter:image" content="${metaImage}">

        <!-- Redirect Logic -->
        <meta http-equiv="refresh" content="0;url=${targetUrl}">
        
        <script type="text/javascript">
            // Immediate redirect in JS as well
            window.location.href = "${targetUrl}";
        </script>
    </head>
    <body>
        <p>Redirecting to <a href="${targetUrl}">${targetUrl}</a>...</p>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
}
