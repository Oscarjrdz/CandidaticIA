import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
    addEdge, applyNodeChanges, applyEdgeChanges, BackgroundVariant,
    useReactFlow
} from '@xyflow/react';
import { Copy, Trash2 } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { useToastContext } from '../../contexts/ToastContext';
import { useAuthContext } from '../../contexts/AuthContext';
import { getFlowLocks, toggleNodeLock, initFlowLocksIfNeeded } from '../../utils/nodeLocks';
import { getFlow, updateFlow, getFlowsMeta, getFlowCounters, getQuickReplies, getReminderTemplates, getManualProjects, testFlow, getFilteredFlowCandidates, runFlowListItem } from '../../services/flowsService';
import { flowNodeTypes, COLOR_CLASSES, NODE_DEFS } from './nodeTypes';
import FlowEdge from './edgeTypes/FlowEdge';
import NodeConfigDrawer from './NodeConfigDrawer';
import FlowToolbar from './FlowToolbar';

const flowEdgeTypes = { default: FlowEdge };

const DEFAULT_DATA_BY_TYPE = {
    etiqueta: { mode: 'todas' },
    condicion_genero: { generos: [] },
    condicion_edad: { min: null, max: null },
    condicion_municipio: { municipios: [] },
    condicion_categoria: { categorias: [] },
    condicion_escolaridad: { escolaridades: [] },
    accion_whatsapp: { quickReplyId: '', quickReplyName: '' },
    accion_vacante: { vacancyId: '', vacancyName: '' },
    accion_whatsapp_personalizado: { message: '' },
    frase_dinamica: { value: '' },
    accion_etiqueta: { tag: '' },
    accion_quitar_etiqueta: { tag: '' },
    accion_limpiar_etiquetas: {},
    accion_recordatorio: { templateId: '', templateName: '' },
    accion_proyecto: { projectId: '', projectName: '' },
    accion_marcar_leido: {},
    accion_desactivar_bot: {},
    accion_reactivar_bot: {},
    esperando_respuesta: { grupos: [{ id: 'g1', label: '', frases: [] }], matchMode: 'contiene', timeoutHoras: 48 },
    contador: { label: '' },
    checkpoint: { name: '' },
    test: { testPhone: '' },
    nota: { text: '' },
    // Elementos decorativos (el motor los ignora, van a la par de "Agregar nodo"):
    bg: { color: '#6366f1', opacity: 0.14 },              // fondo de sección: color + transparencia
    texto: { text: '', fontSize: 18, color: '#111827' }    // texto libre: contenido + tamaño + color
};

const stripTransientData = (data = {}) => {
    const {
        onConfigure, onDelete, onTestPhoneChange, onTestRun, onToggleActive, liveCount, active,
        testStatus, testMessage, testPassed, onLoadList, onRunList, candidateList, listStatus, runningCandidateId,
        onNotaChange, onElementChange, onDuplicate,
        ...rest
    } = data;
    return rest;
};

// Dimensiones a PERSISTIR de un nodo. Los elementos decorativos (bg/texto) son
// redimensionables y su tamaño debe guardarse; si nunca se redimensionaron a mano el tamaño
// vive en `measured` (React Flow) y NO en top-level → se usa measured como respaldo. Sin
// esto, un bg recargado nacería sin dimensiones (invisible, no tiene contenido que lo
// dimensione) y un texto se colapsaría — el bug de "el clon desaparece al recargar". Los
// nodos funcionales no guardan tamaño (se auto-ajustan al contenido).
const persistableDims = (n) => {
    const resizable = n.type === 'bg' || n.type === 'texto';
    const w = Number.isFinite(n.width) ? n.width : (resizable && Number.isFinite(n.measured?.width) ? n.measured.width : undefined);
    const h = Number.isFinite(n.height) ? n.height : (resizable && Number.isFinite(n.measured?.height) ? n.measured.height : undefined);
    const out = {};
    if (Number.isFinite(w)) out.width = w;
    if (Number.isFinite(h)) out.height = h;
    if (typeof n.zIndex === 'number') out.zIndex = n.zIndex;
    return out;
};

