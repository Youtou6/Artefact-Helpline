const { mongoose } = require('../config/db');
const { Schema } = mongoose;

const CannedResponseSchema = new Schema({
  // null = disponible pour toutes les catégories
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },

  label: { type: String, required: true }, // court, affiché dans le menu déroulant
  content: { type: String, required: true }, // français, source pour traduction
}, { timestamps: true });

module.exports = mongoose.model('CannedResponse', CannedResponseSchema);
