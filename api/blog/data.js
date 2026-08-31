// /api/blog/data → JSON con todas las entradas (para el blog dentro de la SPA).
import { getAllPosts } from './posts.js';

export default function handler(req, res) {
  const posts = getAllPosts().map((p) => ({
    slug: p.slug,
    title: p.title,
    date: p.date,
    author: p.author,
    authorPhoto: p.authorPhoto || null,
    authorRole: p.authorRole || null,
    category: p.category,
    cover: p.cover || null,
    coverW: p.coverW || null,
    coverH: p.coverH || null,
    series: p.series || null,
    excerpt: p.excerpt,
    content: p.content,
    root: !!p.root,
  }));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).json({ posts });
}
