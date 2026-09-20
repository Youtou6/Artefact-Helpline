const { ChannelType, PermissionFlagsBits } = require('discord.js');
const client = require('./client');
const Settings = require('../models/Settings');
const { registerGuildCommands } = require('./cannedMenu');

// Permissions dont le bot a besoin sur la catégorie de tickets ET le salon de logs.
// Sans ça, si le rôle du bot n'a pas ces droits au niveau du serveur, tous ses envois
// dans ces salons échouent silencieusement (c'était le bug : le salon de logs ne
// recevait jamais rien car seul @everyone était explicitement géré, pas le bot).
const BOT_CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ManageChannels,
];

/**
 * Crée la catégorie de tickets et le salon de logs sur le serveur configuré, et
 * enregistre les commandes slash. Idempotent : si les salons existent déjà (ID
 * stockés en base et toujours présents sur le serveur), ne recrée rien — se
 * contente de réparer les permissions du bot dessus. C'est ce qui permet de
 * "réparer" une installation existante en re-cliquant simplement sur le bouton
 * "Initialiser sur ce serveur" du dashboard, sans rien dupliquer.
 */
async function initializeGuild(guildId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    throw new Error(
      "Le bot n'est pas présent sur ce serveur (ou l'ID est incorrect). " +
        'Invite-le d\'abord avec le lien du portail développeur.'
    );
  }

  const settings = await Settings.getSingleton();
  const sameGuild = settings.guildId === guildId;

  let category = sameGuild && settings.ticketCategoryId
    ? await guild.channels.fetch(settings.ticketCategoryId).catch(() => null)
    : null;

  if (!category) {
    category = await guild.channels.create({
      name: '🎫 Tickets',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user.id, allow: BOT_CHANNEL_PERMISSIONS },
      ],
    });
  } else {
    await category.permissionOverwrites.edit(client.user.id, {
      ViewChannel: true, SendMessages: true, AttachFiles: true, EmbedLinks: true, ManageChannels: true,
    }).catch(() => {});
  }

  let logChannel = sameGuild && settings.logChannelId
    ? await guild.channels.fetch(settings.logChannelId).catch(() => null)
    : null;

  if (!logChannel) {
    logChannel = await guild.channels.create({
      name: '📜-modmail-logs',
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user.id, allow: BOT_CHANNEL_PERMISSIONS },
      ],
    });
  } else {
    await logChannel.permissionOverwrites.edit(client.user.id, {
      ViewChannel: true, SendMessages: true, AttachFiles: true, EmbedLinks: true,
    }).catch(() => {});
  }

  await registerGuildCommands(guild);

  settings.guildId = guildId;
  settings.ticketCategoryId = category.id;
  settings.logChannelId = logChannel.id;
  settings.initialized = true;
  await settings.save();

  return { ticketCategoryId: category.id, logChannelId: logChannel.id, guildName: guild.name };
}

module.exports = { initializeGuild };
