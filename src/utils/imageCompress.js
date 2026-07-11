/**
 * Compresión de imágenes en el navegador antes de subir.
 *
 * Reduce fotos pesadas (ej. 600 KB → ~120 KB, celular 5 MB → ~250 KB) redimensionando
 * a un máximo de 1600px por lado y recodificando a JPEG 80%. WhatsApp recomprime las
 * fotos al entregarlas de todos modos, así que la calidad percibida no cambia — pero
 * Redis guarda mucho menos (el banco de respuestas conserva base64 90 días) y la
 * subida es más rápida.
 *
 * Siempre-seguro: si algo falla, si el archivo no es imagen, si es GIF (animación),
 * o si la compresión no ayuda, se regresa el archivo original tal cual.
 */
export async function compressImage(file, { maxDim = 1600, quality = 0.8 } = {}) {
    if (!file?.type?.startsWith('image/')) return file;
    if (file.type === 'image/gif') return file; // no romper animaciones
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        // Ya es chica y liviana: no vale la pena recodificar
        if (scale === 1 && file.size <= 200 * 1024) { bitmap.close?.(); return file; }

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob || blob.size >= file.size) return file; // no ayudó: original

        const name = (file.name || 'imagen').replace(/\.\w+$/, '') + '.jpg';
        return new File([blob], name, { type: 'image/jpeg' });
    } catch {
        return file;
    }
}
