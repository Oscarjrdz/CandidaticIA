export default async function handler(req, res) {
    // Disabled for Candidatic 2.0 Migration
    return res.status(200).json({ status: 'disabled', message: 'Legacy export disabled' });
}
