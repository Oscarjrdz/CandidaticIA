import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
    addEdge, applyNodeChanges, applyEdgeChanges, BackgroundVariant
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useToastContext } from '../../contexts/ToastContext';
import { getFlow, updateFlow, getFlowsMeta, getFlowCounters, getQuickReplies, getReminderTemplates, getManualProjects, testFlow } from '../../services/flowsService';
import { flowNodeTypes, COLOR_CLASSES, NODE_DEFS } from './nodeTypes';
import NodeConfigDrawer from './NodeConfigDrawer';
import FlowToolbar from './FlowToolbar';

const DEFAULT_DATA_BY_TYPE = {
    etiqueta: { mode: 'todas' },
    condicion_genero: { generos: [] },
    condicion_edad: { min: null, max: null },
    condicion_municipio: { municipios: [] },
    condicion_categoria: { categorias: [] },
    condicion_escolaridad: { escolaridades: [] },
    accion_whatsapp: { quickReplyId: '', quickReplyName: '' },
    accion_vacante: { vacancyId: '', vacancyName: '' },
    accion_etiqueta: { tag: '' },
    accion_quitar_etiqueta: { tag: '' },
    accion_limpiar_etiquetas: {},
    accion_recordatorio: { templateId: '', templateName: '' },
    accion_proyecto: { projectId: '', projectName: '' },
    contador: { label: '' },
    test: { testPhone: '' }
};

const stripTransientData = (data = {}) => {
    const { onConfigure, onDelete, onTestPhoneChange, onTestRun, onToggleActive, liveCount, active, testStatus, testMessage, testPassed, ...rest } = data;
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
    const nodeCountRef = useRef(0);
    const handleTestRunRef = useRef(null);

    const handleConfigure = useCallback((nodeId) => setSelectedNodeId(nodeId), []);

    const handleDeleteNode = useCallback((nodeId) => {
        setNodes(nds => nds.filter(n => n.id !== nodeId));
        setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
        setSelectedNodeId(sel => sel === nodeId ? null : sel);
        setDirty(true);
    }, []);

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
            onTestRun: (nodeId, phone) => handleTestRunRef.current?.(nodeId, phone)
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
            nodeCountRef.current = loadedNodes.length;
            setNodes(loadedNodes);
            setEdges(flow.edges || []);

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

    // Contador en vivo: refresca cada 10s mientras el editor está abierto.
    useEffect(() => {
        const hasCounters = nodes.some(n => n.type === 'contador');
        if (!hasCounters) return undefined;

        const poll = async () => {
            const res = await getFlowCounters(flowId);
            if (!res.success) return;
            setNodes(nds => nds.map(n => n.type === 'contador'
                ? { ...n, data: { ...n.data, liveCount: res.counters[n.id] ?? n.data.liveCount ?? 0 } }
                : n));
        };
        poll();
        const interval = setInterval(poll, 10000);
        return () => clearInterval(interval);
    }, [flowId, nodes.length]);

    const onNodesChange = useCallback((changes) => {
        setNodes(nds => applyNodeChanges(changes, nds));
        setDirty(true);
    }, []);

    const onEdgesChange = useCallback((changes) => {
        setEdges(eds => applyEdgeChanges(changes, eds));
        setDirty(true);
    }, []);

    const onConnect = useCallback((params) => {
        setEdges(eds => addEdge({ ...params, id: `e${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }, eds));
        setDirty(true);
    }, []);

    const handleAddNode = useCallback((type) => {
        const count = nodeCountRef.current++;
        const newNode = hydrateNode({
            id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type,
            position: { x: 420 + (count % 3) * 300, y: 80 + Math.floor(count / 3) * 180 },
            data: { ...(DEFAULT_DATA_BY_TYPE[type] || {}) }
        });
        setNodes(nds => [...nds, newNode]);
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
            edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target }))
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
