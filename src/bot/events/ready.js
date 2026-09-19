const Settings = require('../../models/Settings');
const { registerGuildCommands } = require('../cannedMenu');
const { startAutoCloseChecker } = require('../ticketChannel');

module.exports = async function onReady(client) {
  console.log(`[bot] Connecté en tant que ${client.user.tag}`);

  const settings = await Settings.getSingleton();
  if (settings.guildId) {
    const guild = client.guilds.cache.get(settings.guildId);
    if (guild) {
      await registerGuildCommands(guild);
      console.log(`[bot] Commandes enregistrées sur ${guild.name}`);
    } else {
      console.warn(`[bot] guildId configuré (${settings.guildId}) mais le bot n'est pas sur ce serveur.`);
    }
  }

  startAutoCloseChecker();
};
