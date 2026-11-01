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

// Baja de OpenStreetMap (Overpass) las zonas residenciales/barrios CON NOMBRE del AMM. Cachea en
// /tmp. Es la fuente de los polígonos REALES por colonia (contorno, no la zona del código postal).
const OSM_CACHE = path.join(TMP, 'osm-amm.json');
const OSM_BBOX = '25.40,-100.70,25.95,-99.90';   // sur,oeste,norte,este
async function fetchOSM() {
    if (fs.existsSync(OSM_CACHE) && fs.statSync(OSM_CACHE).size > 10000) {
        return JSON.parse(fs.readFileSync(OSM_CACHE, 'utf8'));
    }
    const q = `[out:json][timeout:180];(way["landuse"="residential"]["name"](${OSM_BBOX});relation["landuse"="residential"]["name"](${OSM_BBOX});way["place"~"^(neighbourhood|suburb|quarter)$"]["name"](${OSM_BBOX});relation["place"~"^(neighbourhood|suburb|quarter)$"]["name"](${OSM_BBOX}););out geom;`;
    const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
    for (const ep of endpoints) {
        try {
            console.log('↓ OSM Overpass', ep);
            const res = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'candidatic-colonias/1.0' } });
            if (!res.ok) { console.log('  HTTP', res.status); continue; }
            const data = await res.json();
            fs.writeFileSync(OSM_CACHE, JSON.stringify(data));
            return data;
        } catch (e) { console.log('  OSM falló:', e.message); }
    }
    console.log('  ⚠ OSM no disponible → se sigue sin polígonos reales (solo centroides).');
    return { elements: [] };
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

    // 2c. Polígonos REALES de OSM por colonia (contorno exacto, no la zona del CP). Se casa cada zona
    //     residencial con nombre de OSM contra la colonia del catálogo del mismo nombre y centro más
    //     cercano (<2.5 km). Produce el contorno por id + un centroide real (del polígono OSM).
    const distM = (a, b) => Math.hypot((a[0] - b[0]) * 111000, (a[1] - b[1]) * 111000 * Math.cos(a[0] * Math.PI / 180));
    const catByName = new Map();
    for (const c of catalog) { const k = norm(c.colonia); if (!catByName.has(k)) catByName.set(k, []); catByName.get(k).push(c); }
    const osmData = await fetchOSM();
    const coloniaPolys = {};   // id → rings [[ [lng,lat] ]]
    const osmCentroid = {};    // id → [lat,lng] (centroide del polígono OSM)
    const osmArea = {};        // id → área (para quedarnos con el polígono más grande si hay varios)
    let osmMatched = 0;
    for (const e of osmData.elements || []) {
        const name = e.tags?.name;
        if (!name || !Array.isArray(e.geometry) || e.geometry.length < 4) continue;
        const cands = catByName.get(norm(name));
        if (!cands) continue;
        const ringLngLat = e.geometry.map(p => [p.lon, p.lat]);
        const [clng, clat] = ringCentroid(ringLngLat);
        let best = null, bd = 1e9;
        for (const c of cands) { if (c.lat == null) continue; const d = distM([clat, clng], [c.lat, c.lng]); if (d < bd) { bd = d; best = c; } }
        if (!best || bd > 2500) continue;
        // área aprox para preferir el polígono mayor si una colonia casa con varias zonas OSM
        let a = 0; for (let i = 0, n = ringLngLat.length - 1; i < n; i++) a += ringLngLat[i][0] * ringLngLat[i + 1][1] - ringLngLat[i + 1][0] * ringLngLat[i][1];
        a = Math.abs(a / 2);
        if (osmArea[best.id] && osmArea[best.id] >= a) continue;
        osmArea[best.id] = a;
        const simp = dp(ringLngLat, 0.00012).map(([x, y]) => [round(x), round(y)]);   // ~12m tol
        if (simp.length < 4) continue;
        if (!(best.id in coloniaPolys)) osmMatched++;
        coloniaPolys[best.id] = [simp];
        osmCentroid[best.id] = [round(clat, 6), round(clng, 6)];
    }

    // 2d. Colonias GEOCODIFICADAS de OSM (las que dieron los candidatos y no estaban en SEPOMEX).
    //     Vienen de src/data/coloniasGeocoded.json (lo produce el merge tras la corrida de geocodeo).
    //     Cada una trae su punto (y contorno si OSM lo tenía). Se agregan como colonias nuevas.
    const geocodedCentroid = {};
    const geocodedPath = path.join(OUT, 'coloniasGeocoded.json');
    let geocodedAdded = 0;
    if (fs.existsSync(geocodedPath)) {
        let gj = {};
        try { gj = JSON.parse(fs.readFileSync(geocodedPath, 'utf8')); } catch { gj = {}; }
        const existing = new Set(catalog.map(c => c.id));
        for (const [id, e] of Object.entries(gj)) {
            if (id.startsWith('_') || !e || e.lat == null) continue;
            if (!AMM.has(e.municipio)) continue;
            if (!existing.has(id)) {
                catalog.push({ id, colonia: e.nombre, municipio: e.municipio, cp: '', tipo: '', lat: e.lat, lng: e.lng, hasGeom: true });
                existing.add(id);
                geocodedAdded++;
            }
            geocodedCentroid[id] = [round(e.lat, 6), round(e.lng, 6)];
            if (Array.isArray(e.poly) && e.poly.length && !coloniaPolys[id]) coloniaPolys[id] = e.poly;
        }
        catalog.sort((a, b) => a.municipio.localeCompare(b.municipio) || a.colonia.localeCompare(b.colonia));
    }

    // 3. Emitir los dos assets (misma estructura que consume src/components/MapSection.jsx).
    const munis = [...new Set(catalog.map(c => c.municipio))].sort((a, b) => a.localeCompare(b));
    const muniIdx = new Map(munis.map((m, i) => [m, i]));
    const tipos = [...new Set(catalog.map(c => c.tipo || ''))].sort();
    const tipoIdx = new Map(tipos.map((t, i) => [t, i]));
    const cpCentroid = {};
    for (const c of catalog) if (c.hasGeom && c.lat != null && cpCentroid[c.cp] === undefined) cpCentroid[c.cp] = [c.lat, c.lng];
    const rows = catalog.map(c => [c.colonia, muniIdx.get(c.municipio), c.cp, tipoIdx.get(c.tipo || '')]);

    // Centroide por colonia: override manual > OSM (catálogo) > geocodificado > (fallback runtime: CP).
    const coloniaCentroid = {};
    for (const c of catalog) {
        const v = overrides[c.id] || osmCentroid[c.id] || geocodedCentroid[c.id];
        if (v) coloniaCentroid[c.id] = v;
    }

    const moduleBody = buildModule(munis, tipos, cpCentroid, rows, catalog.length, coloniaCentroid);
    // Polígonos REALES por colonia (solo las que OSM tiene mapeadas). Sin fallback de CP: lo que no
    // esté aquí NO se colorea (se muestran sus pines, pero sin zona). Es lo que pidió el producto.
    const polyBody = `// AUTOGENERADO — contornos REALES de colonia (anillos [lng,lat]) de OpenStreetMap, por id de\n// colonia del catálogo. Import() PEREZOSO desde MapSection. SOLO incluye las colonias que OSM tiene\n// delineadas; las demás no se colorean (se muestran sus pines). Regenerar: node scripts/build-colonias-amm.mjs\nexport const COLONIA_POLYS = ${JSON.stringify(coloniaPolys)};\n`;

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'coloniasAMM.js'), moduleBody);
    fs.writeFileSync(path.join(OUT, 'coloniasAMMPolys.js'), polyBody);
    console.log(`✓ ${catalog.length} colonias (${geocodedAdded} geocodificadas nuevas) · ${munis.length} municipios · ${overrideCount} override(s) · ${Object.keys(coloniaPolys).length} con contorno`);
    console.log(`  coloniasAMM.js       ${(fs.statSync(path.join(OUT, 'coloniasAMM.js')).size / 1024).toFixed(1)} KB`);
    console.log(`  coloniasAMMPolys.js  ${(fs.statSync(path.join(OUT, 'coloniasAMMPolys.js')).size / 1024).toFixed(1)} KB`);
}

