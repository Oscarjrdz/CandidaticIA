import { getUsers, saveUser, deleteUser } from './utils/storage';

export default async function handler(req, res) {
    // Basic auth check could be added here later if needed

    try {
        if (req.method === 'GET') {
            const users = await getUsers();
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
