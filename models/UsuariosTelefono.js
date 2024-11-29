const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  numeroTelefono: {
    type: String,
    required: true,
    unique: true,  // Asegura que no haya números duplicados
    trim: true     // Elimina espacios en blanco
  },
  rol: {
    type: String,
    required: true,
    enum: ['operator', 'administrator'], // Solo permite estos roles
    default: 'operator'
  },
  activo: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date
  },
  nombre: {
    type: String,
    trim: true
  }
});

// Índices para búsquedas frecuentes
UserSchema.index({ numeroTelefono: 1 });
UserSchema.index({ rol: 1 });
UserSchema.index({ activo: 1 });

// Método para verificar si un usuario tiene un rol específico
UserSchema.methods.hasRole = function(role) {
  return this.rol === role;
};

// Método para verificar si el usuario está activo
UserSchema.methods.isActive = function() {
  return this.activo;
};

// Método estático para buscar usuarios por rol
UserSchema.statics.findByRole = function(role) {
  return this.find({ rol: role, activo: true });
};

// Método estático para buscar usuario por número de teléfono
UserSchema.statics.findByPhone = function(phone) {
  return this.findOne({ numeroTelefono: phone, activo: true });
};

// Middleware para actualizar lastLogin
UserSchema.pre('save', function(next) {
  if (this.isNew) {
    this.lastLogin = new Date();
  }
  next();
});

module.exports = mongoose.model('UsuarioTelefono', UserSchema);
