const { mongoose } = require('../config/db');
const { Schema } = mongoose;

const QuestionSchema = new Schema({
  id: { type: String, required: true }, // généré côté serveur

  // "text"   = réponse libre en DM
  // "select" = l'utilisateur choisit parmi des options (menu déroulant)
  // "file"   = l'utilisateur doit envoyer une pièce jointe
  type: { type: String, enum: ['text', 'select', 'file'], default: 'text' },

  text: { type: String, required: true }, // français, source pour traduction
  options: { type: [String], default: [] }, // uniquement pour type "select", français
}, { _id: false });

// Ce que l'IA a le droit de faire pour cette catégorie précise.
const AiPermissionsSchema = new Schema({
  canAskQuestions: { type: Boolean, default: true },
  canRedirect: { type: Boolean, default: false },
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

  // Inactivité en 2 temps. 0 = étape désactivée.
  inactivityWarningMinutes: { type: Number, default: 0 },
  inactivityCloseMinutes: { type: Number, default: 0 },

  questions: { type: [QuestionSchema], default: [] },

  // Contexte/instructions libres donnés à l'IA (Gemini) pour cette catégorie.
  aiContext: { type: String, default: '' },

  // Liste des informations que l'IA doit essayer de récupérer via la conversation
  // (en plus des questions fixes du formulaire). Ex : "Budget, Style, Deadline".
  // Une fois tout récupéré, l'IA envoie un fichier récapitulatif côté staff et s'arrête.
  aiInfoToCollect: { type: [String], default: [] },

  // Si activé, l'IA agit automatiquement juste après la création du ticket
  // (avant même que le staff n'intervienne), en tenant compte des réponses au formulaire.
  aiAutoRespond: { type: Boolean, default: false },

  // Droits de l'IA pour cette catégorie précise.
  aiPermissions: { type: AiPermissionsSchema, default: () => ({}) },
}, { timestamps: true });

module.exports = mongoose.model('Category', CategorySchema);
