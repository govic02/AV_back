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

module.exports = { registrarJardin, consultarJardines, registrarJardinDesdeChat };
