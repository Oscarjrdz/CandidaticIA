// Lógica pura de los candados de nodo del editor de flujos. SIN React → testeable aparte.
//
// El candado es POR USUARIO POR NODO (no parte del flujo compartido): vive en las
// preferencias del reclutador como:
//   preferences.flowNodeLocks = { [flowId]: { [nodeId]: true } }
// Solo se guardan los nodos CERRADOS (true); la ausencia = abierto. Como saveUser mergea
// shallow al top-level del usuario, siempre se manda el objeto `preferences` COMPLETO.

// Candados (mapa nodeId→true) de un flujo. Devuelve {} si no hay.
export function getFlowLocks(preferences, flowId) {
    return preferences?.flowNodeLocks?.[flowId] || {};
}

// ¿Ese nodo está bloqueado para este usuario en este flujo?
export function isNodeLocked(preferences, flowId, nodeId) {
    return !!getFlowLocks(preferences, flowId)[nodeId];
}

// Migración una-sola-vez por usuario+flujo: si este flujo NUNCA se ha inicializado (no existe
// su llave en flowNodeLocks), cierra TODOS los nodos actuales — así "lo ya hecho" nace
// protegido. Los nodos que se agreguen después no estarán en el mapa → nacen abiertos.
// Distingue "no inicializado" (llave ausente) de "inicializado y todo abierto" (llave = {}),
// para no volver a cerrar todo si el usuario abrió los candados a mano.
// Devuelve { preferences, changed }.
export function initFlowLocksIfNeeded(preferences, flowId, nodeIds) {
    const prefs = preferences || {};
    const allLocks = prefs.flowNodeLocks || {};
    if (allLocks[flowId] !== undefined) return { preferences: prefs, changed: false };
    const flowLocks = {};
    for (const id of (nodeIds || [])) flowLocks[id] = true;
    return {
        preferences: { ...prefs, flowNodeLocks: { ...allLocks, [flowId]: flowLocks } },
        changed: true
    };
}

// Devuelve un NUEVO objeto `preferences` con el candado del nodo alternado (abre↔cierra),
// preservando el resto de preferencias y los candados de otros flujos/nodos.
export function toggleNodeLock(preferences, flowId, nodeId) {
    const prefs = preferences || {};
    const allLocks = prefs.flowNodeLocks || {};
    const flowLocks = { ...(allLocks[flowId] || {}) };
    if (flowLocks[nodeId]) delete flowLocks[nodeId]; // estaba cerrado → abrir (se quita)
    else flowLocks[nodeId] = true;                    // estaba abierto → cerrar
    return { ...prefs, flowNodeLocks: { ...allLocks, [flowId]: flowLocks } };
}
