// /blog → muestra la entrada MÁS RECIENTE del blog.
import { getAllPosts, getLatestPost } from './posts.js';
import { renderPostPage } from './render.js';

export default function handler(req, res) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const origin = `${proto}://${host}`;

  const latest = getLatestPost();
  if (!latest) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send('<!DOCTYPE html><meta charset="utf-8"><p style="font-family:sans-serif;padding:40px">Aún no hay entradas en el blog.</p>');
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).send(renderPostPage(latest, getAllPosts(), origin));
}
