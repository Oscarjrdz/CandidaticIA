// Estaciones del Metro de Monterrey (Metrorrey), por línea activa (L1, L2, L3), en ORDEN OFICIAL.
// Coordenadas extraídas del nodo de ubicación del flujo (ruta "METRO"); el orden y los nombres se
// alinearon con las listas oficiales de Metrorrey (verificado 2026-10-30). Datos ESTÁTICOS embebidos
// a propósito (casi no cambian) → NO cuesta ancho de banda de Redis pintarlos. Colores oficiales:
// L1 amarillo, L2 verde, L3 rojo. Las estaciones de transbordo llevan transfer:true y aparecen en
// las dos líneas que correspondan (se pintan una sola vez: dedupe por coordenada en el mapa).
// Regenerar con scripts/debug/gen-metro-data.mjs.

export const METRO_LINES = [
    {
        "id": "L1",
        "nombre": "Línea 1",
        "color": "#eab308",
        "stops": [
            {
                "nombre": "Talleres",
                "lat": 25.759161,
                "lng": -100.368414
            },
            {
                "nombre": "San Bernabé",
                "lat": 25.748439,
                "lng": -100.361686
            },
            {
                "nombre": "Unidad Modelo",
                "lat": 25.741827,
                "lng": -100.355137
            },
            {
                "nombre": "Aztlán",
                "lat": 25.732114,
                "lng": -100.347268
            },
            {
                "nombre": "Penitenciaría",
                "lat": 25.723341,
                "lng": -100.342532
            },
            {
                "nombre": "Alfonso Reyes",
                "lat": 25.7155,
                "lng": -100.34247
            },
            {
                "nombre": "Mitras",
                "lat": 25.70599,
                "lng": -100.342443
            },
            {
                "nombre": "Simón Bolívar",
                "lat": 25.698757,
                "lng": -100.343197
            },
            {
                "nombre": "Hospital",
                "lat": 25.691943,
                "lng": -100.344081
            },
            {
                "nombre": "Edison",
                "lat": 25.68689,
                "lng": -100.33364
            },
            {
                "nombre": "Central",
                "lat": 25.686976,
                "lng": -100.324316
            },
            {
                "nombre": "Cuauhtémoc",
                "lat": 25.686114,
                "lng": -100.316891,
                "transfer": true
            },
            {
                "nombre": "Del Golfo",
                "lat": 25.685058,
                "lng": -100.30653
            },
            {
                "nombre": "Félix U. Gómez",
                "lat": 25.683993,
                "lng": -100.296811,
                "transfer": true
            },
            {
                "nombre": "Parque Fundidora",
                "lat": 25.683776,
                "lng": -100.288118
            },
            {
                "nombre": "Y Griega",
                "lat": 25.68325,
                "lng": -100.279423
            },
            {
                "nombre": "Eloy Cavazos",
                "lat": 25.680079,
                "lng": -100.264249
            },
            {
                "nombre": "Lerdo de Tejada",
                "lat": 25.679838,
                "lng": -100.252233
            },
            {
                "nombre": "Exposición",
                "lat": 25.679506,
                "lng": -100.245419
            }
        ]
    },
    {
        "id": "L2",
        "nombre": "Línea 2",
        "color": "#15803d",
        "stops": [
            {
                "nombre": "Sendero",
                "lat": 25.768618,
                "lng": -100.292879
            },
            {
                "nombre": "Santiago Tapia",
                "lat": 25.759423,
                "lng": -100.295639
            },
            {
                "nombre": "San Nicolás",
                "lat": 25.752684,
                "lng": -100.298044
            },
            {
                "nombre": "Anáhuac",
                "lat": 25.739941,
                "lng": -100.30261
            },
            {
                "nombre": "Universidad",
                "lat": 25.724472,
                "lng": -100.308182
            },
            {
                "nombre": "Niños Héroes",
                "lat": 25.7171,
                "lng": -100.31084
            },
            {
                "nombre": "Regina",
                "lat": 25.70786,
                "lng": -100.31406
            },
            {
                "nombre": "General Anaya",
                "lat": 25.696823,
                "lng": -100.317005
            },
            {
                "nombre": "Cuauhtémoc",
                "lat": 25.686114,
                "lng": -100.316891,
                "transfer": true
            },
            {
                "nombre": "Alameda",
                "lat": 25.677037,
                "lng": -100.318316
            },
            {
                "nombre": "Fundadores",
                "lat": 25.67226,
                "lng": -100.318797
            },
            {
                "nombre": "Padre Mier",
                "lat": 25.668611,
                "lng": -100.315461
            },
            {
                "nombre": "General I. Zaragoza",
                "lat": 25.667764,
                "lng": -100.310258,
                "transfer": true
            }
        ]
    },
    {
        "id": "L3",
        "nombre": "Línea 3",
        "color": "#dc2626",
        "stops": [
            {
                "nombre": "Hospital Metropolitano",
                "lat": 25.71398,
                "lng": -100.2733
            },
            {
                "nombre": "Los Ángeles",
                "lat": 25.70718,
                "lng": -100.28317
            },
            {
                "nombre": "Ruiz Cortines",
                "lat": 25.70326,
                "lng": -100.28866
            },
            {
                "nombre": "Colonia Moderna",
                "lat": 25.700271,
                "lng": -100.29286
            },
            {
                "nombre": "Metalúrgicos",
                "lat": 25.689996,
                "lng": -100.296107
            },
            {
                "nombre": "Félix U. Gómez",
                "lat": 25.683993,
                "lng": -100.296811,
                "transfer": true
            },
            {
                "nombre": "Colonia Obrera",
                "lat": 25.67837,
                "lng": -100.29765
            },
            {
                "nombre": "Santa Lucía",
                "lat": 25.67059,
                "lng": -100.29875
            },
            {
                "nombre": "General I. Zaragoza",
                "lat": 25.667764,
                "lng": -100.310258,
                "transfer": true
            }
        ]
    }
];
