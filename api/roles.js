export default async function handler(req, res) {
    try {
        const { getRoles, saveRole, deleteRole } = await import('./utils/storage.js');

        if (req.method === 'GET') {
            const roles = await getRoles();
            return res.status(200).json({ success: true, roles });
        }

        if (req.method === 'POST') {
            const roleData = req.body;
            if (!roleData.name) {
                return res.status(400).json({ success: false, error: 'Name is required' });
            }
            const role = await saveRole(roleData);
            return res.status(200).json({ success: true, role });
        }

        if (req.method === 'PUT') {
            const roleData = req.body;
            if (!roleData.id) {
                return res.status(400).json({ success: false, error: 'Role ID is required for update' });
            }
            const role = await saveRole(roleData);
            return res.status(200).json({ success: true, role });
        }

        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) {
                return res.status(400).json({ success: false, error: 'Role ID is required' });
            }
            const success = await deleteRole(id);
            return res.status(200).json({ success });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed' });

    } catch (error) {
        console.error('API Error (Roles):', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
