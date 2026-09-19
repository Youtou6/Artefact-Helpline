const { mongoose } = require('../config/db');
const { Schema } = mongoose;

// Document unique (singleton) identifié par _id fixe "main".
const SettingsSchema = new Schema({
  _id: { type: String, default: 'main' },

  // Serveur actuellement actif. Modifiable depuis le dashboard pour passer
  // d'un serveur de test à un serveur de production.
  guildId: { type: String, default: null },

  // Créés automatiquement par le bot via le bouton "Initialiser" du dashboard.
  ticketCategoryId: { type: String, default: null },
  logChannelId: { type: String, default: null },

  // IDs Discord autorisés à accéder au dashboard, en plus de ceux du .env
  adminIds: { type: [String], default: [] },

  branding: {
    serverName: { type: String, default: 'Roblox Build Services' },
    logoUrl: { type: String, default: '' },
    footerText: { type: String, default: '' },
  },

  antiSpam: {
    windowMinutes: { type: Number, default: 10 },
    maxAttempts: { type: Number, default: 3 },
  },

  // Marqué true une fois que catégorie + salon de logs ont été créés sur le guildId actuel.
  initialized: { type: Boolean, default: false },
}, { timestamps: true });

SettingsSchema.statics.getSingleton = async function () {
  let doc = await this.findById('main');
  if (!doc) {
    doc = await this.create({ _id: 'main' });
  }
  return doc;
};

module.exports = mongoose.model('Settings', SettingsSchema);
