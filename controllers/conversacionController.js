const Conversacion = require('../models/Conversacion');

// Función para guardar una conversación en MongoDB
async function guardarConversacion(numeroTelefono, mensaje) {
  try {
    if (!mensaje.content || mensaje.content.trim() === '') {
        console.warn('Intento de guardar mensaje con contenido vacío. Se omitirá este mensaje.');
        return;
      }
    let conversacion = await Conversacion.findOne({ numeroTelefono });

    if (!conversacion) {
      conversacion = new Conversacion({ numeroTelefono, mensajes: [] });
    }

    conversacion.mensajes.push(mensaje);
    await conversacion.save();

    console.log('Conversación guardada correctamente.');
  } catch (error) {
    console.error('Error al guardar la conversación:', error);
    throw new Error('Error al guardar la conversación');
  }
}

// Función para obtener conversaciones de un número de teléfono
async function obtenerConversacionPorNumero(numeroTelefono) {
  try {
    return await Conversacion.findOne({ numeroTelefono });
  } catch (error) {
    console.error('Error al obtener la conversación:', error);
    throw new Error('Error al obtener la conversación');
  }
}

module.exports = {
  guardarConversacion,
  obtenerConversacionPorNumero,
};
