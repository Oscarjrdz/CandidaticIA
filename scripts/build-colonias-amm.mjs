#!/usr/bin/env node
/**
 * Regenera el catálogo maestro de colonias del AMM en src/data/:
 *   - src/data/coloniasAMM.js       (nombres + centroides + matcher; carga con la sección Mapa)
 *   - src/data/coloniasAMMPolys.js  (polígonos por CP; import() perezoso)
 *
 * Fuentes (abiertas, se descargan a /tmp si no existen):
 *   - Polígonos por código postal de Nuevo León (SEPOMEX):
 *       https://raw.githubusercontent.com/open-mexico/mexico-geojson/main/19-NL.geojson
 *   - Catálogo postal de Nuevo León (CP → colonia, municipio, tipo, zona):
 *       https://raw.githubusercontent.com/gomflo/codigos-postales-mexico/main/data/mx/por-estado/nuevo-leon.csv
 *
 * Uso:  node scripts/build-colonias-amm.mjs
 * Para ampliar la cobertura (más municipios), edita el set AMM de abajo y vuelve a correr.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'data');
const TMP = '/tmp';
const GEO = path.join(TMP, 'nl.geojson');
const CSV = path.join(TMP, 'nl_cp.csv');
const GEO_URL = 'https://raw.githubusercontent.com/open-mexico/mexico-geojson/main/19-NL.geojson';
const CSV_URL = 'https://raw.githubusercontent.com/gomflo/codigos-postales-mexico/main/data/mx/por-estado/nuevo-leon.csv';

// Municipios del Área Metropolitana de Monterrey (ZMM).
const AMM = new Set([
    'Monterrey', 'Guadalupe', 'San Nicolás de los Garza', 'Apodaca',
    'General Escobedo', 'Santa Catarina', 'San Pedro Garza García', 'García',
    'Juárez', 'Salinas Victoria', 'Pesquería', 'Ciénega de Flores',
    'General Zuazua', 'El Carmen', 'Hidalgo', 'Abasolo', 'Santiago', 'Cadereyta Jiménez'
]);

function download(url, dest) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return resolve();
        console.log('↓', url);
        const file = fs.createWriteStream(dest);
        https.get(url, (res) => {
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${url}`));
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', reject);
    });
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const round = (n, d = 5) => Math.round(n * 10 ** d) / 10 ** d;

function parseCSV(text) {
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
        else if (c === '"') q = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
}

function ringCentroid(ring) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = ring.length - 1; i < n; i++) {
        const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
        const f = x0 * y1 - x1 * y0; a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    if (Math.abs(a) < 1e-12) { let sx = 0, sy = 0; for (const [x, y] of ring) { sx += x; sy += y; } return [sx / ring.length, sy / ring.length]; }
    a *= 0.5; return [cx / (6 * a), cy / (6 * a)];
}
function dp(points, tol) {
    if (points.length < 3) return points;
    const sq = (p, a, b) => { let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y; if (dx || dy) { const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy); if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; } } dx = p[0] - x; dy = p[1] - y; return dx * dx + dy * dy; };
    const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]], tol2 = tol * tol;
    while (stack.length) { const [a, b] = stack.pop(); let maxD = 0, idx = -1; for (let i = a + 1; i < b; i++) { const d = sq(points[i], points[a], points[b]); if (d > maxD) { maxD = d; idx = i; } } if (maxD > tol2 && idx > -1) { keep[idx] = 1; stack.push([a, idx], [idx, b]); } }
    const out = []; for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]); return out;
}

async function main() {
    await download(GEO_URL, GEO);
    await download(CSV_URL, CSV);

    // 1. GeoJSON → centroide + anillos simplificados por CP.
    const geo = JSON.parse(fs.readFileSync(GEO, 'utf8'));
    const cpGeom = new Map();
    for (const f of geo.features) {
        const cp = String(f.properties?.d_codigo ?? '').padStart(5, '0');
        if (!cp || cp === '00000') continue;
        const g = f.geometry; if (!g) continue;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        let best = null, bestArea = -1; const rings = [];
        for (const poly of polys) {
            const outer = poly[0]; if (!outer || outer.length < 4) continue;
            rings.push(dp(outer, 0.00025).map(([x, y]) => [round(x), round(y)]));
            let a = 0; for (let i = 0, n = outer.length - 1; i < n; i++) a += outer[i][0] * outer[i + 1][1] - outer[i + 1][0] * outer[i][1];
            a = Math.abs(a / 2); if (a > bestArea) { bestArea = a; best = outer; }
        }
        if (!rings.length || !best) continue;
        const [lng, lat] = ringCentroid(best);
        cpGeom.set(cp, { lat: round(lat, 6), lng: round(lng, 6), rings });
    }

    // 2. CSV → colonias del AMM (dedupe por id compuesto).
    const csv = parseCSV(fs.readFileSync(CSV, 'utf8').replace(/^﻿/, ''));
    const header = csv.shift().map(h => h.trim());
    const ci = Object.fromEntries(header.map((h, i) => [h, i]));
    const catalog = []; const seen = new Set(); const cpsUsed = new Set();
    for (const r of csv) {
        if (!r || r.length < 5) continue;
        const municipio = (r[ci.municipio] || '').trim();
        if (!AMM.has(municipio)) continue;
        const colonia = (r[ci.asentamiento] || '').trim();
        const cp = String(r[ci.codigo_postal] || '').trim().padStart(5, '0');
        if (!colonia || !cp) continue;
        const id = `${slug(municipio)}__${slug(colonia)}`;
        if (seen.has(id)) continue; seen.add(id);
        const gm = cpGeom.get(cp); if (gm) cpsUsed.add(cp);
        catalog.push({ id, colonia, municipio, cp, tipo: (r[ci.tipo] || '').trim(), lat: gm ? gm.lat : null, lng: gm ? gm.lng : null, hasGeom: !!gm });
    }
    catalog.sort((a, b) => a.municipio.localeCompare(b.municipio) || a.colonia.localeCompare(b.colonia));

    // 2b. Overrides manuales de centroide por colonia (cuando el centroide del CP queda corrido).
    const overridesPath = path.join(OUT, 'coloniasAMMOverrides.json');
    let overrides = {};
    if (fs.existsSync(overridesPath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
            for (const [k, v] of Object.entries(raw)) {
                if (k.startsWith('_')) continue;           // claves de comentario
                if (Array.isArray(v) && v.length === 2) overrides[k] = [round(v[0], 6), round(v[1], 6)];
            }
        } catch { overrides = {}; }
    }
    const overrideCount = Object.keys(overrides).length;

    // 3. Emitir los dos assets (misma estructura que consume src/components/MapSection.jsx).
    const munis = [...new Set(catalog.map(c => c.municipio))].sort((a, b) => a.localeCompare(b));
    const muniIdx = new Map(munis.map((m, i) => [m, i]));
    const tipos = [...new Set(catalog.map(c => c.tipo || ''))].sort();
    const tipoIdx = new Map(tipos.map((t, i) => [t, i]));
    const cpCentroid = {};
    for (const c of catalog) if (c.hasGeom && c.lat != null && cpCentroid[c.cp] === undefined) cpCentroid[c.cp] = [c.lat, c.lng];
    const rows = catalog.map(c => [c.colonia, muniIdx.get(c.municipio), c.cp, tipoIdx.get(c.tipo || '')]);
    const polygons = {}; for (const cp of cpsUsed) polygons[cp] = cpGeom.get(cp).rings;

    // El cuerpo del módulo (matcher) se mantiene en sync con la versión comentada en src/data.
    // Para no duplicar aquí la lógica, reusamos el generador detallado del scratchpad si existe;
    // si no, emitimos la plantilla mínima equivalente.
    const moduleBody = buildModule(munis, tipos, cpCentroid, rows, catalog.length, overrides);
    const polyBody = `// AUTOGENERADO — polígonos (anillos [lng,lat] simplificados ~25m) por código postal del AMM.\n// Import() PEREZOSO desde MapSection (solo al abrir el filtro de Colonias). Varias colonias comparten\n// el polígono de su CP. Regenerar: node scripts/build-colonias-amm.mjs\nexport const CP_POLYS = ${JSON.stringify(polygons)};\n`;

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'coloniasAMM.js'), moduleBody);
    fs.writeFileSync(path.join(OUT, 'coloniasAMMPolys.js'), polyBody);
    console.log(`✓ ${catalog.length} colonias · ${munis.length} municipios · ${cpsUsed.size} CPs con polígono · ${overrideCount} override(s) de centroide`);
    console.log(`  coloniasAMM.js       ${(fs.statSync(path.join(OUT, 'coloniasAMM.js')).size / 1024).toFixed(1)} KB`);
    console.log(`  coloniasAMMPolys.js  ${(fs.statSync(path.join(OUT, 'coloniasAMMPolys.js')).size / 1024).toFixed(1)} KB`);
}

function buildModule(munis, tipos, cpCentroid, rows, n, overrides) {
    return `// AUTOGENERADO — catálogo maestro de colonias del Área Metropolitana de Monterrey.
// Fuente: polígonos por CP de open-mexico/mexico-geojson (SEPOMEX) + nombres del catálogo postal
// gomflo/codigos-postales-mexico, unidos por código postal. ${n} colonias, ${munis.length} municipios.
// Datos ESTÁTICOS embebidos a propósito (como Ecovía/Metro): NO cuestan ancho de banda de Redis.
// Centroides: del polígono del CP, salvo los de COLONIA_OVERRIDES (ajustes manuales por colonia).
// Regenerar: node scripts/build-colonias-amm.mjs (lee src/data/coloniasAMMOverrides.json)
export const AMM_MUNICIPIOS = ${JSON.stringify(munis)};
export const AMM_TIPOS = ${JSON.stringify(tipos)};
export const CP_CENTROID = ${JSON.stringify(cpCentroid)};
// Override de centroide por id de colonia (cuando el centro del CP queda corrido respecto a la real).
export const COLONIA_OVERRIDES = ${JSON.stringify(overrides || {})};
const ROWS = ${JSON.stringify(rows)};
function norm(s){return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().trim().replace(/\\s+/g,' ');}
function slug(s){return norm(s).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
const MUNI_ALIAS={'benito juarez':'juarez','escobedo':'general escobedo','san nicolas':'san nicolas de los garza','san nicolas de los garza nuevo leon':'san nicolas de los garza','san pedro':'san pedro garza garcia','garza garcia':'san pedro garza garcia','zuazua':'general zuazua','cadereyta':'cadereyta jimenez','cienega de flores nuevo leon':'cienega de flores'};
const muniN=(m)=>{const n=norm(m);return MUNI_ALIAS[n]||n;};
export const COLONIAS=ROWS.map(([nombre,mi,cp,ti])=>{const municipio=AMM_MUNICIPIOS[mi];const id=slug(municipio)+'__'+slug(nombre);const c=COLONIA_OVERRIDES[id]||CP_CENTROID[cp];return{id,nombre,municipio,cp,tipo:AMM_TIPOS[ti]||'',lat:c?c[0]:null,lng:c?c[1]:null};});
const _byMuniCol=new Map(),_byColOnly=new Map(),_muniColonias=new Map(),_idMuni=new Map();
for(const c of COLONIAS){const nm=muniN(c.municipio),nc=norm(c.nombre);_byMuniCol.set(nm+'|'+nc,c.id);if(!_byColOnly.has(nc))_byColOnly.set(nc,new Set());_byColOnly.get(nc).add(c.id);if(!_muniColonias.has(nm))_muniColonias.set(nm,[]);_muniColonias.get(nm).push({nc,id:c.id});_idMuni.set(c.id,nm);}
function _fuzzyInMuni(nmun,ncol){const list=_muniColonias.get(nmun);if(!list)return null;let best=null,bestLen=0;for(const{nc,id}of list){if(nc.length<8)continue;if(ncol===nc||ncol.startsWith(nc+' ')||ncol.endsWith(' '+nc)){if(nc.length>bestLen){best=id;bestLen=nc.length;}}}return best;}
const _hasVal=(v)=>{const s=norm(v);return s.length>0&&!s.includes('proporcionad')&&!['n/a','na','null','ninguno','ninguna','none','-','desconocido','undefined','sin colonia'].includes(s);};
/** Resuelve el texto libre (municipio+colonia) de un candidato al id del catálogo, o null. */
export function matchColoniaId(municipio,colonia){
  if(!_hasVal(colonia))return null;
  const ncol=norm(colonia),hasMuni=_hasVal(municipio),nmun=hasMuni?muniN(municipio):'';
  if(hasMuni){const exact=_byMuniCol.get(nmun+'|'+ncol);if(exact)return exact;}
  const only=_byColOnly.get(ncol);
  if(only&&only.size===1){const id=[...only][0];if(!hasMuni)return id;const idm=_idMuni.get(id);if(idm&&(idm===nmun||nmun.includes(idm)||idm.includes(nmun)))return id;}
  if(hasMuni){const fuzzy=_fuzzyInMuni(nmun,ncol);if(fuzzy)return fuzzy;}
  return null;
}
`;
}

main().catch(e => { console.error(e); process.exit(1); });
