const { mongoose } = require('../config/db');
const { Schema } = mongoose;

const AnswerSchema = new Schema({
  question: { type: String, required: true }, // texte de la question (français, source)
  type: { type: String, enum: ['text', 'select', 'file'], default: 'text' },
  answer: { type: String, required: true }, // réponse brute (texte, option choisie, ou URLs de fichiers)
  answerFr: { type: String, default: null }, // traduction FR, uniquement pour les réponses texte en allemand
}, { _id: false });

const TicketSchema = new Schema({
  ticketNumber: { type: Number, required: true },

  userId: { type: String, required: true, index: true },
  username: { type: String, required: true },

  language: { type: String, enum: ['en', 'fr', 'de'], required: true },

  categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  categoryKey: { type: String, required: true },

  channelId: { type: String, required: true },

  answers: { type: [AnswerSchema], default: [] },

  status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },

  claimedBy: { type: String, default: null },
  claimedByTag: { type: String, default: null },

  closedBy: { type: String, default: null },
  closeReason: { type: String, default: null }, // 'staff' | 'inactivity' | 'auto'

  // Suivi de l'inactivité en 2 temps. Remis à null dès qu'il y a une nouvelle activité.
  inactivityWarnedAt: { type: Date, default: null },

  // Note laissée par l'utilisateur après la fermeture (1 à 5), via DM.
  rating: { type: Number, min: 1, max: 5, default: null },

  lastActivityAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Ticket', TicketSchema);
