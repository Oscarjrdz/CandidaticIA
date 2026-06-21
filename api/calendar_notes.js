import Redis from 'ioredis';
import { validateAdminSession } from './utils/storage.js';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export default async function handler(req, res) {
    // Only allow specific origins (CORS)
    const allowedOrigins = ['http://localhost:3000', 'https://candidatic.com', 'https://www.candidatic.com', 'https://candidatic-admin.vercel.app'];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') return res.status(200).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    try {
        if (req.method === 'GET') {
            const { projectId } = req.query;
            if (!projectId) return res.status(400).json({ error: 'Falta projectId' });

            const KEY = `crm_calendar_notes_${projectId}`;
            const data = await redis.get(KEY);
            const notes = data ? JSON.parse(data) : [];
            
            return res.status(200).json({ success: true, notes });
        }

        if (req.method === 'POST') {
            const { action, projectId, noteId, date, content, candidateId, candidateName } = req.body;
            if (!projectId) return res.status(400).json({ error: 'Falta projectId' });

            const KEY = `crm_calendar_notes_${projectId}`;
            const data = await redis.get(KEY);
            let notes = data ? JSON.parse(data) : [];

            if (action === 'create') {
                if (!date || !content) return res.status(400).json({ error: 'Faltan campos' });
                const newNote = {
                    id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
                    date, // YYYY-MM-DD
                    content,
                    candidateId: candidateId || null,
                    candidateName: candidateName || null,
                    createdAt: new Date().toISOString()
                };
                notes.push(newNote);
                await redis.set(KEY, JSON.stringify(notes));
                return res.status(201).json({ success: true, note: newNote });
            }

            if (action === 'delete') {
                if (!noteId) return res.status(400).json({ error: 'Falta noteId' });
                notes = notes.filter(n => n.id !== noteId);
                await redis.set(KEY, JSON.stringify(notes));
                return res.status(200).json({ success: true });
            }

            if (action === 'update') {
                if (!noteId || !content) return res.status(400).json({ error: 'Faltan campos' });
                const noteIndex = notes.findIndex(n => n.id === noteId);
                if (noteIndex === -1) return res.status(404).json({ error: 'Nota no encontrada' });
                
                notes[noteIndex].content = content;
                await redis.set(KEY, JSON.stringify(notes));
                return res.status(200).json({ success: true, note: notes[noteIndex] });
            }

            return res.status(400).json({ error: 'Acción no válida' });
        }

        return res.status(405).json({ error: 'Método no permitido' });
    } catch (error) {
        console.error('Error en calendar_notes API:', error);
        return res.status(500).json({ error: 'Error del servidor' });
    }
}
