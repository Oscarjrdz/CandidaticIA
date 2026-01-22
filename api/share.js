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
                
                <!-- Optional: Add a general Call to Action if desirable, or keeps it clean -->
                <!-- <a href="https://wa.me/5218116038195" class="whatsapp-btn">Contactar por WhatsApp</a> -->
                
                ${(data.redirectEnabled && data.redirectUrl) ? (() => {
            let safeUrl = data.redirectUrl;
            if (!safeUrl.startsWith('http://') && !safeUrl.startsWith('https://')) {
                safeUrl = 'https://' + safeUrl;
            }
            return `
                    <div class="redirect-box" style="margin-top:20px; text-align:center; padding:20px; background:#f0f9ff; border-radius:8px; border:1px solid #bae6fd;">
                        <p style="margin-bottom:10px; font-weight:bold; color:#0284c7;">Redirigiendo...</p>
                        <a href="${safeUrl}" style="display:inline-block; background:#0284c7; color:white; padding:10px 20px; text-decoration:none; border-radius:6px; font-weight:bold;">
                            Clic si no te redirige automáticamente
                        </a>
                        <script>
                            setTimeout(function() {
                                window.location.href = "${safeUrl}";
                            }, 500);
                        </script>
                    </div>
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
