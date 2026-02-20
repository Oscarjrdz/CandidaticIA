import { getProjectById } from '../utils/storage.js';

export default async function handler(req, res) {
    const proj = await getProjectById('proj_1771225156891_10ez5k');
    res.status(200).json(proj);
}
