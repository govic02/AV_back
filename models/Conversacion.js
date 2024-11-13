const mongoose = require('mongoose');

const ConversacionSchema = new mongoose.Schema({
  numeroTelefono: { type: String, required: true },
  mensajes: [
    {
      role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
      content: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
    },
  ],
});

module.exports = mongoose.model('Conversacion', ConversacionSchema);
