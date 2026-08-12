import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
    addEdge, applyNodeChanges, applyEdgeChanges, BackgroundVariant
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useToastContext } from '../../contexts/ToastContext';
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
    accion_etiqueta: { tag: '' },
    accion_quitar_etiqueta: { tag: '' },
    accion_limpiar_etiquetas: {},
    accion_recordatorio: { templateId: '', templateName: '' },
    accion_proyecto: { projectId: '', projectName: '' },
    accion_marcar_leido: {},
    contador: { label: '' },
    test: { testPhone: '' }
};

const stripTransientData = (data = {}) => {
    const {
        onConfigure, onDelete, onTestPhoneChange, onTestRun, onToggleActive, liveCount, active,
        testStatus, testMessage, testPassed, onLoadList, onRunList, candidateList, listStatus, runningCandidateId,
        ...rest
    } = data;
    return rest;
};

const FlowEditorInner = ({ flowId, onBack }) => {
    const { showToast } = useToastContext();
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
    const handleTestRunRef = useRef(null);
    const handleLoadListRef = useRef(null);
    const handleRunListRef = useRef(null);

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

    const hydrateNode = useCallback((n) => ({
        ...n,
        data: {
            ...n.data,
            onConfigure: handleConfigure,
            onDelete: handleDeleteNode,
            onTestPhoneChange: handleTestPhoneChange,
            onTestRun: (nodeId, phone) => handleTestRunRef.current?.(nodeId, phone),
            onLoadList: (nodeId) => handleLoadListRef.current?.(nodeId),
            onRunList: (nodeId) => handleRunListRef.current?.(nodeId)
        }
    }), [handleConfigure, handleDeleteNode, handleTestPhoneChange]);

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
                ? { ...n, data: { ...n.data, liveCount: res.counters[n.id] ?? n.data.liveCount ?? 0 } }
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
            const newNode = hydrateNode({
                id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                type,
                position,
                data: { ...(DEFAULT_DATA_BY_TYPE[type] || {}) }
            });
            return [...nds, newNode];
        });
        setDirty(true);
    }, [hydrateNode]);

    const handleNodeConfigChange = useCallback((nodeId, patch) => {
        setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n));
        setDirty(true);
    }, []);

    const handleSave = useCallback(async ({ silent = false } = {}) => {
        setSaving(true);
        const payload = {
            nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: stripTransientData(n.data) })),
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
        setNodes(nds => nds.map(n => n.type === 'inicio'
            ? { ...n, data: { ...n.data, active: flowMeta.active, onToggleActive: handleToggleActive } }
            : n));
    }, [flowMeta.active, handleToggleActive]);

    const handleRename = useCallback(async (name) => {
        setFlowMeta(m => ({ ...m, name }));
        const res = await updateFlow(flowId, { name });
        if (!res.success) showToast('Error al renombrar', 'error');
    }, [flowId, showToast]);

    const selectedNode = nodes.find(n => n.id === selectedNodeId) || null;

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
            />

            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={flowNodeTypes}
                edgeTypes={flowEdgeTypes}
                fitView
                minZoom={0.2}
                maxZoom={1.5}
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

            {selectedNode && (
                <NodeConfigDrawer
                    node={selectedNode}
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
