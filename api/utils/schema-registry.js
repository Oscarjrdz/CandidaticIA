import {
    cleanNameWithAI,
    detectGender,
    cleanMunicipioWithAI,
    cleanCategoryWithAI,
    cleanEmploymentStatusWithAI,
    cleanDateWithAI,
    cleanEscolaridadWithAI
} from './ai.js';

/**
 * SCHEMA REGISTRY - The "Single Source of Truth" for Candidate Data
 * Maps database fields to their cleaning logic and validation rules.
 */
export const DATA_SCHEMA = {
    nombreReal: {
        cleaner: cleanNameWithAI,
        priority: 1,
        onSuccess: async (val, updateObj) => {
            if (val) updateObj.genero = await detectGender(val);
        }
    },
    municipio: {
        cleaner: cleanMunicipioWithAI,
        priority: 2
    },
    categoria: {
        cleaner: cleanCategoryWithAI,
        priority: 2
    },
    tieneEmpleo: {
        cleaner: cleanEmploymentStatusWithAI,
        priority: 3,
        alias: ['empleo']
    },
    fechaNacimiento: {
        cleaner: cleanDateWithAI,
        priority: 3,
        alias: ['fecha']
    },
    escolaridad: {
        cleaner: cleanEscolaridadWithAI,
        priority: 4
    }
};

/**
 * Helper to get the schema definition for any field or its alias.
 */
export const getSchemaByField = (fieldName) => {
    if (DATA_SCHEMA[fieldName]) return DATA_SCHEMA[fieldName];

    // Check aliases
    for (const [key, config] of Object.entries(DATA_SCHEMA)) {
        if (config.alias && config.alias.includes(fieldName)) {
            return { ...config, canonicalField: key };
        }
    }
    return null;
};
