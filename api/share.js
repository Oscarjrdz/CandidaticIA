export default function handler(req, res) {
    const { title, description, image, url } = req.query;

    // Default fallback values
    const metaTitle = title || 'Candidatic IA';
    const metaDesc = description || 'Check out this post!';
    // If image param is passed, it should be the full URL we generated
    const metaImage = image || 'https://via.placeholder.com/1200x630.png?text=No+Image';
    const targetUrl = url || 'https://google.com';

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>${metaTitle}</title>
        
        <!-- Open Graph / Facebook -->
        <meta property="og:type" content="website">
        <meta property="og:url" content="${targetUrl}">
        <meta property="og:title" content="${metaTitle}">
        <meta property="og:description" content="${metaDesc}">
        <meta property="og:image" content="${metaImage}">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">

        <!-- Twitter -->
        <meta property="twitter:card" content="summary_large_image">
        <meta property="twitter:url" content="${targetUrl}">
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
        <p>Redirecting...</p>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
}
