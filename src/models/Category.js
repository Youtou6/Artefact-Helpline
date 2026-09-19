const { mongoose } = require('../config/db');
const { Schema } = mongoose;

const QuestionSchema = new Schema({
  id: { type: String, required: true }, // ex: "q1", généré côté serveur
  text: { type: String, required: true }, // rédigée en français (langue source), traduite à la volée
}, { _id: false });

const CategorySchema = new Schema({
  // Slug technique stable, utilisé dans les noms de salons / customId. Ne change jamais après création.
  key: { type: String, required: true, unique: true },

  emoji: { type: String, default: '📁' },
  name: { type: String, required: true }, // français, source pour traduction

  order: { type: Number, default: 0 },
  active: { type: Boolean, default: true },

  staffRoleId: { type: String, default: null },

  // Gabarit du nom de salon. Variables : {user} = pseudo nettoyé, {count} = numéro incrémental sur 4 chiffres
  ticketNameFormat: { type: String, default: '{key}-{count}' },

  anonymousReplies: { type: Boolean, default: false },

  // 0 = pas de fermeture automatique
  autoCloseMinutes: { type: Number, default: 0 },

  questions: { type: [QuestionSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('Category', CategorySchema);
