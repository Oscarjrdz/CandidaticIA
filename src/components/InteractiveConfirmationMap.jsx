import React, { useState, useEffect } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, MessageSquare, MapPin, Image as ImageIcon, Type, Link2, Map } from 'lucide-react';

const DEFAULT_ITEMS = [
    { id: 'item-text', type: 'text', enabled: true, data: { text: '¡Excelente! Te confirmo los detalles de tu entrevista:' } },
    { id: 'item-location', type: 'location', enabled: true, data: { address: 'Oficinas Centrales', lat: '19.4326', lng: '-99.1332' } },
    { id: 'item-image', type: 'image', enabled: true, data: { url: 'https://example.com/mapa-acceso.jpg' } }
];

const SortableItem = ({ item, isDragging, onUpdate, onToggle }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: item.id, data: { type: 'confirmation-item', item } });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
    };

    const getIcon = (type) => {
        switch (type) {
            case 'text': return <MessageSquare className="w-5 h-5 text-blue-500" />;
            case 'location': return <MapPin className="w-5 h-5 text-red-500" />;
            case 'image': return <ImageIcon className="w-5 h-5 text-purple-500" />;
            default: return null;
        }
    };

    const getTitle = (type) => {
        switch (type) {
            case 'text': return 'Mensaje de Texto';
            case 'location': return 'Ubicación (UltraMsg)';
            case 'image': return 'Imagen Adjunta';
            default: return '';
        }
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`bg-white dark:bg-slate-800 rounded-2xl border-2 ${item.enabled ? 'border-slate-200 dark:border-slate-700' : 'border-slate-100 dark:border-slate-800 opacity-60'} p-4 flex gap-4 transition-all`}
        >
            <div
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            >
                <GripVertical className="w-6 h-6" />
            </div>

            <div className="flex-1 space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {getIcon(item.type)}
                        <h4 className="font-bold text-slate-800 dark:text-white uppercase tracking-tight text-sm">
                            {getTitle(item.type)}
                        </h4>
                    </div>
                    <button
                        onClick={() => onToggle(item.id)}
                        className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full transition-colors ${item.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}
                    >
                        {item.enabled ? 'Activo' : 'Inactivo'}
                    </button>
                </div>

                {item.enabled && (
                    <div className="space-y-3 pl-1">
                        {item.type === 'text' && (
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                    <Type className="w-3 h-3" /> Contenido del Mensaje
                                </label>
                                <textarea
                                    value={item.data.text || ''}
                                    onChange={(e) => onUpdate(item.id, { text: e.target.value })}
                                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none min-h-[80px]"
                                    placeholder="Ej: Te esperamos en nuestra sucursal..."
                                />
                            </div>
                        )}

                        {item.type === 'location' && (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2 space-y-1">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                        <Map className="w-3 h-3" /> Nombre del Lugar
                                    </label>
                                    <input
                                        type="text"
                                        value={item.data.address || ''}
                                        onChange={(e) => onUpdate(item.id, { address: e.target.value })}
                                        className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                                        placeholder="Ej: Oficinas Centrales"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Latitud</label>
                                    <input
                                        type="text"
                                        value={item.data.lat || ''}
                                        onChange={(e) => onUpdate(item.id, { lat: e.target.value })}
                                        className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                                        placeholder="19.4326"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Longitud</label>
                                    <input
                                        type="text"
                                        value={item.data.lng || ''}
                                        onChange={(e) => onUpdate(item.id, { lng: e.target.value })}
                                        className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                                        placeholder="-99.1332"
                                    />
                                </div>
                            </div>
                        )}

                        {item.type === 'image' && (
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                    <Link2 className="w-3 h-3" /> URL de la Imagen
                                </label>
                                <input
                                    type="text"
                                    value={item.data.url || ''}
                                    onChange={(e) => onUpdate(item.id, { url: e.target.value })}
                                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                    placeholder="https://..."
                                />
                                {item.data.url && (
                                    <div className="mt-2 h-24 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center">
                                        <img src={item.data.url} alt="Preview" className="h-full object-contain" onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<span class="text-xs text-slate-400 py-4">URL inválida o sin acceso</span>'; }} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const InteractiveConfirmationMap = ({ options = [], onChange }) => {
    const [items, setItems] = useState([]);
    const [activeId, setActiveId] = useState(null);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    // Initialize with provided options or defaults, ensuring all 3 types exist
    useEffect(() => {
        if (options && options.length > 0) {
            // Merge existing options with missing defaults
            const existingTypes = options.map(o => o.type);
            const missingDefaults = DEFAULT_ITEMS.filter(d => !existingTypes.includes(d.type));
            // Keep the saved order for existing ones, append missing ones at the end (disabled)
            setItems([...options, ...missingDefaults.map(d => ({ ...d, enabled: false }))]);
        } else {
            setItems(DEFAULT_ITEMS);
        }
    }, [options]);

    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        setActiveId(null);

        if (over && active.id !== over.id) {
            const oldIndex = items.findIndex((i) => i.id === active.id);
            const newIndex = items.findIndex((i) => i.id === over.id);
            const newItems = arrayMove(items, oldIndex, newIndex);
            setItems(newItems);
            onChange(newItems);
        }
    };

    const handleUpdateItem = (id, newData) => {
        const newItems = items.map(item =>
            item.id === id ? { ...item, data: { ...item.data, ...newData } } : item
        );
        setItems(newItems);
        onChange(newItems);
    };

    const handleToggleItem = (id) => {
        const newItems = items.map(item =>
            item.id === id ? { ...item, enabled: !item.enabled } : item
        );
        setItems(newItems);
        onChange(newItems);
    };

    const activeItem = activeId ? items.find(i => i.id === activeId) : null;

    return (
        <div className="w-full bg-slate-50/50 dark:bg-black/20 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl border border-blue-100 dark:border-blue-900/50 flex gap-3">
                <MapPin className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300 leading-relaxed">
                    Arrastra los bloques para definir el <b>orden exacto</b> en el que se enviarán a WhatsApp cuando el candidato acepte su cita. Los componentes inactivos no serán enviados.
                </p>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
            >
                <div className="space-y-3">
                    <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                        {items.map((item) => (
                            <SortableItem
                                key={item.id}
                                item={item}
                                isDragging={activeId === item.id}
                                onUpdate={handleUpdateItem}
                                onToggle={handleToggleItem}
                            />
                        ))}
                    </SortableContext>
                </div>
                <DragOverlay>
                    {activeItem && (
                        <SortableItem
                            item={activeItem}
                            isDragging={true}
                            onUpdate={() => { }}
                            onToggle={() => { }}
                        />
                    )}
                </DragOverlay>
            </DndContext>
        </div>
    );
};

export default InteractiveConfirmationMap;
