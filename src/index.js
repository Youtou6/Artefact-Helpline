const { connectDB } = require('./config/db');
const { port } = require('./config/env');

async function main() {
  await connectDB();

  // Le serveur web démarre en premier, immédiatement : Render (et UptimeRobot)
  // ont besoin de détecter un port ouvert rapidement, indépendamment du temps
  // que prend la connexion à Discord.
  const { createApp } = require('./dashboard/app');
  const app = createApp();
  app.listen(port, () => {
    console.log(`[dashboard] Serveur démarré sur le port ${port}`);
  });

  // Le bot est démarré ensuite. S'il échoue (token invalide, intents non
  // activés sur le portail développeur...), on ne coupe plus tout le process :
  // le dashboard reste accessible pour diagnostiquer, au lieu de crash-looper.
  try {
    const { startBot } = require('./bot/index');
    await startBot();
  } catch (err) {
    console.error(
      '[bot] Échec de connexion à Discord :', err.message,
      '\n→ Vérifie DISCORD_BOT_TOKEN, et que les intents "SERVER MEMBERS" et ' +
        '"MESSAGE CONTENT" sont bien activés sur https://discord.com/developers/applications ' +
        '(onglet Bot > Privileged Gateway Intents).' +
        '\nLe dashboard reste accessible, mais le bot ne répondra pas tant que ce n\'est pas corrigé ' +
        '(redémarre le service une fois le réglage fait).'
    );
  }
}

main().catch((err) => {
  console.error('[fatal] Erreur au démarrage :', err);
  process.exit(1);
});
