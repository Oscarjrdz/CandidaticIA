export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const { getRedisClient } = await import('./utils/storage.js');
            const redis = getRedisClient();

            // Default fields that always exist
            const DEFAULT_FIELDS = [
                { value: 'nombreReal', label: 'Nombre Real' },
                { value: 'fechaNacimiento', label: 'Fecha Nacimiento' },
                { value: 'municipio', label: 'Municipio' },
                { value: 'categoria', label: 'Categoría' },
                { value: 'tieneEmpleo', label: 'Tiene empleo' }
            ];

            const customFieldsJson = await redis.get('custom_fields');
            let customFields = [];
            if (customFieldsJson) {
                customFields = JSON.parse(customFieldsJson);
            }

            // Merge default and custom fields
            // Ensure no duplicates by value
            const allFields = [...DEFAULT_FIELDS, ...customFields];

            // Deduplicate just in case
            const uniqueFields = Array.from(new Map(allFields.map(item => [item.value, item])).values());

            return res.status(200).json({ success: true, fields: uniqueFields });

        } catch (error) {
            console.error('Error fetching fields:', error);
            return res.status(500).json({ success: false, error: 'Error fetching fields' });
        }
    } else if (req.method === 'POST') {
        try {
            const { label } = req.body;
            if (!label) {
                return res.status(400).json({ success: false, error: 'Label is required' });
            }

            const { getRedisClient } = await import('./utils/storage.js');
            const redis = getRedisClient();

            // Generate slug-safe value
            const value = label
                .toLowerCase()
                .trim()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
                .replace(/[^a-z0-9]/g, '') // remove non-alphanumeric
            // ensure camelCase-ish output? or just flat
            // Let's keep it simple: "nivel ingles" -> "nivelingles"
            // or improve camelCase generation if needed. 
            // Simple is better for keys.

            if (!value) {
                return res.status(400).json({ success: false, error: 'Invalid field label' });
            }

            const newField = { value, label };

            // Get existing
            const customFieldsJson = await redis.get('custom_fields');
            let customFields = [];
            if (customFieldsJson) {
                customFields = JSON.parse(customFieldsJson);
            }

            // Check duplicate
            if (customFields.some(f => f.value === value)) {
                return res.status(200).json({ success: true, field: newField, message: 'Field already exists' });
            }

            customFields.push(newField);
            await redis.set('custom_fields', JSON.stringify(customFields));

            return res.status(200).json({ success: true, field: newField });

        } catch (error) {
            console.error('Error creating field:', error);
            return res.status(500).json({ success: false, error: 'Error creating field' });
        }
    } else {
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}
