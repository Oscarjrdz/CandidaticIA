import { Resend } from 'resend';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch {}
        }

        const { nombre, wapp, correo } = body || {};
        if (!nombre || !wapp) {
            return res.status(400).json({ error: 'Faltan campos requeridos' });
        }

        const resend = new Resend(process.env.RESEND_API_KEY);

        await resend.emails.send({
            from: 'Candidatic IA <onboarding@resend.dev>',
            to: 'oscarjrdz@gmail.com',
            subject: '📋 Nueva solicitud de información — Candidatic IA',
            html: `
                <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
                    <h2 style="color:#7c3aed;margin:0 0 16px">Nueva solicitud de info</h2>
                    <table style="width:100%;border-collapse:collapse;font-size:14px;">
                        <tr><td style="padding:8px 0;color:#6b7280;width:110px">Nombre</td><td style="padding:8px 0;font-weight:600;color:#111827">${nombre}</td></tr>
                        <tr><td style="padding:8px 0;color:#6b7280">WhatsApp</td><td style="padding:8px 0;font-weight:600;color:#111827">${wapp}</td></tr>
                        <tr><td style="padding:8px 0;color:#6b7280">Correo</td><td style="padding:8px 0;font-weight:600;color:#111827">${correo || '—'}</td></tr>
                    </table>
                    <hr style="margin:16px 0;border:none;border-top:1px solid #f3f4f6"/>
                    <p style="font-size:12px;color:#9ca3af;margin:0">Enviado desde el formulario del landing de Candidatic IA</p>
                </div>
            `,
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('❌ [Info Request] Error:', error.message);
        return res.status(500).json({ success: false, error: 'Error al enviar' });
    }
}
