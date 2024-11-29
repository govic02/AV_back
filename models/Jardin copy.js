const mongoose = require('mongoose');

const JardinSchema = new mongoose.Schema({
  cuadrante: { type: String, required: true },
  plaza: { type: String, required: true },
  observaciones: { type: String, required: true },
  images: [{ type: String }], // Campo para las imágenes
  numeroTelefono: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Jardin', JardinSchema);
