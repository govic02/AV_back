const mongoose = require('mongoose');

// Esquema para las plazas dentro de un cuadrante
const PlazaSchema = new mongoose.Schema({
  numero: { type: Number, required: true }, // Número de la plaza
  tipoAreaVerde: { type: String, required: true }, // Tipo de área verde (Plaza, Plazoleta, etc.)
  metrosCuadrados: { type: Number, required: true }, // Tamaño en m²
  direccion: { type: String, required: true }, // Dirección de la plaza
});

// Esquema para los cuadrantes
const CuadranteSchema = new mongoose.Schema({
  cuadrante: { type: String, required: true }, // Nombre o identificador del cuadrante
  plazas: [PlazaSchema], // Array de plazas dentro del cuadrante
});

// Crear índice para búsquedas frecuentes
CuadranteSchema.index({ 'plazas.direccion': 'text' }, { default_language: 'spanish' });

module.exports = mongoose.model('Cuadrante', CuadranteSchema);
