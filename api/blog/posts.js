// ─────────────────────────────────────────────────────────────
// Blog de Candidatic IA — fuente de datos de las entradas.
//
// Para agregar una nueva entrada:
//   1. Copia un bloque (mira REAL_POSTS abajo), cámbiale slug/title/date/excerpt/cover/content.
//   2. La entrada con la fecha MÁS RECIENTE es la que abre /blog por default.
//   3. `cover` puede ser una URL absoluta o una ruta local (ej. "/blog/mi-foto.png",
//      subiendo la imagen a /public/blog/). Se usa también para el preview al compartir.
//   4. `content` es HTML: <p>, <h2>, <blockquote>, <ul>, <img>, etc. Diseño simple:
//      foto grande arriba, texto abajo.
//   5. Para que la entrada viva en candidatic.com/<slug> (URL limpia SEO), ponle
//      `root: true` Y agrega UNA línea de rewrite en vercel.json:
//        { "source": "/<slug>", "destination": "/api/blog/post?slug=<slug>" }
//      (ponla junto a las otras rutas /blog en vercel.json). Sin root:true la
//      entrada queda en candidatic.com/blog/<slug>, que también funciona.
//   6. Nombra la imagen con keywords SEO del sitio (ej. reclutamiento-masivo-whatsapp-*.png)
//      y súbela a /public/blog/.
// ─────────────────────────────────────────────────────────────

// ── Entradas reales ──────────────────────────────────────────
const REAL_POSTS = [
  {
    slug: 'reclutar-con-conversaciones-no-con-formularios',
    title: 'Reclutar con conversaciones, no con formularios',
    date: '2026-08-30',
    author: 'Equipo Candidatic',
    category: 'Reclutamiento con IA',
    // root:true → la entrada vive en candidatic.com/<slug> (URL limpia para SEO).
    // Requiere una línea de rewrite en vercel.json (ver instrucciones abajo).
    root: true,
    // Imagen con nombre SEO (reutiliza keywords del sitio: reclutamiento masivo + WhatsApp).
    cover: '/blog/reclutamiento-masivo-whatsapp-conversaciones.png',
    excerpt:
      'El siguiente gran cambio en Recursos Humanos no será encontrar más candidatos. Será poder conversar con ellos.',
    content: `
<p class="lede">El siguiente gran cambio en Recursos Humanos no será encontrar más candidatos. Será poder <strong>conversar</strong> con ellos.</p>

<p>Durante años, el formulario fue la puerta de entrada al reclutamiento digital. Publicamos una vacante, enviamos al candidato a una plataforma, solicitamos sus datos y esperamos que complete el proceso.</p>
<p>El modelo funcionó. Pero el mercado laboral cambió.</p>
<p>Hoy, los candidatos esperan experiencias más rápidas, simples y naturales. En México, <strong>86.1% de la población de 6 años o más utiliza internet</strong>, de acuerdo con INEGI, mientras que WhatsApp forma parte de la comunicación cotidiana de prácticamente todo el ecosistema digital mexicano.</p>

<blockquote>¿Por qué seguimos intentando reclutar como si el candidato quisiera llenar formularios, cuando lo que realmente quiere es encontrar una oportunidad?</blockquote>

<h2>El reclutamiento está pasando de formularios a conversaciones</h2>
<p>Una conversación permite algo que un formulario difícilmente puede lograr: entender el contexto de una persona.</p>
<p>Experiencia, disponibilidad, ubicación, expectativas, dudas, intereses y condiciones pueden conocerse de manera natural, mientras el sistema estructura esa información para que RH pueda tomar decisiones.</p>
<p>Esto adquiere todavía mayor relevancia en mercados como <strong>Nuevo León</strong>, donde las industrias de manufactura, logística, servicios y operaciones requieren procesos de contratación rápidos y de alto volumen.</p>
<p>Cuando una empresa necesita contratar decenas o cientos de personas, el reto deja de ser publicar vacantes. El reto es <strong>mantener conversaciones a escala</strong>.</p>
<p>Y ahí es donde la inteligencia artificial comienza a transformar el papel de Recursos Humanos.</p>
<p>Una IA puede iniciar conversaciones, realizar preguntas de filtro, responder dudas, identificar perfiles compatibles, dar seguimiento y llevar a un candidato hasta una entrevista.</p>
<p>No para sustituir al reclutador. Para darle capacidad.</p>
<p>El reclutador deja de invertir horas en tareas repetitivas y puede concentrarse en lo que realmente genera valor: evaluar personas, tomar decisiones y construir equipos.</p>

<h2>La tecnología debe quitar fricción, no humanidad</h2>
<p>El futuro del reclutamiento no consiste en eliminar todas las herramientas que utilizamos actualmente. Consiste en diseñar procesos donde la tecnología trabaje detrás de una experiencia mucho más humana.</p>
<p>El candidato no debería sentirse como un número dentro de una base de datos. Debería sentir que está hablando con una empresa que tiene interés real en conocerlo.</p>
<p>En Candidatic creemos que la conversación puede convertirse en la nueva interfaz del reclutamiento.</p>
<p>Porque el talento ya está conectado. Ahora Recursos Humanos necesita estar preparado para conversar con él.</p>
`.trim(),
  },
];

// ── Entradas de relleno (LOREM) — para poblar el layout/sidebar ──
const LOREM_BODY = `<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
<p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
<h2>El reto del reclutamiento masivo</h2>
<p>Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.</p>
<p>Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.</p>
<h2>Cómo la IA cambia el proceso</h2>
<p>At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.</p>
<p>Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus.</p>`;

const LOREM_TITLES = [
  'Reclutamiento masivo por WhatsApp: la guía completa 2026',
  'Cómo la inteligencia artificial pre-filtra candidatos en minutos',
  '5 métricas que todo reclutador operativo debe medir',
  'Reducir el costo por candidato calificado con automatización',
  'Entrevistas más rápidas: qué automatizar y qué no',
  'La experiencia del candidato como ventaja competitiva',
  'Rotación de personal operativo: causas y cómo anticiparla',
  'Reclutamiento en Nuevo León: retos y oportunidades del 2026',
  'Bots conversacionales: mitos y realidades en Recursos Humanos',
  'Del primer mensaje a la contratación: anatomía de un flujo',
];
const LOREM_CATEGORIES = [
  'Reclutamiento', 'Inteligencia Artificial', 'Métricas', 'Automatización',
  'Procesos', 'Experiencia', 'Rotación', 'Mercado', 'Tecnología', 'Estrategia',
];
const LOREM_DATES = [
  '2026-08-21', '2026-08-14', '2026-08-07', '2026-07-31', '2026-07-24',
  '2026-07-17', '2026-07-10', '2026-07-03', '2026-06-26', '2026-06-19',
];

const LOREM_POSTS = LOREM_TITLES.map((title, i) => {
  const n = i + 1;
  return {
    slug: `entrada-lorem-${n}`,
    title,
    date: LOREM_DATES[i],
    author: 'Equipo Candidatic',
    category: LOREM_CATEGORIES[i],
    cover: `https://picsum.photos/seed/candidatic-blog-${n}/1200/675`,
    excerpt:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.',
    content: LOREM_BODY,
  };
});

const POSTS = [...REAL_POSTS, ...LOREM_POSTS];

/** Todas las entradas ordenadas de más reciente a más antigua. */
export function getAllPosts() {
  return [...POSTS].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** La entrada más reciente (la que abre /blog). */
export function getLatestPost() {
  return getAllPosts()[0] || null;
}

/** Busca una entrada por su slug. */
export function getPostBySlug(slug) {
  return POSTS.find((p) => p.slug === slug) || null;
}
