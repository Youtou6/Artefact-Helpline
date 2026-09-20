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

  // Lien Discord direct vers le message du transcript dans le salon de logs
  // (utilisé par le dashboard puisque le salon du ticket, lui, est supprimé).
  transcriptUrl: { type: String, default: null },

  // Suivi de l'inactivité en 2 temps. Remis à null dès qu'il y a une nouvelle activité.
  inactivityWarnedAt: { type: Date, default: null },

  // L'IA est-elle actuellement "aux commandes" de la conversation pour ce ticket ?
  // true tant qu'elle continue de poser des questions ; repassée à false dès qu'elle
  // termine sa collecte, qu'elle juge un humain nécessaire, ou qu'un staff humain écrit.
  aiActive: { type: Boolean, default: false },
  // Compteur de tours IA déclenchés automatiquement (garde-fou anti-boucle infinie).
  aiTurnCount: { type: Number, default: 0 },

  // Note laissée par l'utilisateur après la fermeture (1 à 5), via DM.
  rating: { type: Number, min: 1, max: 5, default: null },

  lastActivityAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Ticket', TicketSchema);