function buildModule(munis, tipos, cpCentroid, rows, n, coloniaCentroid) {
    return `// AUTOGENERADO — catálogo maestro de colonias del Área Metropolitana de Monterrey.
// Fuente: nombres del catálogo postal (SEPOMEX) + contornos/centroides REALES de OpenStreetMap.
// ${n} colonias, ${munis.length} municipios. Datos ESTÁTICOS embebidos (como Ecovía/Metro): NO cuestan
// ancho de banda de Redis. Centroide por colonia: override manual > centroide del polígono OSM > CP.
// Regenerar: node scripts/build-colonias-amm.mjs (lee overrides + baja OSM por Overpass).
export const AMM_MUNICIPIOS = ${JSON.stringify(munis)};
export const AMM_TIPOS = ${JSON.stringify(tipos)};
export const CP_CENTROID = ${JSON.stringify(cpCentroid)};
// Centroide por id de colonia (override manual u OSM). Si falta, se usa el del CP como respaldo.
export const COLONIA_CENTROID = ${JSON.stringify(coloniaCentroid || {})};
const ROWS = ${JSON.stringify(rows)};
function norm(s){return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().trim().replace(/\\s+/g,' ');}
function slug(s){return norm(s).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
const MUNI_ALIAS={'benito juarez':'juarez','escobedo':'general escobedo','san nicolas':'san nicolas de los garza','san nicolas de los garza nuevo leon':'san nicolas de los garza','san pedro':'san pedro garza garcia','garza garcia':'san pedro garza garcia','zuazua':'general zuazua','cadereyta':'cadereyta jimenez','cienega de flores nuevo leon':'cienega de flores'};
const muniN=(m)=>{const n=norm(m);return MUNI_ALIAS[n]||n;};
export const COLONIAS=ROWS.map(([nombre,mi,cp,ti])=>{const municipio=AMM_MUNICIPIOS[mi];const id=slug(municipio)+'__'+slug(nombre);const c=COLONIA_CENTROID[id]||CP_CENTROID[cp];return{id,nombre,municipio,cp,tipo:AMM_TIPOS[ti]||'',lat:c?c[0]:null,lng:c?c[1]:null};});
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
