// Normaliza teléfono al mismo formato que usa auth.js para el lookup
function normalizePhone(raw = '') {
    const clean = String(raw).replace(/\D/g, '');
    if (clean.length === 10) return '521' + clean;
    if (clean.length === 12 && clean.startsWith('52')) return '521' + clean.substring(2);
    return clean; // 13 dígitos o formato desconocido: dejar tal cual
}

export default async function handler(req, res) {
    try {
        // Dynamic import to prevent boot crashes and ensure path resolution
        const { getUsers, saveUser, deleteUser, validateAdminSession } = await import('./utils/storage.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        if (req.method === 'GET') {
            let users = await getUsers();

            // Auto-seed if no users exist (Always runs on cold start)
            if (!users || users.length === 0) {
                const defaultUser = {
                    id: 'user_default_admin',
                    name: 'Oscar Rodriguez',
                    whatsapp: '5218116038195',
                    fixedPin: '1234',
                    role: 'SuperAdmin',
                    status: 'Active',
                    createdAt: new Date().toISOString()
                };

                // Try to save and capture the result
                await saveUser(defaultUser);
                users = await getUsers();
            }

            return res.status(200).json({ success: true, users });
        }

        if (req.method === 'POST') {
            const userData = req.body;
            if (!userData.whatsapp || !userData.name) {
                return res.status(400).json({ success: false, error: 'Name and WhatsApp are required' });
            }
            userData.whatsapp = normalizePhone(userData.whatsapp);
            const user = await saveUser(userData);
            return res.status(200).json({ success: true, user });
        }

        if (req.method === 'PUT') {
            const userData = req.body;
            if (!userData.id) {
                return res.status(400).json({ success: false, error: 'User ID is required for update' });
            }
            if (userData.whatsapp) userData.whatsapp = normalizePhone(userData.whatsapp);
            const user = await saveUser(userData);
            return res.status(200).json({ success: true, user });
        }

        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) {
                return res.status(400).json({ success: false, error: 'User ID is required' });
            }
            const success = await deleteUser(id);
            return res.status(200).json({ success });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed' });

    } catch (error) {
        console.error('API Error (Users):', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
