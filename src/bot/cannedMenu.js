const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
const client = require('./client');
const Ticket = require('../models/Ticket');
const Category = require('../models/Category');
const CannedResponse = require('../models/CannedResponse');
const { translateText } = require('./translate');
const { isStaffMember } = require('./permissions');
const {
  buildTextContainer,
  buildSimpleContainerMessage,
  CV2_EPHEMERAL_FLAGS,
} = require('./components');

const cannedCommand = new SlashCommandBuilder()
  .setName('canned')
  .setDescription('Envoyer une réponse prédéfinie à ce ticket');

/** Enregistre les commandes slash sur un serveur donné (appelé au ready et à l'initialisation). */
async function registerGuildCommands(guild) {
  try {
    await guild.commands.set([cannedCommand.toJSON()]);
  } catch (err) {
    console.error('[commands] échec d\'enregistrement sur', guild.id, err.message);
  }
}

async function handleCannedCommand(interaction) {
  const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: 'open' });
  if (!ticket) {
    await interaction.reply(buildSimpleContainerMessage('Cette commande doit être utilisée dans un salon de ticket ouvert.', { ephemeral: true }));
    return;
  }

  const category = await Category.findById(ticket.categoryId);
  if (!isStaffMember(interaction.member, category?.staffRoleId)) {
    await interaction.reply(buildSimpleContainerMessage('Tu n\'as pas la permission de faire ça.', { ephemeral: true }));
    return;
  }

  const responses = await CannedResponse.find({
    $or: [{ categoryId: category._id }, { categoryId: null }],
  });

  if (responses.length === 0) {
    await interaction.reply(buildSimpleContainerMessage(
      'Aucune réponse prédéfinie configurée pour cette catégorie. Ajoutes-en depuis le dashboard.',
      { ephemeral: true }
    ));
    return;
  }

  const container = buildTextContainer(['Sélectionne la réponse à envoyer :']);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`canned:select:${ticket._id}`)
    .setPlaceholder('Choisir une réponse')
    .addOptions(responses.map((r) => ({ label: r.label.slice(0, 100), value: r._id.toString() })));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(select));

  await interaction.reply({ components: [container], flags: CV2_EPHEMERAL_FLAGS });
}

async function handleCannedSelect(interaction) {
  const ticketId = interaction.customId.split(':')[2];
  const responseId = interaction.values[0];

  const ticket = await Ticket.findById(ticketId);
  const canned = await CannedResponse.findById(responseId);
  const category = ticket ? await Category.findById(ticket.categoryId) : null;

  if (!ticket || ticket.status !== 'open' || !canned) {
    await interaction.update(buildSimpleContainerMessage('Ce ticket ou cette réponse n\'existe plus.', { ephemeral: true })).catch(() => {});
    return;
  }

  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (user) {
    const dm = await user.createDM().catch(() => null);
    if (dm) {
      const text = ticket.language === 'de' ? await translateText(canned.content, 'de') : canned.content;
      const prefix = category?.anonymousReplies ? '**Support Team**' : `**${interaction.member?.displayName || interaction.user.username}**`;
      await dm.send(`${prefix}\n${text}`).catch(() => {});
    }
  }

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel) {
    await channel.send(buildSimpleContainerMessage(
      `📌 Réponse prédéfinie **"${canned.label}"** envoyée par ${interaction.member?.displayName || interaction.user.username}`
    )).catch(() => {});
  }

  ticket.lastActivityAt = new Date();
  await ticket.save();

  await interaction.update(buildSimpleContainerMessage(`✅ Réponse "${canned.label}" envoyée.`, { ephemeral: true })).catch(() => {});
}

module.exports = { registerGuildCommands, handleCannedCommand, handleCannedSelect };
