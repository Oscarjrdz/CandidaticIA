import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const { id } = req.query;

    // Default fallback values
    let metaTitle = req.query.title || 'Candidatic IA';
    let metaDesc = req.query.description || '';
    let metaImage = req.query.image || ''; // Leave empty if not provided

    // We declare data in outer scope to be accessible for the template
    let data = {};

    // Base URL construction
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    const currentUrl = `${baseUrl}${req.url}`;

    // If ID is present, try to fetch from Redis
    if (id) {
        try {
            const client = getRedisClient();
            if (client) {
                // Increment click counter async (no await needed for blocking response)
                client.incr(`clicks:${id}`).catch(err => console.error('Error incrementing clicks:', err));

                const rawData = await client.get(`share:${id}`);
                if (rawData) {
                    data = JSON.parse(rawData);
                    metaTitle = data.title || metaTitle;
                    metaDesc = data.description || metaDesc;
                    metaImage = data.image || metaImage;
                }
            }
        } catch (e) {
            console.error('Share ID Lookup Error:', e);
        }
    }

    // CRITICAL: Facebook/Twitter require ABSOLUTE URLs for images
    let absoluteImage = metaImage;
    if (metaImage && metaImage.startsWith('/')) {
        absoluteImage = `${baseUrl}${metaImage}`;
    }

    // --- [FACEBOOK FIX] Force extension for Social Previews ---
    // If the image is from our internal API and doesn't have an extension, append .jpg
    // api/image.js will split by '.' and capture the correct ID.
    if (absoluteImage && absoluteImage.includes('/api/image') && !absoluteImage.includes('.')) {
        absoluteImage += '.jpg';
    }

    // --- [FERRARI JUMP] Bot Detection & Instant Redirection ---
    const userAgent = req.headers['user-agent'] || '';
    const isBot = /facebookexternalhit|WhatsApp|Twitterbot|LinkedInBot|Pinterest|Slackbot|Googlebot|TelegramBot/i.test(userAgent);

    if (!isBot && data.redirectEnabled && data.redirectUrl) {
        let safeUrl = data.redirectUrl;
        if (!safeUrl.startsWith('http://') && !safeUrl.startsWith('https://')) {
            safeUrl = 'https://' + safeUrl;
        }

        console.log(`[Ferrari Jump] Instant redirect for human user to: ${safeUrl}`);
        res.setHeader('Location', safeUrl);
        return res.status(302).end();
    }

    const html = `
    <!DOCTYPE html>
    <html lang="es" prefix="og: https://ogp.me/ns#">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${metaTitle}</title>
        
        <!-- Open Graph / Facebook -->
        <meta property="og:type" content="article">
        <meta property="og:url" content="${currentUrl}">
        <meta property="og:title" content="${metaTitle}">
        <meta property="og:description" content="${metaDesc}">
        
        <meta property="og:image" content="${absoluteImage}">
        <meta property="og:image:secure_url" content="${absoluteImage}">
        <meta property="og:image:type" content="image/jpeg">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">
        
        <!-- Twitter -->
        <meta property="twitter:card" content="summary_large_image">
        <meta property="twitter:url" content="${currentUrl}">
        <meta property="twitter:title" content="${metaTitle}">
        <meta property="twitter:description" content="${metaDesc}">
        <meta property="twitter:image" content="${absoluteImage}">

        <!-- Simple Clean CSS -->
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                background-color: #f9fafb;
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                min-height: 100vh;
                color: #111;
            }
            .container {
                width: 100%;
                max-width: 680px;
                background: white;
                margin: 20px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                border-radius: 12px;
                overflow: hidden;
            }
            .hero-image {
                width: 100%;
                height: auto;
                display: block;
                max-height: 600px;
                object-fit: cover;
            }
            .content {
                padding: 30px;
            }
            h1 {
                font-size: 28px;
                font-weight: 800;
                margin-top: 0;
                margin-bottom: 16px;
                line-height: 1.3;
                color: #1a1a1a;
            }
            p {
                font-size: 18px;
                line-height: 1.6;
                color: #4a4a4a;
                white-space: pre-wrap;
            }
            .footer {
                padding: 20px 30px;
                border-top: 1px solid #eee;
                font-size: 13px;
                color: #888;
                text-align: center;
            }
            .whatsapp-btn {
                display: inline-block;
                background-color: #25D366;
                color: white;
                font-weight: bold;
                text-decoration: none;
                padding: 12px 24px;
                border-radius: 50px;
                margin-top: 20px;
                font-size: 16px;
            }
            /* If no image, hide it */
            .hidden { display: none; }
        </style>
    </head>
    <body>
        <div class="container">
            ${metaImage ? `<img src="${metaImage}" class="hero-image" alt="Post Image" onerror="this.style.display='none'"/>` : ''}
            
            <div class="content">
                <h1>${metaTitle}</h1>
                <p>${metaDesc}</p>
                
                ${(data.redirectEnabled && data.redirectUrl) ? (() => {
            let safeUrl = data.redirectUrl;
            if (!safeUrl.startsWith('http://') && !safeUrl.startsWith('https://')) {
                safeUrl = 'https://' + safeUrl;
            }
            return `
                    <script>
                        window.location.replace("${safeUrl}");
                    </script>
                `;
        })() : ''}
            </div>
            
            <div class="footer">
                Publicado vía Candidatic AI
            </div>
        </div>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
}
