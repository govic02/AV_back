// controllers/programaController.js
const Programa = require('../models/Programa');

async function registrarProgramaDesdeChat(chatId, data) {
    try {
        const nuevoPrograma = new Programa({
            ...data,
            numeroTelefono: data.numeroTelefono, // Asegurarse de que se incluye el numeroTelefono
          });
      await nuevoPrograma.save();
      console.log('✅ Programa guardado:', nuevoPrograma);
      return nuevoPrograma;
    } catch (error) {
      console.error('Error al registrar programa:', error);
      throw error; // Importante para que el error sea capturado en la función que llama
    }
  }

module.exports = {
  registrarProgramaDesdeChat,
};
