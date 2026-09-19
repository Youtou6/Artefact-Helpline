const { mongoose } = require('../config/db');
const { Schema } = mongoose;

const AnswerSchema = new Schema({
  question: { type: String, required: true }, // texte affiché à l'utilisateur (dans sa langue)
  answer: { type: String, required: true }, // réponse brute de l'utilisateur (langue d'origine)
  answerFr: { type: String, default: null }, // traduction FR, uniquement si langue = de
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
  closeReason: { type: String, default: null },

  lastActivityAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Ticket', TicketSchema);
