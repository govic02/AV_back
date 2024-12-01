const Jardin = require('../models/Jardin');

async function registrarJardin(data) {
  const nuevoJardin = new Jardin(data);
  return await nuevoJardin.save();
}

async function registrarJardinDesdeChat(chatId, data) {
  await registrarJardin(data);
}

async function consultarJardines(limit = 9) {
  return await Jardin.find().sort({ createdAt: -1 }).limit(limit);
}
async function consultarRegistros(functionArgs, conversation, numeroTelefono) {
  try {
    const { criterio, valor } = functionArgs;
    let registros;

    if (criterio === 'cuadrante') {
      registros = await Jardin.find({ cuadrante: { $regex: valor, $options: 'i' } });
    } else if (criterio === 'plaza') {
      registros = await Jardin.find({ plaza: { $regex: valor, $options: 'i' } });
    } else if (criterio === 'observaciones' || criterio === 'tarea') {
      registros = await Jardin.find({ observaciones: { $regex: valor, $options: 'i' } });
    } else {
      const errorMessage = 'Criterio de búsqueda no válido. Por favor, especifica un criterio correcto (cuadrante, plaza u observaciones).';
      conversation.push({ role: 'assistant', content: errorMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });
      return errorMessage;
    }

    if (registros.length === 0) {
      const noRecordsMessage = 'No se encontraron registros con los criterios especificados.';
      conversation.push({ role: 'assistant', content: noRecordsMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: noRecordsMessage });
      return noRecordsMessage;
    }

    // Prepara los datos para que el LLM pueda construir una respuesta detallada
    const registrosInfo = registros.map((registro) => ({
      cuadrante: registro.cuadrante,
      plaza: registro.plaza,
      observaciones: registro.observaciones,
      fecha: registro.createdAt.toLocaleDateString(),
    }));

    // Añade la información al contexto de la conversación
    conversation.push({
      role: 'system',
      content: `Datos de los registros encontrados:\n${JSON.stringify(registrosInfo, null, 2)}`,
    });

    // Pide al LLM que construya una respuesta útil
    const followUpResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: conversation,
    });

    const assistantMessage = followUpResponse.choices[0].message;

    if (assistantMessage.content) {
      conversation.push(assistantMessage);
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: assistantMessage.content });
      return assistantMessage.content;
    } else {
      const errorMessage = 'Lo siento, no pude generar una respuesta.';
      conversation.push({ role: 'assistant', content: errorMessage });
      await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });
      return errorMessage;
    }
  } catch (error) {
    console.error('Error en consultarRegistros:', error);
    const errorMessage = 'Lo siento, ha ocurrido un error al realizar la consulta.';
    conversation.push({ role: 'assistant', content: errorMessage });
    await guardarConversacion(numeroTelefono, { role: 'assistant', content: errorMessage });
    return errorMessage;
  }
}
module.exports = { registrarJardin, consultarJardines, registrarJardinDesdeChat };
