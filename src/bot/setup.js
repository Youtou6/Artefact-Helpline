const { ChannelType, PermissionFlagsBits } = require('discord.js');
const client = require('./client');
const Settings = require('../models/Settings');
const Category = require('../models/Category');
const { registerGuildCommands } = require('./cannedMenu');

const BOT_CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ManageChannels,
];

const STAFF_LOG_VIEW_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
];

/**
 * Crée la catégorie de tickets et le salon de logs sur le serveur configuré, et
 * enregistre les commandes slash. Idempotent : si les salons existent déjà, ne
 * recrée rien — répare juste les permissions dessus (bot + rôles staff). C'est ce
 * qui permet de "réparer" une installation existante en re-cliquant simplement
 * sur "Initialiser sur ce serveur" dans le dashboard.
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

  // Tous les rôles staff configurés sur les catégories : ils doivent pouvoir VOIR
  // le salon de logs (jusqu'ici, seul le bot le pouvait — c'était le bug : le staff
  // ne voyait littéralement pas ce salon, même quand le bot y postait bien).
  const categories = await Category.find({ staffRoleId: { $ne: null } }).select('staffRoleId');
  const staffRoleIds = [...new Set(categories.map((c) => c.staffRoleId).filter(Boolean))];

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
        ...staffRoleIds.map((roleId) => ({ id: roleId, allow: STAFF_LOG_VIEW_PERMISSIONS })),
      ],
    });
  } else {
    await logChannel.permissionOverwrites.edit(client.user.id, {
      ViewChannel: true, SendMessages: true, AttachFiles: true, EmbedLinks: true,
    }).catch(() => {});
    for (const roleId of staffRoleIds) {
      await logChannel.permissionOverwrites.edit(roleId, {
        ViewChannel: true, ReadMessageHistory: true,
      }).catch(() => {});
    }
  }

  await registerGuildCommands(guild);

  settings.guildId = guildId;
  settings.ticketCategoryId = category.id;
  settings.logChannelId = logChannel.id;
  settings.initialized = true;
  await settings.save();

  return { ticketCategoryId: category.id, logChannelId: logChannel.id, guildName: guild.name, staffRolesGranted: staffRoleIds.length };
}

module.exports = { initializeGuild };
