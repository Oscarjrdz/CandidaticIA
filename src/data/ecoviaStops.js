// Paradas de la Ecovía (Monterrey). Datos de referencia ESTÁTICOS extraídos del nodo de
// ubicación del flujo "COMPLETOS NUEVOS (OCTUBRE)" (ruta "ECOVIA") el 2026-10-30. Se embeben en
// el frontend a propósito: son datos que casi no cambian y así NO cuesta ancho de banda de Redis
// pintarlos en el mapa. Si las paradas cambian en el flujo, regenerar con scripts/debug/gen-ecovia-data.mjs.
// (Se excluye "STUCKI DE MEXICO" que venía en esa ruta: es un centro de trabajo, no una parada.)

export const ECOVIA_STOPS = [
    {
        "nombre": "Ecovía · Lincoln",
        "lat": 25.769873,
        "lng": -100.4209
    },
    {
        "nombre": "Ecovía · Astros",
        "lat": 25.763373,
        "lng": -100.407563
    },
    {
        "nombre": "Ecovía · Cumbres",
        "lat": 25.7597,
        "lng": -100.40245
    },
    {
        "nombre": "Ecovía · Plumbago",
        "lat": 25.75605,
        "lng": -100.3975
    },
    {
        "nombre": "Ecovía · Plutarco Elias Calles",
        "lat": 25.752294,
        "lng": -100.392234
    },
    {
        "nombre": "Ecovía · Embotelladora",
        "lat": 25.74894,
        "lng": -100.38757
    },
    {
        "nombre": "Ecovía · Panteon Municipal",
        "lat": 25.74258,
        "lng": -100.38138
    },
    {
        "nombre": "Ecovía · Cardenal",
        "lat": 25.738929,
        "lng": -100.378148
    },
    {
        "nombre": "Ecovía · Valle Verde",
        "lat": 25.73343,
        "lng": -100.3732
    },
    {
        "nombre": "Ecovía · Cardiologia",
        "lat": 25.72985,
        "lng": -100.36999
    },
    {
        "nombre": "Ecovía · Santa Cecilia",
        "lat": 25.726129,
        "lng": -100.3666
    },
    {
        "nombre": "Ecovía · Villa Mitras",
        "lat": 25.723579,
        "lng": -100.363722
    },
    {
        "nombre": "Ecovía · Rangel Frias",
        "lat": 25.719235,
        "lng": -100.357343
    },
    {
        "nombre": "Ecovía · Transito",
        "lat": 25.716995,
        "lng": -100.353846
    },
    {
        "nombre": "Ecovía · Laredo",
        "lat": 25.712296,
        "lng": -100.346761
    },
    {
        "nombre": "Ecovía · Rodrigo Gomez",
        "lat": 25.71007,
        "lng": -100.34342
    },
    {
        "nombre": "Ecovía · Mitras",
        "lat": 25.70599,
        "lng": -100.342443
    },
    {
        "nombre": "Ecovía · Celulosa",
        "lat": 25.704801,
        "lng": -100.337762
    },
    {
        "nombre": "Ecovía · 20 de Noviembre",
        "lat": 25.704672,
        "lng": -100.332465
    },
    {
        "nombre": "Ecovía · Hidalgo",
        "lat": 25.704391,
        "lng": -100.322273
    },
    {
        "nombre": "Ecovía · Bella Vista",
        "lat": 25.70433,
        "lng": -100.31888
    },
    {
        "nombre": "Ecovía · Asarco",
        "lat": 25.704132,
        "lng": -100.309208
    },
    {
        "nombre": "Ecovía · Cementos",
        "lat": 25.703895,
        "lng": -100.297109
    },
    {
        "nombre": "Ecovía · Ruiz Cortines",
        "lat": 25.7037,
        "lng": -100.28892
    },
    {
        "nombre": "Ecovía · Clinica 15",
        "lat": 25.70369,
        "lng": -100.284
    },
    {
        "nombre": "Ecovía · Coyoacan",
        "lat": 25.703593,
        "lng": -100.27869
    },
    {
        "nombre": "Ecovía · Churubusco",
        "lat": 25.703485,
        "lng": -100.269367
    },
    {
        "nombre": "Ecovía · Vidriera",
        "lat": 25.703288,
        "lng": -100.260681
    },
    {
        "nombre": "Ecovía · Adolfo Prieto",
        "lat": 25.70312,
        "lng": -100.25407
    },
    {
        "nombre": "Ecovía · Las Americas",
        "lat": 25.70299,
        "lng": -100.24717
    },
    {
        "nombre": "Ecovía · Central de Carga",
        "lat": 25.702898,
        "lng": -100.238875
    },
    {
        "nombre": "Ecovía · Tauro",
        "lat": 25.702749,
        "lng": -100.230189
    },
    {
        "nombre": "Ecovía · Miguel Aleman",
        "lat": 25.702676,
        "lng": -100.223431
    },
    {
        "nombre": "Ecovía · Calle Nueva",
        "lat": 25.702981,
        "lng": -100.217588
    },
    {
        "nombre": "Ecovía · De La Zanja",
        "lat": 25.70455,
        "lng": -100.20831
    },
    {
        "nombre": "Ecovía · Aceros",
        "lat": 25.707641,
        "lng": -100.200336
    },
    {
        "nombre": "Ecovía · Guadalajara",
        "lat": 25.708832,
        "lng": -100.194458
    },
    {
        "nombre": "Ecovía · San Miguel",
        "lat": 25.70903,
        "lng": -100.18809
    },
    {
        "nombre": "Ecovía · Valle Fertil",
        "lat": 25.70554,
        "lng": -100.16618
    },
    {
        "nombre": "Ecovía · Valle Soleado",
        "lat": 25.704504,
        "lng": -100.158373
    }
];