// Portapapeles de selección (nodos+aristas) — persiste en localStorage para poder pegar
// partes de un flujo en OTRO flujo. Los nodos de inicio nunca se clonan/copian (un flujo
// tiene una sola raíz). IDs nuevos siempre, para no chocar con los existentes.
const CLIPBOARD_KEY = 'flow_editor_clipboard_v1';
const ENTRY_TYPES = new Set(['inicio', 'inicio_lista', 'inicio_incompleto_silencio']);
const EMPTY_LOCKS = {}; // ref estable para el default de candados (evita recalcular el memo)
const genNodeId = () => `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const genEdgeId = () => `e${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const FlowEditorInner = ({ flowId, onBack }) => {
    const { showToast } = useToastContext();
    const { user, setUser } = useAuthContext();
    // Ref al usuario actual: la migración de candados corre dentro del efecto de carga
    // (deps [flowId]); leer por ref evita meter `user` a las deps (recargaría el flujo en
    // cada toggle) y evita cierre obsoleto.
    const userRef = useRef(user);
    userRef.current = user;
    const [flowMeta, setFlowMeta] = useState({ name: '', active: false });
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);
    const [meta, setMeta] = useState({ municipios: [], categorias: [], escolaridades: [], tags: [], vacantes: [] });
    const [quickReplies, setQuickReplies] = useState([]);
    const [reminderTemplates, setReminderTemplates] = useState([]);
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    // Selección múltiple (rubber-band): ids seleccionados + posición del mini-menú flotante.
    const [selectedIds, setSelectedIds] = useState([]);
    const [selMenu, setSelMenu] = useState(null); // { x, y } en coords de pantalla
    const [canPaste, setCanPaste] = useState(() => { try { return !!localStorage.getItem(CLIPBOARD_KEY); } catch { return false; } });
    const rf = useReactFlow();
    const handleTestRunRef = useRef(null);
    const handleLoadListRef = useRef(null);
    const handleRunListRef = useRef(null);
    const handleDuplicateNodeRef = useRef(null);

    const handleConfigure = useCallback((nodeId) => setSelectedNodeId(nodeId), []);

    const handleDeleteNode = useCallback((nodeId) => {
        setNodes(nds => nds.filter(n => n.id !== nodeId));
        setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
        setSelectedNodeId(sel => sel === nodeId ? null : sel);
        setDirty(true);
    }, []);

    const handleDeleteEdge = useCallback((edgeId) => {
        setEdges(eds => eds.filter(e => e.id !== edgeId));
        setDirty(true);
    }, []);

    // La arista de la rama "No cumple" (sourceHandle === 'no') se pinta roja para que se
    // distinga de un vistazo de la rama normal (indigo). El resto conserva el indigo de
    // defaultEdgeOptions.
    const hydrateEdge = useCallback((e) => ({
        ...e,
        style: e.sourceHandle === 'no'
            ? { stroke: '#f87171', strokeWidth: 2 }
            : { stroke: '#a5b4fc', strokeWidth: 2 },
        data: { ...e.data, onDelete: handleDeleteEdge }
    }), [handleDeleteEdge]);

    const handleTestPhoneChange = useCallback((nodeId, phone) => {
        setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, testPhone: phone } } : n));
    }, []);

    const handleNotaChange = useCallback((nodeId, text) => {
        setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, text } } : n));
        setDirty(true);
    }, []);

    // Cambios de estilo/contenido de los elementos decorativos (bg / texto): color,
    // transparencia, tamaño de letra, texto. Igual que handleNodeConfigChange pero definido
    // antes de hydrateNode para poder inyectarlo en node.data sin caer en TDZ.
    const handleElementChange = useCallback((nodeId, patch) => {
        setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n));
        setDirty(true);
    }, []);

    // Candado POR USUARIO POR NODO: no es parte del flujo (compartido) sino de las
    // preferencias del reclutador (user.preferences.flowNodeLocks[flowId][nodeId] = true).
    // Mismo patrón de persistencia que el banco de respuestas / orden de columnas: se
    // manda el objeto `preferences` COMPLETO porque saveUser mergea shallow al top-level.
    // NO usa setDirty: el candado se guarda solo, aparte del guardado del flujo.
    const handleToggleLock = useCallback((nodeId) => {
        if (!user?.id) return;
        const nextPreferences = toggleNodeLock(user.preferences, flowId, nodeId);
        setUser(prev => prev ? { ...prev, preferences: nextPreferences } : prev);
        fetch('/api/users', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: user.id, preferences: nextPreferences })
        }).catch(() => {});
    }, [user, setUser, flowId]);

    const hydrateNode = useCallback((n) => ({
        ...n,
        // Los nodos de inicio no se pueden borrar (ni con Suprimir ni con la caja de selección):
        // borrar la raíz corrompería el flujo. Su botón X ya venía oculto en FlowNode.
        deletable: !ENTRY_TYPES.has(n.type),
        // z-index por banda: el fondo (bg) SIEMPRE detrás, el texto encima de todo, los
        // nodos funcionales en medio. Con elevateNodesOnSelect desactivado, seleccionar un bg
        // para recolorearlo no lo trae al frente tapando los nodos (igual que n8n).
        zIndex: n.zIndex ?? (n.type === 'bg' ? 0 : n.type === 'texto' ? 20 : 10),
        data: {
            ...n.data,
            onConfigure: handleConfigure,
            onDelete: handleDeleteNode,
            onTestPhoneChange: handleTestPhoneChange,
            onNotaChange: handleNotaChange,
            onElementChange: handleElementChange,
            onTestRun: (nodeId, phone) => handleTestRunRef.current?.(nodeId, phone),
            onLoadList: (nodeId) => handleLoadListRef.current?.(nodeId),
            onRunList: (nodeId) => handleRunListRef.current?.(nodeId),
            onDuplicate: (nodeId) => handleDuplicateNodeRef.current?.(nodeId)
        }
    }), [handleConfigure, handleDeleteNode, handleTestPhoneChange, handleNotaChange, handleElementChange]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const [flowRes, metaRes, qrRes, rtRes, projRes] = await Promise.all([
                getFlow(flowId), getFlowsMeta(), getQuickReplies(), getReminderTemplates(), getManualProjects()
            ]);
            if (cancelled) return;

            if (!flowRes.success) {
                showToast('Error cargando el flujo', 'error');
                setLoading(false);
                return;
            }

            const flow = flowRes.flow;
            setFlowMeta({ name: flow.name, active: !!flow.active });
            const loadedNodes = (flow.nodes || []).map(n => hydrateNode(n));
            setNodes(loadedNodes);
            // Migración una-sola-vez: los nodos que YA existían nacen CERRADOS (protege lo ya
            // hecho); los que se agreguen después nacen abiertos. No hace nada si este flujo ya
            // se inicializó para este usuario (aunque los haya abierto todos a mano).
            const u = userRef.current;
            if (u?.id) {
                const { preferences: nextPreferences, changed } = initFlowLocksIfNeeded(u.preferences, flowId, loadedNodes.map(n => n.id));
                if (changed) {
                    setUser(prev => prev ? { ...prev, preferences: nextPreferences } : prev);
                    fetch('/api/users', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: u.id, preferences: nextPreferences })
                    }).catch(() => {});
                }
            }
            // Migración visual: las aristas guardadas ANTES de que existieran los nodos con
            // rama (Sí/No) no tienen sourceHandle. Ahora los nodos "branching" pintan dos
            // handles con id ('si'/'no'); una arista sin handle no se conectaría a ninguno.
            // Se re-mapean a 'si' (la rama normal), que es EXACTO como el motor ya las trata
            // (handle null === 'si' === exige que el origen cumpla). No cambia la ejecución.
            const branchingIds = new Set(loadedNodes.filter(n => NODE_DEFS[n.type]?.branching).map(n => n.id));
            setEdges((flow.edges || []).map(e => hydrateEdge(
                (!e.sourceHandle && branchingIds.has(e.source)) ? { ...e, sourceHandle: 'si' } : e
            )));

            if (metaRes.success) {
                setMeta({
                    municipios: metaRes.municipios || [],
                    categorias: metaRes.categorias || [],
                    escolaridades: metaRes.escolaridades || [],
                    tags: metaRes.tags || [],
                    vacantes: metaRes.vacantes || []
                });
            }
            if (qrRes.success) setQuickReplies(qrRes.replies || []);
            if (rtRes.success) setReminderTemplates(rtRes.templates || []);
            if (projRes.success) setProjects(projRes.projects || []);

            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [flowId]);

    // Contador en vivo: carga el valor inicial al abrir el flujo (o al agregar un nodo
    // contador nuevo). Las actualizaciones posteriores llegan por SSE (efecto de abajo),
    // sin poll recurrente.
    useEffect(() => {
        const hasCounters = nodes.some(n => n.type === 'contador');
        if (!hasCounters) return;
        (async () => {
            const res = await getFlowCounters(flowId);
            if (!res.success) return;
            setNodes(nds => nds.map(n => n.type === 'contador'
                ? { ...n, data: { ...n.data, liveCount: res.counters[n.id]?.total ?? n.data.liveCount ?? 0 } }
                : n));
        })();
    }, [flowId, nodes.length]);

    // Empuje en vivo vía SSE (channel:sse:updates, publicado en flow-engine.js justo
    // cuando un candidato SUMA al contador): el número salta al instante para quien
    // tenga el editor abierto.
    useEffect(() => {
        const handler = (e) => {
            const { flowId: evFlowId, nodeId, count } = e.detail || {};
            if (evFlowId !== flowId) return;
            setNodes(nds => nds.map(n => (n.type === 'contador' && n.id === nodeId)
                ? { ...n, data: { ...n.data, liveCount: count } }
                : n));
        };
        window.addEventListener('sse:flow:counter', handler);
        return () => window.removeEventListener('sse:flow:counter', handler);
    }, [flowId]);

    const onNodesChange = useCallback((changes) => {
        setNodes(nds => applyNodeChanges(changes, nds));
        setDirty(true);
    }, []);

    const onEdgesChange = useCallback((changes) => {
        setEdges(eds => applyEdgeChanges(changes, eds));
        setDirty(true);
    }, []);

    const onConnect = useCallback((params) => {
        setEdges(eds => addEdge(hydrateEdge({ ...params, id: `e${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }), eds));
        setDirty(true);
    }, [hydrateEdge]);

    // Justo debajo del último nodo de la lista (el más reciente, en su posición REAL
    // actual — no una cuadrícula fija que se aleja del flujo si ya lo acomodaste).
    const handleAddNode = useCallback((type) => {
        setNodes(nds => {
            const last = nds[nds.length - 1];
            const position = last ? { x: last.position.x, y: last.position.y + 160 } : { x: 420, y: 80 };
            const base = {
                id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                type,
                position,
                data: { ...(DEFAULT_DATA_BY_TYPE[type] || {}) }
            };
            // Tamaño inicial de los elementos decorativos (redimensionables con NodeResizer):
            // el fondo nace amplio (es una "sección"); el texto una caja chica. hydrateNode
            // fija el zIndex por tipo.
            if (type === 'bg') { base.width = 340; base.height = 220; }
            else if (type === 'texto') { base.width = 220; base.height = 60; }
            const newNode = hydrateNode(base);
            return [...nds, newNode];
        });
        setDirty(true);
    }, [hydrateNode]);

    // ── Selección múltiple (rubber-band) → mini-menú Clonar/Borrar ────────────────
    // React Flow marca node.selected; onSelectionChange nos entrega los seleccionados.
    // El menú aparece con 2+ nodos (1 nodo abre su drawer de config como siempre).
    const onSelectionChange = useCallback(({ nodes: selNodes }) => {
        const sel = selNodes || [];
        setSelectedIds(sel.map(n => n.id));
        if (sel.length >= 2) {
            setSelectedNodeId(null); // no abrir el drawer de config durante la multi-selección
            const lefts = sel.map(n => n.position.x);
            const rights = sel.map(n => n.position.x + (n.measured?.width || 240));
            const tops = sel.map(n => n.position.y);
            const midX = (Math.min(...lefts) + Math.max(...rights)) / 2;
            const topY = Math.min(...tops);
            const pt = rf.flowToScreenPosition({ x: midX, y: topY });
            setSelMenu({ x: pt.x, y: pt.y });
        } else {
            setSelMenu(null);
        }
    }, [rf]);

    // Duplica nodos (+ aristas internas) con IDs nuevos y offset. Ignora nodos de inicio.
    const buildDuplicate = useCallback((srcNodes, srcEdges, offset = { x: 48, y: 48 }) => {
        const idMap = new Map();
        const newNodes = srcNodes
            .filter(n => !ENTRY_TYPES.has(n.type))
            .map(n => {
                const nid = genNodeId();
                idMap.set(n.id, nid);
                // Nodo LIMPIO (sin internals de React Flow como measured/dragging/positionAbsolute):
                // solo los campos persistibles + id/posición nuevos. persistableDims garantiza el
                // tamaño (cae a measured) para que el clon nunca nazca sin dimensiones.
                return hydrateNode({
                    id: nid,
                    type: n.type,
                    position: { x: (n.position?.x || 0) + offset.x, y: (n.position?.y || 0) + offset.y },
                    data: { ...stripTransientData(n.data) },
                    selected: true,
                    ...persistableDims(n)
                });
            });
        const newEdges = srcEdges
            .filter(e => idMap.has(e.source) && idMap.has(e.target))
            .map(e => hydrateEdge({
                id: genEdgeId(),
                source: idMap.get(e.source),
                target: idMap.get(e.target),
                sourceHandle: e.sourceHandle ?? null,
                targetHandle: e.targetHandle ?? null,
                selected: true
            }));
        return { newNodes, newEdges };
    }, [hydrateNode, hydrateEdge]);

    // Copia la selección al portapapeles (localStorage) para pegarla en OTRO flujo.
    const copySelectionToClipboard = useCallback((ids) => {
        const idSet = new Set(ids);
        const clipNodes = nodes
            .filter(n => idSet.has(n.id) && !ENTRY_TYPES.has(n.type))
            .map(n => ({ _srcId: n.id, type: n.type, position: n.position, data: stripTransientData(n.data) }));
        if (!clipNodes.length) return false;
        const srcIdSet = new Set(clipNodes.map(n => n._srcId));
        const clipEdges = edges
            .filter(e => srcIdSet.has(e.source) && srcIdSet.has(e.target))
            .map(e => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null }));
        try {
            localStorage.setItem(CLIPBOARD_KEY, JSON.stringify({ nodes: clipNodes, edges: clipEdges }));
            setCanPaste(true);
            return true;
        } catch { return false; }
    }, [nodes, edges]);

    // CLONAR: duplica la selección aquí mismo (offset) y la copia al portapapeles.
    const handleCloneSelection = useCallback(() => {
        const idSet = new Set(selectedIds);
        const srcNodes = nodes.filter(n => idSet.has(n.id) && !ENTRY_TYPES.has(n.type));
        if (!srcNodes.length) { showToast('Los nodos de inicio no se pueden clonar', 'error'); return; }
        const srcEdges = edges.filter(e => idSet.has(e.source) && idSet.has(e.target));
        const { newNodes, newEdges } = buildDuplicate(srcNodes, srcEdges);
        setNodes(nds => [...nds.map(n => ({ ...n, selected: false })), ...newNodes]);
        setEdges(eds => [...eds.map(e => ({ ...e, selected: false })), ...newEdges]);
        copySelectionToClipboard(selectedIds);
        setDirty(true);
        setSelMenu(null);
        showToast(`Clonados ${newNodes.length} nodo(s) — copiados para pegar en otro flujo`, 'success');
    }, [selectedIds, nodes, edges, buildDuplicate, copySelectionToClipboard, showToast]);

    // CLONAR UNO: duplica un solo elemento (texto / fondo) con offset. Su botón vive en la
    // barra flotante del propio elemento (FlowNode). Reusa buildDuplicate (ya hidrata, filtra
    // inicios y pone id/offset nuevos). Un elemento decorativo no tiene aristas → [].
    const handleDuplicateNode = useCallback((nodeId) => {
        const src = nodes.find(n => n.id === nodeId);
        if (!src || ENTRY_TYPES.has(src.type)) return;
        const { newNodes } = buildDuplicate([src], []);
        if (!newNodes.length) return;
        setNodes(nds => [...nds.map(n => ({ ...n, selected: false })), ...newNodes]);
        setDirty(true);
        showToast('Elemento clonado', 'success');
    }, [nodes, buildDuplicate, showToast]);

    // BORRAR: elimina los nodos seleccionados (menos inicios) y sus aristas.
    const handleDeleteSelection = useCallback(() => {
        const locks = getFlowLocks(user?.preferences, flowId);
        const idSet = new Set(selectedIds.filter(id => {
            const n = nodes.find(x => x.id === id);
            return n && !ENTRY_TYPES.has(n.type) && !locks[id]; // los bloqueados no se borran
        }));
        if (!idSet.size) { showToast('Los nodos de inicio no se pueden borrar', 'error'); return; }
        setNodes(nds => nds.filter(n => !idSet.has(n.id)));
        setEdges(eds => eds.filter(e => !idSet.has(e.source) && !idSet.has(e.target)));
        setDirty(true);
        setSelMenu(null);
        setSelectedIds([]);
        showToast(`Borrados ${idSet.size} nodo(s)`, 'success');
    }, [selectedIds, nodes, showToast, user, flowId]);

    // PEGAR: inserta el contenido del portapapeles en ESTE flujo (IDs nuevos + offset).
    const handlePaste = useCallback(() => {
        let clip;
        try { clip = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) || 'null'); } catch { clip = null; }
        if (!clip?.nodes?.length) { showToast('No hay nada copiado', 'error'); return; }
        const tmpNodes = clip.nodes.map(n => ({ id: n._srcId, type: n.type, position: n.position, data: n.data }));
        const { newNodes, newEdges } = buildDuplicate(tmpNodes, clip.edges || [], { x: 64, y: 64 });
        if (!newNodes.length) { showToast('Nada que pegar', 'error'); return; }
        setNodes(nds => [...nds.map(n => ({ ...n, selected: false })), ...newNodes]);
        setEdges(eds => [...eds.map(e => ({ ...e, selected: false })), ...newEdges]);
        setDirty(true);
        showToast(`Pegados ${newNodes.length} nodo(s) en este flujo`, 'success');
    }, [buildDuplicate, showToast]);

    // Atajos: Ctrl/Cmd+C copia la selección, Ctrl/Cmd+V pega (sirve entre flujos distintos).
    useEffect(() => {
        const onKey = (e) => {
            const tag = (e.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
            const mod = e.metaKey || e.ctrlKey;
            if (!mod) return;
            const k = e.key.toLowerCase();
            if (k === 'c' && selectedIds.length) {
                if (copySelectionToClipboard(selectedIds)) showToast('Copiado — pégalo en cualquier flujo (Ctrl/Cmd+V)', 'success');
            } else if (k === 'v') {
                handlePaste();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selectedIds, copySelectionToClipboard, handlePaste, showToast]);

    const handleNodeConfigChange = useCallback((nodeId, patch) => {
        setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n));
        setDirty(true);
    }, []);

    const handleSave = useCallback(async ({ silent = false } = {}) => {
        setSaving(true);
        const payload = {
            nodes: nodes.map(n => ({
                id: n.id, type: n.type, position: n.position, data: stripTransientData(n.data),
                // Tamaño y capa de los elementos bg/texto — sin esto se perderían al recargar.
                // persistableDims cae a `measured` si nunca se redimensionaron a mano.
                ...persistableDims(n)
            })),
            edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null }))
        };
        const res = await updateFlow(flowId, payload);
        setSaving(false);
        if (res.success) {
            setDirty(false);
            if (!silent) showToast('Flujo guardado', 'success');
        } else {
            if (!silent) showToast('Error al guardar el flujo', 'error');
        }
        return res;
    }, [flowId, nodes, edges, showToast]);

    // Nodo "test": corre el flujo COMPLETO contra un candidato real por teléfono, sin
    // pasar por el claim de dedupe de producción (para poder repetir la prueba) ni por
    // el filtro flow.active (para poder probar un borrador antes de activarlo). Primero
    // guarda en silencio para que la prueba corra exactamente contra lo que se ve en el
    // lienzo, no contra la última versión guardada.
    const handleTestRun = useCallback(async (nodeId, phone) => {
        if (!phone) return;
        // Limpia el resaltado de la corrida anterior en TODO el lienzo antes de empezar.
        setNodes(nds => nds.map(n => ({
            ...n,
            data: {
                ...n.data,
                testPassed: undefined,
                ...(n.id === nodeId ? { testStatus: 'running', testMessage: '' } : {})
            }
        })));

        const saveRes = await handleSave({ silent: true });
        if (!saveRes.success) {
            setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, testStatus: 'error', testMessage: 'No se pudo guardar antes de probar' } } : n));
            return;
        }

        const res = await testFlow(flowId, phone);
        setNodes(nds => nds.map(n => ({
            ...n,
            data: {
                ...n.data,
                testPassed: res.success ? (res.passed?.[n.id]) : undefined,
                ...(n.id === nodeId ? {
                    testStatus: res.success ? 'success' : 'error',
                    testMessage: res.success ? `Corrió para ${res.candidate?.nombre || phone}` : (res.error || 'Error al probar')
                } : {})
            }
        })));
    }, [flowId, handleSave]);

    useEffect(() => { handleTestRunRef.current = handleTestRun; }, [handleTestRun]);

    // Nodo "inicio_lista" (flujo manual): "Cargar lista" trae los candidatos que matchean
    // el filtro configurado en el nodo (guardado primero en silencio, mismo motivo que
    // handleTestRun — que la lista refleje el filtro tal cual está en el lienzo).
    const handleLoadFilteredList = useCallback(async (nodeId) => {
        const node = nodes.find(n => n.id === nodeId);
        if (!node) return;
        setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, listStatus: 'loading' } } : n));

        await handleSave({ silent: true });
        const { profileFilter, tags, within24h } = node.data || {};
        const res = await getFilteredFlowCandidates(flowId, { profileFilter, tags, within24h });

        setNodes(nds => nds.map(n => n.id === nodeId ? {
            ...n,
            data: {
                ...n.data,
                listStatus: res.success ? 'ready' : 'idle',
                candidateList: res.success ? res.candidates : n.data.candidateList
            }
        } : n));
        if (!res.success) showToast('Error al cargar la lista', 'error');
    }, [nodes, flowId, handleSave, showToast]);

    // Run: corre el resto del flujo para cada candidato de la lista, UNO POR UNO en
    // secuencia (no en paralelo — cada `await runFlowListItem` espera la respuesta antes
    // de seguir con el siguiente). Salta los que ya vienen `executed` (ya sea de una
    // corrida anterior o de un Run previo que se quedó a medias) — retomar es gratis
    // gracias al dedupe real de producción en runFlowForListCandidate (flow-engine.js).
    // Guarda en silencio primero, mismo motivo que handleTestRun.
    const handleRunFilteredList = useCallback(async (nodeId) => {
        const node = nodes.find(n => n.id === nodeId);
        const list = node?.data?.candidateList;
        if (!Array.isArray(list) || !list.length) return;

        const saveRes = await handleSave({ silent: true });
        if (!saveRes.success) {
            showToast('No se pudo guardar antes de correr la lista', 'error');
            return;
        }

        setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, listStatus: 'running' } } : n));

        for (const candidate of list) {
            if (candidate.executed) continue;
            setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, runningCandidateId: candidate.id } } : n));
            const res = await runFlowListItem(flowId, candidate.id);
            if (!res.success) showToast(`Error corriendo el flujo para ${candidate.nombre}: ${res.error || 'desconocido'}`, 'error');
            setNodes(nds => nds.map(n => {
                if (n.id !== nodeId) return n;
                const updatedList = (n.data.candidateList || []).map(c => c.id === candidate.id ? { ...c, executed: res.success ? true : c.executed } : c);
                return { ...n, data: { ...n.data, candidateList: updatedList } };
            }));
        }

        setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, listStatus: 'ready', runningCandidateId: null } } : n));
    }, [nodes, flowId, handleSave, showToast]);

    useEffect(() => { handleLoadListRef.current = handleLoadFilteredList; }, [handleLoadFilteredList]);
    useEffect(() => { handleRunListRef.current = handleRunFilteredList; }, [handleRunFilteredList]);
    useEffect(() => { handleDuplicateNodeRef.current = handleDuplicateNode; }, [handleDuplicateNode]);

    const handleToggleActive = useCallback(async () => {
        const nextActive = !flowMeta.active;
        setFlowMeta(m => ({ ...m, active: nextActive }));
        const res = await updateFlow(flowId, { active: nextActive });
        if (!res.success) {
            setFlowMeta(m => ({ ...m, active: !nextActive }));
            showToast('Error al cambiar el estado', 'error');
        } else {
            showToast(nextActive ? 'Flujo activado' : 'Flujo desactivado', 'success');
        }
    }, [flowId, flowMeta.active, showToast]);

    // El toggle también vive dentro del nodo "inicio" (además del botón del toolbar) —
    // se inyecta al vuelo, no se guarda como parte de node.data (stripTransientData lo quita).
    useEffect(() => {
        setNodes(nds => nds.map(n => (n.type === 'inicio' || n.type === 'inicio_incompleto_silencio')
            ? { ...n, data: { ...n.data, active: flowMeta.active, onToggleActive: handleToggleActive } }
            : n));
    }, [flowMeta.active, handleToggleActive]);

    const handleRename = useCallback(async (name) => {
        setFlowMeta(m => ({ ...m, name }));
        const res = await updateFlow(flowId, { name });
        if (!res.success) showToast('Error al renombrar', 'error');
    }, [flowId, showToast]);

    const selectedNode = nodes.find(n => n.id === selectedNodeId) || null;

    // Candados del usuario para ESTE flujo. displayNodes inyecta a cada nodo su estado de
    // candado (data.locked + onToggleLock) y, si está cerrado, lo hace no-arrastrable y
    // no-borrable. onNodesChange sigue aplicando los cambios sobre `nodes` (base); esto es
    // solo la capa de render. Los nodos de inicio nunca son borrables (ya lo eran).
    const nodeLocks = user?.preferences?.flowNodeLocks?.[flowId] || EMPTY_LOCKS; // getFlowLocks devuelve {} nuevo; aquí usamos ref estable para el memo
    const displayNodes = useMemo(() => nodes.map(n => {
        const locked = !!nodeLocks[n.id];
        return {
            ...n,
            draggable: !locked,
            deletable: ENTRY_TYPES.has(n.type) ? false : !locked,
            data: { ...n.data, locked, onToggleLock: handleToggleLock }
        };
    }), [nodes, nodeLocks, handleToggleLock]);

    if (loading) {
        return <div className="h-full flex items-center justify-center text-gray-400 text-sm">Cargando flujo...</div>;
    }

    return (
        <div className="relative h-full w-full bg-white dark:bg-gray-900">
            <FlowToolbar
                flowName={flowMeta.name}
                active={flowMeta.active}
                dirty={dirty}
                saving={saving}
                onAddNode={handleAddNode}
                onSave={handleSave}
                onToggleActive={handleToggleActive}
                onRename={handleRename}
                onBack={onBack}
                canPaste={canPaste}
                onPaste={handlePaste}
            />

            <ReactFlow
                nodes={displayNodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onSelectionChange={onSelectionChange}
                nodeTypes={flowNodeTypes}
                edgeTypes={flowEdgeTypes}
                fitView
                minZoom={0.2}
                maxZoom={1.5}
                /* Sin elevar al seleccionar: mantiene el fondo (bg) SIEMPRE detrás según su
                   zIndex por banda, incluso cuando lo seleccionas para recolorearlo. */
                elevateNodesOnSelect={false}
                /* Controles por defecto: clic izquierdo panea. La selección múltiple es con
                   Shift+arrastrar (caja) o Shift+clic (agregar nodos). */
                defaultEdgeOptions={{ style: { stroke: '#a5b4fc', strokeWidth: 2 }, animated: false }}
                proOptions={{ hideAttribution: true }}
            >
                <Background id="blueprint-minor" variant={BackgroundVariant.Lines} gap={20} lineWidth={1} color="#eff6ff" />
                <Background id="blueprint-major" variant={BackgroundVariant.Lines} gap={100} lineWidth={1.5} color="#dbeafe" />
                <Controls showInteractive={false} />
                <MiniMap
                    pannable zoomable
                    maskColor="rgba(240,242,247,0.6)"
                    nodeColor={(n) => {
                        const def = NODE_DEFS[n.type];
                        const colors = COLOR_CLASSES[def?.color] || COLOR_CLASSES.gray;
                        return colors.icon.replace('bg-', '').includes('indigo') ? '#6366f1'
                            : colors.icon.includes('blue') ? '#3b82f6'
                            : colors.icon.includes('emerald') ? '#10b981'
                            : colors.icon.includes('amber') ? '#f59e0b'
                            : '#9ca3af';
                    }}
                />
            </ReactFlow>

            {/* Mini-menú flotante de selección múltiple (aparece al soltar con 2+ nodos). */}
            {selMenu && selectedIds.length >= 2 && (
                <div
                    className="fixed z-[300] -translate-x-1/2 -translate-y-full mb-2 flex items-center gap-1 bg-white dark:bg-[#202c33] rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-1"
                    style={{ left: selMenu.x, top: selMenu.y - 10 }}
                >
                    <span className="text-[11px] font-semibold text-gray-400 px-2 select-none">{selectedIds.length} sel.</span>
                    <button
                        onClick={handleCloneSelection}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                        title="Clonar aquí y copiar para pegar en otro flujo"
                    >
                        <Copy className="w-3.5 h-3.5" /> Clonar
                    </button>
                    <button
                        onClick={handleDeleteSelection}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Borrar los nodos seleccionados"
                    >
                        <Trash2 className="w-3.5 h-3.5" /> Borrar
                    </button>
                </div>
            )}

            {selectedNode && (
                <NodeConfigDrawer
                    node={selectedNode}
                    flowId={flowId}
                    meta={meta}
                    quickReplies={quickReplies}
                    reminderTemplates={reminderTemplates}
                    projects={projects}
                    onChange={handleNodeConfigChange}
                    onClose={() => setSelectedNodeId(null)}
                />
            )}
        </div>
    );
};

const FlowEditor = (props) => (
    <ReactFlowProvider>
        <FlowEditorInner {...props} />
    </ReactFlowProvider>
);

export default FlowEditor;
