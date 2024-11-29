const mongoose = require('mongoose');

const ImageSchema = new mongoose.Schema({
  data: Buffer,          // Almacena los datos binarios de la imagen
  contentType: String,   // Almacena el tipo de contenido MIME de la imagen
});

const JardinSchema = new mongoose.Schema({
  cuadrante: { type: String, required: true },
  plaza: { type: String, required: true },
  observaciones: { type: String, required: true },
  images: [ImageSchema], // Modificado para almacenar imágenes como datos binarios
  numeroTelefono: { type: String },
  createdAt: { type: Date, default: Date.now },
});
JardinSchema.index({ cuadrante: 'text', plaza: 'text', observaciones: 'text' }, { default_language: 'spanish' });
module.exports = mongoose.model('Jardin', JardinSchema);
