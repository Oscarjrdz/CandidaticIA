import FlowNode from './FlowNode';
import { NODE_DEFS } from './nodeDefs';

// React Flow espera un nodeTypes = { [type]: Component }. Como FlowNode ya lee su
// propia config de NODE_DEFS por `type`, todos los tipos apuntan al mismo componente.
export const flowNodeTypes = Object.keys(NODE_DEFS).reduce((acc, type) => {
    acc[type] = FlowNode;
    return acc;
}, {});

export { NODE_DEFS, COLOR_CLASSES, PROFILE_FILTER_LABELS, ETIQUETA_MODE_LABELS, GENEROS, ELEMENT_TYPES } from './nodeDefs';
