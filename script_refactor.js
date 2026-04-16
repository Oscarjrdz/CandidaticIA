const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'components', 'CandidatesSection.jsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Move isProfileComplete outside
const isProfileCompleteLogic = `
const isProfileComplete = (c) => {
    if (!c) return false;

    const valToStr = (v) => v ? String(v).trim().toLowerCase() : '-';
    const coreFields = ['nombreReal', 'municipio', 'escolaridad', 'categoria', 'genero'];
    
    const hasCoreData = coreFields.every(f => {
        const val = valToStr(c[f]);
        if (val === '-' || val === 'null' || val === 'n/a' || val === 'na' || val === 'ninguno' || val === 'ninguna' || val === 'none' || val === 'desconocido' || val.includes('proporcionado') || val.length < 2) return false;
        if (f === 'escolaridad') {
            const junk = ['kinder', 'ninguna', 'sin estudios', 'no tengo', 'no curse', 'preescolar', 'maternal'];
            if (junk.some(j => val.includes(j))) return false;
        }
        return true;
    });

    const ageVal = valToStr(c.edad || c.fechaNacimiento);
    const hasAgeData = ageVal !== '-' && ageVal !== 'null' && ageVal !== 'n/a' && ageVal !== 'na';
    return hasCoreData && hasAgeData;
};
`;

// Remove original isProfileComplete
const regexProfile = /\s*\/\/ --- 🚩 PASO 1 LOGIC ---[\s\S]*?const isProfileComplete = \(c\) => \{[\s\S]*?return hasCoreData && hasAgeData;\n    \};\n/g;
content = content.replace(regexProfile, '');

// 2. Wrap handlers in useCallback
// handleBlockToggle
content = content.replace(
    /const handleBlockToggle = async \(candidate\) => \{/,
    "const handleBlockToggle = React.useCallback(async (candidate) => {"
);
content = content.replace(
    // It ends with: setBlockLoading(prev => ({ ...prev, [candidate.id]: false }));\n    };
    /setBlockLoading\(prev => \(\{ \.\.\.prev, \[candidate\.id\]: false \}\)\);\n    \};/,
    "setBlockLoading(prev => ({ ...prev, [candidate.id]: false }));\n    }, [aiFilteredCandidates]);"
);

// handleDelete
content = content.replace(
    /const handleDelete = async \(e, id, nombre\) => \{/,
    "const handleDelete = React.useCallback(async (e, candidate) => {\n        const { id, nombre } = candidate;\n"
);
content = content.replace(
    // "const candidate = candidates.find(c => c.id === id);" -> delete this line as it's passed
    /const candidate = candidates\.find\(c => c\.id === id\);\n/,
    ""
);
content = content.replace(
    /showToast\(`Error: \$\{result.error\}`\, 'error'\);\n        \}\n    \};/,
    "showToast(`Error: ${result.error}`, 'error');\n        }\n    }, [showToast, loadCandidates]);"
);

// handleOpenChat
content = content.replace(
    /const handleOpenChat = \(candidate\) => \{\n        setSelectedCandidate\(candidate\);\n    \};/,
    "const handleOpenChat = React.useCallback((candidate) => {\n        setSelectedCandidate(candidate);\n    }, []);"
);

// handleMagicFix
content = content.replace(
    /const handleMagicFix = async \(candidateId, field, currentValue\) => \{/,
    "const handleMagicFix = React.useCallback(async (candidateId, field, currentValue) => {"
);
content = content.replace(
    /setMagicLoading\(prev => \(\{ \.\.\.prev, \[key\]: false \}\)\);\n        \}\n    \};/,
    "setMagicLoading(prev => ({ ...prev, [key]: false }));\n        }\n    }, [showToast]);"
);


// 3. Add fieldsMap
content = content.replace(
    /const \[fields, setFields\] = useState\(\[\]\);/,
    "const [fields, setFields] = useState([]);\n    const fieldsMap = React.useMemo(() => fields.reduce((acc, f) => ({ ...acc, [f.value]: f }), {}), [fields]);"
);

