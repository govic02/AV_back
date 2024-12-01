const mongoose = require('mongoose');

const ImageSchema = new mongoose.Schema({
  data: Buffer,          // Almacena los datos binarios de la imagen
  contentType: String,   // Almacena el tipo de contenido MIME de la imagen
});

const ProgramaSchema = new mongoose.Schema({
  fecha: { type: Date, required: true },
  nombre: { type: String, required: true },
  lugarDeReferencia: { type: String, required: true },
  categoria: { type: String, required: true },
  fecha: { type: Date, required: true },
  numeroTelefono: { type: String },
  images: [ImageSchema], 
  createdAt: { type: Date, default: Date.now },
});

ProgramaSchema.index(
  { nombre: 'text', lugarDeReferencia: 'text', categoria: 'text' },
  { default_language: 'spanish' }
);

module.exports = mongoose.model('Programa', ProgramaSchema);
