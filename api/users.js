export default async function handler(req, res) {
    try {
        // Dynamic import to prevent boot crashes and ensure path resolution
        const { getUsers, saveUser, deleteUser } = await import('./utils/storage.js');

        if (req.method === 'GET') {
            let users = await getUsers();

            // Auto-seed if no users exist (Always runs on cold start)
            if (!users || users.length === 0) {
                console.log('No users found. Seeding default Admin...');
                const defaultUser = {
                    id: 'user_default_admin',
                    name: 'Oscar Rodriguez',
                    whatsapp: '8116038195',
                    pin: '1234',
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
            const user = await saveUser(userData);
            return res.status(200).json({ success: true, user });
        }

        if (req.method === 'PUT') {
            const userData = req.body;
            if (!userData.id) {
                return res.status(400).json({ success: false, error: 'User ID is required for update' });
            }
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
