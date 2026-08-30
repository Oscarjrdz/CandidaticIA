// /blog/:slug → muestra una entrada específica.
import { getAllPosts, getPostBySlug, getLatestPost } from './posts.js';
import { renderPostPage } from './render.js';

export default function handler(req, res) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const origin = `${proto}://${host}`;

  const slug = (req.query.slug || '').toString();
  const post = getPostBySlug(slug);

  if (!post) {
    // Entrada inexistente → redirige a la más reciente.
    const latest = getLatestPost();
    if (latest) {
      res.writeHead(302, { Location: `${origin}/blog/${latest.slug}` });
      res.end();
      return;
    }
    res.status(404).send('Entrada no encontrada');
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(renderPostPage(post, getAllPosts(), origin));
}
