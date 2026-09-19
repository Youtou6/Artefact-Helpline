const { mongoose } = require('../config/db');
const { Schema } = mongoose;

const BlacklistSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String, default: '' },
  reason: { type: String, default: '' },
  addedBy: { type: String, default: '' }, // tag du staff qui a ajouté
}, { timestamps: true });

module.exports = mongoose.model('Blacklist', BlacklistSchema);
