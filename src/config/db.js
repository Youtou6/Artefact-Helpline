const mongoose = require('mongoose');
const { mongoUri } = require('./env');

async function connectDB() {
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(mongoUri);
    console.log('[db] Connecté à MongoDB.');
  } catch (err) {
    console.error('[db] Échec de connexion à MongoDB :', err.message);
    process.exit(1);
  }
}

module.exports = { connectDB, mongoose };
