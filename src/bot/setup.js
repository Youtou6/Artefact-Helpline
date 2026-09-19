const { ChannelType, PermissionFlagsBits } = require('discord.js');
const client = require('./client');
const Settings = require('../models/Settings');
const { registerGuildCommands } = require('./cannedMenu');

/**
 * Crée (ou recrée) la catégorie de tickets et le salon de logs sur le serveur
 * configuré, et enregistre les commandes slash. Appelé depuis le dashboard,
 * notamment lors d'une migration serveur de test -> serveur de production.
 */
async function initializeGuild(guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    throw new Error(
      "Le bot n'est pas présent sur ce serveur (ou l'ID est incorrect). " +
        'Invite-le d\'abord avec le lien du portail développeur.'
    );
  }

  const category = await guild.channels.create({
    name: '🎫 Tickets',
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ],
  });

  const logChannel = await guild.channels.create({
    name: '📜-modmail-logs',
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ],
  });

  await registerGuildCommands(guild);

  const settings = await Settings.getSingleton();
  settings.guildId = guildId;
  settings.ticketCategoryId = category.id;
  settings.logChannelId = logChannel.id;
  settings.initialized = true;
  await settings.save();

  return { ticketCategoryId: category.id, logChannelId: logChannel.id, guildName: guild.name };
}

module.exports = { initializeGuild };