// 4. Update the usage inside CandidateRow
const candidateRowDefinition = `
const areCandidatePropsEqual = (prev, next) => {
    if (prev.candidate !== next.candidate) return false;
    if (prev.columnOrder !== next.columnOrder) return false;
    if (prev.isBlockLoading !== next.isBlockLoading) return false;
    
    // Check if any magic loading state for this candidate changed
    for (let col of prev.columnOrder) {
        const key = \`\${prev.candidate.id}-\${col}\`;
        if (prev.magicLoading[key] !== next.magicLoading[key]) return false;
    }
    return true;
};

const CandidateRow = React.memo(({
    candidate,
    columnOrder,
    fieldsMap,
    magicLoading,
    isBlockLoading,
    onOpenChat,
    onBlockToggle,
    onDelete,
    onMagicFix
}) => {
    const isComplete = isProfileComplete(candidate);

    return (
        <tr
            className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900 smooth-transition relative"
        >
            <td className="py-0.5 px-1 text-center">
                <div className="flex items-center justify-center">
                    {isComplete ? (
                        <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse"></div>
                    ) : (
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></div>
                    )}
                </div>
            </td>
            <td className="py-0.5 px-2.5">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                    <img
                        src={candidate.profilePic || \`https://ui-avatars.com/api/?name=\${encodeURIComponent(candidate.nombre || 'User')}&background=random&color=fff&size=128\`}
                        alt="Avatar"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = 'https://ui-avatars.com/api/?name=User&background=gray&color=fff';
                        }}
                    />
                </div>
            </td>
            <td className="py-0.5 px-2.5">
                <div className="text-[10px] text-gray-900 dark:text-white font-mono font-medium">
                    {formatPhone(candidate.whatsapp)}
                </div>
                <div className="text-[8px] text-gray-500 dark:text-gray-400 mt-0.5 opacity-80">
                    Desde {formatRelativeDate(candidate.primerContacto)}
                </div>
            </td>
            <td className="py-0.5 px-2.5">
                <div className="text-[10px] text-gray-900 dark:text-white font-medium" title={candidate.nombre}>
                    {candidate.nombre && candidate.nombre.length > 8
                        ? \`\${candidate.nombre.substring(0, 8)}...\`
                        : (candidate.nombre || '-')}
                </div>
            </td>

            {/* Dynamic Cells (Mapped by Sorted columnOrder) */}
            {columnOrder.map(colId => {
                const field = fieldsMap[colId];
                if (!field) return null;

                const mKey = \`\${candidate.id}-\${field.value}\`;
                const isMLoading = magicLoading[mKey];

                return (
                    <td className="py-0.5 px-2.5" key={field.value}>
                        {['escolaridad', 'categoria', 'nombreReal', 'municipio'].includes(field.value) ? (
                            <div
                                onClick={() => onMagicFix(candidate.id, field.value, candidate[field.value])}
                                className={\`
                                inline-flex items-center px-2 py-0.5 rounded-md cursor-pointer smooth-transition text-[10px] font-medium
                                \${isMLoading
                                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 animate-pulse'
                                        : 'hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:text-blue-600 dark:text-white'}
                            \`}
                                title="Clic para Magia IA ✨"
                            >
                                {isMLoading && (
                                    <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                                )}
                                {formatValue(candidate[field.value])}
                                <Sparkles className={\`w-2.5 h-2.5 ml-1.5 opacity-0 group-hover:opacity-100 \${isMLoading ? 'hidden' : ''} text-blue-400\`} />
                            </div>
                        ) : (
                            <div className="text-[10px] text-gray-900 dark:text-white font-medium">
                                {field.value === 'edad'
                                    ? calculateAge(candidate.fechaNacimiento, candidate.edad)
                                    : formatValue(candidate[field.value])}
                            </div>
                        )}
                    </td>
                );
            })}

            <td className="py-0.5 px-2.5">
                {(() => {
                    const vacName = candidate.currentVacancyName || candidate.projectMetadata?.currentVacancyName;
                    const stepId = candidate.projectMetadata?.stepId || '';
                    const isNoInteresa = !vacName && (
                        /no.?interesa/i.test(stepId) ||
                        /no.?interesa/i.test(candidate.status || '') ||
                        /no.?interesa/i.test(candidate.projectMetadata?.stepName || '')
                    );
                    if (isNoInteresa) {
                        return (
                            <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase italic bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded">
                                NO INTERESA
                            </span>
                        );
                    }
                    return (
                        <div className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase italic whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">
                            {vacName || '-'}
                        </div>
                    );
                })()}
            </td>

            <td className="py-0.5 px-2.5">
                <div className="text-[10px] text-gray-700 dark:text-gray-300 font-medium">
                    {formatDateTime(candidate.ultimoMensaje)}
                </div>
                <div className="text-[8px] text-gray-500 dark:text-gray-400 mt-0.5 opacity-80">
                    {formatRelativeDate(candidate.ultimoMensaje)}
                </div>
            </td>

            <td className="py-0.5 px-2.5 text-center">
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpenChat(candidate);
                    }}
                    className="p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 rounded-lg smooth-transition group relative flex items-center justify-center"
                    title="Abrir chat"
                >
                    <div className="relative">
                        <MessageCircle className="w-4 h-4" />
                        {candidate.ultimoMensaje && (
                            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse border border-white dark:border-gray-800"></span>
                        )}
                    </div>
                </button>
            </td>
            <td className="py-0.5 px-2 text-center">
                <div className="flex justify-center items-center">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onBlockToggle(candidate);
                        }}
                        disabled={isBlockLoading}
                        className={\`w-6 h-3 rounded-full relative transition-colors duration-200 focus:outline-none \${candidate.blocked ? 'bg-red-500' : 'bg-gray-200 dark:bg-gray-700'
                            }\`}
                        title={candidate.blocked ? 'Reactivar Chat IA' : 'Silenciar Chat IA'}
                    >
                        <div className={\`absolute top-0.5 w-2 h-2 rounded-full bg-white shadow-sm transition-transform duration-200 \${candidate.blocked ? 'left-3.5' : 'left-0.5'
                            }\`}>
                            {isBlockLoading && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <Loader2 className="w-2 h-2 text-red-500 animate-spin" />
                                </div>
                            )}
                        </div>
                    </button>
                </div>
            </td>
            <td className="py-0.5 px-2.5 text-center">
                <button
                    type="button"
                    onClick={(e) => onDelete(e, candidate)}
                    className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg smooth-transition group"
                    title="Eliminar permanentemente"
                >
                    <Trash2 className="w-3.5 h-3.5 text-gray-400 group-hover:text-red-600 dark:group-hover:text-red-400" />
                </button>
            </td>
        </tr>
    );
}, areCandidatePropsEqual);
`;

// Insert the blocks right before CandidatesSection
content = content.replace(
    /const CandidatesSection = \(\{ showToast \}\) => \{/,
    \`\${isProfileCompleteLogic}

\${candidateRowDefinition}

const CandidatesSection = ({ showToast }) => {\`
);


// 5. Replace the massive <tr> map with CandidateRow
const trRegex = /<tr[\s\S]*?key=\{candidate\.id\}[\s\S]*?<\/tr>/g;
// We actually need to match exactly the map body
content = content.replace(
    /displayedCandidates\.map\(\(candidate\) => \([\s\S]*?<\/tr>\)\s*\)/,
    \`displayedCandidates.map((candidate) => (
                                        <CandidateRow 
                                            key={candidate.id}
                                            candidate={candidate}
                                            columnOrder={columnOrder}
                                            fieldsMap={fieldsMap}
                                            magicLoading={magicLoading}
                                            isBlockLoading={blockLoading[candidate.id] || false}
                                            onOpenChat={handleOpenChat}
                                            onBlockToggle={handleBlockToggle}
                                            onMagicFix={handleMagicFix}
                                            onDelete={handleDelete}
                                        />
                                    ))\`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Refactor complete!');
