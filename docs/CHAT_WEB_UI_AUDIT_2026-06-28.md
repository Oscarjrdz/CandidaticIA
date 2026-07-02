# Chat Web UI Audit - 2026-06-28

Objetivo: llevar Chat Web a una sensacion tipo WhatsApp Web: estable, inmediato, sin brincos, sin duplicados visuales, sin scroll animado automatico y con microinteracciones que no repinten el hilo.

## Principios aplicados

- El chat no debe "viajar" desde arriba hacia abajo al abrirse.
- El hilo debe mantenerse anclado al ultimo mensaje si el usuario esta abajo.
- Los mensajes se ordenan por `timestamp`/`fecha`, no por orden de llegada de SSE/fetch.
- El mensaje temporal y el mensaje real deben ser la misma burbuja visual.
- El hover no debe cambiar layout ni provocar repaint del hilo.
- Las animaciones automaticas se reservan para feedback real, no para decoracion permanente.

## Cambios implementados

- Render estable de mensajes con `_clientKey` para que el cambio de `temp-id` a id real no remonte la burbuja.
- Merge de mensajes por id, `ultraMsgId`, contenido, media y ventana temporal.
- Orden cronologico estable despues de mezclar SSE, fetch y mensajes temporales.
- Anclaje al fondo con `Virtuoso.scrollToIndex({ align: 'end' })`.
- Re-anclaje cuando cambia la altura total de la lista.
- Scroll automatico sin animacion; solo el boton manual mantiene scroll suave.
- Cache visual de burbujas para no reconstruir todo el hilo en cada status update.
- Banco de Respuestas con guard contra doble aplicacion.
- Shortcuts del banco bloqueados mientras se escribe en inputs/textareas.
- Acciones hover de burbuja con area fija, sin escalado ni transiciones que muevan/repainten.
- Filas de chat cambiadas de `transition-all` a `transition-colors`.
- Imagenes/stickers sin `animate-pulse` permanente; carga asincrona con dimensiones estables.

## Diferencias contra WhatsApp Web que ya cubrimos

- WhatsApp no anima el scroll automatico del hilo: mantiene fondo fijo. Ya aplicado.
- WhatsApp no remonta mensajes por cambio de status. Ya mitigado con keys/cache.
- WhatsApp evita que media cambie la altura final de forma sorpresiva. Ya usamos dimensiones fijas para imagen/sticker/video.
- WhatsApp ordena por tiempo del mensaje, no por llegada del evento. Ya aplicado.

## Siguiente nivel recomendado

- Medir con Performance Profiler en un chat real de 100+ mensajes.
- Convertir preview de imagen/video/documento en subcomponentes memoizados.
- Separar estado de `reactionPopupId` para que no invalide todas las burbujas.
- Precalcular `quotedMessage` por mapa en vez de buscar en `allMessages` dentro de cada burbuja.
- Reemplazar algunos `transition-all` restantes en filtros/dropdowns por `transition-colors` o transiciones especificas.
- Agregar prueba manual fija: abrir chat largo, enviar texto, enviar banco con imagen, recibir mensaje candidato, cambiar entre chats, mover mouse por 20 burbujas.
