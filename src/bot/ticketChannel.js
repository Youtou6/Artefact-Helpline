const { AttachmentBuilder } = require('discord.js');
const client = require('./client');
const Settings = require('../models/Settings');
const Category = require('../models/Category');
const Ticket = require('../models/Ticket');
const { translateText } = require('./translate');
const { isStaffMember } = require('./permissions');
const {
  buildTicketPanel,
  buildTextContainer,
  buildCategoryRedirectSelect,
  buildClaimNotifyText,
  buildRedirectNotifyText,
  buildInactivityReminderText,
  buildCloseText,
  buildRatingRequestMessage,
  buildRatingThanksText,
  CV2_FLAGS,
} = require('./components');

/** Marque une activité sur le ticket et annule un éventuel rappel d'inactivité en cours. */
async function touchTicket(ticket) {
  ticket.lastActivityAt = new Date();
  ticket.inactivityWarnedAt = null;
  await ticket.save();
}

/** Message DM utilisateur -> relayé dans le salon du ticket. */
async function forwardDmToChannel(ticket, message) {
  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel) return;

  const attachments = [...message.attachments.values()].map((a) => new AttachmentBuilder(a.url, { name: a.name }));

  let content = `**${message.author.tag}**\n${message.content || ''}`.trim();
  if (ticket.language === 'de' && message.content?.trim()) {
    const fr = await translateText(message.content, 'fr');
    content += `\n> 🇫🇷 *${fr}*`;
  }

  await channel.send({ content: content || '\u200b', files: attachments }).catch(() => {});
  await touchTicket(ticket);
}

/** Message staff dans le salon -> relayé en DM à l'utilisateur. */
async function relayStaffMessage(message, ticket, category) {
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (!user) return;

  const dmChannel = await user.createDM().catch(() => null);
  if (!dmChannel) return;

  const attachments = [...message.attachments.values()].map((a) => new AttachmentBuilder(a.url, { name: a.name }));

  let text = message.content || '';
  if (ticket.language === 'de' && text.trim()) {
    text = await translateText(text, 'de');
  }

  const prefix = category.anonymousReplies ? '**Support Team**' : `**${message.member?.displayName || message.author.username}**`;
  const content = `${prefix}\n${text}`.trim();

  await dmChannel.send({ content: content || '\u200b', files: attachments }).catch(() => {});
  await touchTicket(ticket);
}

/** Bouton "Prendre en charge" */
async function handleClaim(interaction, ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({ content: 'Ce ticket n\'existe plus ou est déjà fermé.', ephemeral: true }).catch(() => {});
    return;
  }
  const category = await Category.findById(ticket.categoryId);
  if (!isStaffMember(interaction.member, category?.staffRoleId)) {
    await interaction.reply({ content: 'Tu n\'as pas la permission de faire ça.', ephemeral: true }).catch(() => {});
    return;
  }
  if (ticket.claimedBy) {
    await interaction.reply({ content: `Déjà pris en charge par ${ticket.claimedByTag}.`, ephemeral: true }).catch(() => {});
    return;
  }

  ticket.claimedBy = interaction.user.id;
  ticket.claimedByTag = interaction.member?.displayName || interaction.user.username;
  await ticket.save();

  const user = await client.users.fetch(ticket.userId).catch(() => null);
  const panel = buildTicketPanel({
    ticket, category, user: user || { id: ticket.userId, tag: ticket.username },
    claimedTag: ticket.claimedByTag, closed: false,
  });
  await interaction.update(panel).catch(() => {});

  // Contexte pour l'utilisateur : qui s'occupe de son ticket désormais.
  if (user) {
    const dm = await user.createDM().catch(() => null);
    if (dm) {
      const text = buildClaimNotifyText(ticket.language, ticket.claimedByTag, category.anonymousReplies);
      await dm.send(text).catch(() => {});
    }
  }
}

/** Bouton "Rediriger" : ouvre un menu déroulant éphémère des autres catégories. */
async function handleRedirectOpen(interaction, ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({ content: 'Ce ticket n\'existe plus ou est déjà fermé.', ephemeral: true }).catch(() => {});
    return;
  }
  const category = await Category.findById(ticket.categoryId);
  if (!isStaffMember(interaction.member, category?.staffRoleId)) {
    await interaction.reply({ content: 'Tu n\'as pas la permission de faire ça.', ephemeral: true }).catch(() => {});
    return;
  }

  const others = await Category.find({ active: true, _id: { $ne: ticket.categoryId } }).sort('order');
  if (others.length === 0) {
    await interaction.reply({ content: 'Aucune autre catégorie active disponible.', ephemeral: true }).catch(() => {});
    return;
  }

  const payload = buildCategoryRedirectSelect(others, ticket._id.toString());
  await interaction.reply(payload).catch(() => {});
}

/** Sélection de la nouvelle catégorie dans le menu de redirection. */
async function handleRedirectSelect(interaction) {
  const ticketId = interaction.customId.split(':')[2];
  const newCategoryId = interaction.values[0];

  const ticket = await Ticket.findById(ticketId);
  const newCategory = await Category.findById(newCategoryId);
  const oldCategory = ticket ? await Category.findById(ticket.categoryId) : null;

  if (!ticket || ticket.status !== 'open' || !newCategory) {
    await interaction.update({ content: 'Ce ticket ou cette catégorie n\'existe plus.', components: [] }).catch(() => {});
    return;
  }

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  const guild = channel?.guild;

  if (channel && guild) {
    // Recalcule les permissions : retire l'accès à l'ancien rôle staff, donne accès au nouveau.
    if (oldCategory?.staffRoleId && oldCategory.staffRoleId !== newCategory.staffRoleId) {
      await channel.permissionOverwrites.delete(oldCategory.staffRoleId).catch(() => {});
    }
    if (newCategory.staffRoleId) {
      await channel.permissionOverwrites.edit(newCategory.staffRoleId, {
        ViewChannel: true, SendMessages: true, AttachFiles: true,
      }).catch(() => {});
    }

    // Renomme le salon en gardant le même numéro de ticket, avec le préfixe de la nouvelle catégorie.
    const { buildChannelName } = require('./ticketFlow');
    const newName = buildChannelName(newCategory.ticketNameFormat, ticket.username, ticket.ticketNumber, newCategory.key);
    await channel.setName(newName).catch(() => {});
    await channel.setTopic(`Ticket #${ticket.ticketNumber} • ${newCategory.name} • ${ticket.username} (${ticket.userId})`).catch(() => {});
  }

  ticket.categoryId = newCategory._id;
  ticket.categoryKey = newCategory.key;
  ticket.inactivityWarnedAt = null;
  ticket.lastActivityAt = new Date();
  await ticket.save();

  const user = await client.users.fetch(ticket.userId).catch(() => null);

  // Contexte pour l'utilisateur : sa demande a changé de catégorie.
  if (user) {
    const dm = await user.createDM().catch(() => null);
    if (dm) await dm.send(buildRedirectNotifyText(ticket.language, newCategory.name)).catch(() => {});
  }

  // Rafraîchit le panneau du ticket dans le salon.
  if (channel) {
    const panel = buildTicketPanel({
      ticket, category: newCategory, user: user || { id: ticket.userId, tag: ticket.username },
      claimedTag: ticket.claimedByTag, closed: false, pingRoleId: newCategory.staffRoleId,
    });
    await channel.send({
      content: `🔀 Ticket redirigé vers **${newCategory.name}** par ${interaction.member?.displayName || interaction.user.username}.`,
    }).catch(() => {});
    await channel.send({ ...panel, allowedMentions: { roles: newCategory.staffRoleId ? [newCategory.staffRoleId] : [] } }).catch(() => {});
  }

  await interaction.update({ content: `✅ Ticket redirigé vers "${newCategory.name}".`, components: [] }).catch(() => {});
}

/** Bouton "Forcer le rappel d'inactivité" : envoie le rappel tout de suite, sans attendre le délai. */
async function handleForceRemind(interaction, ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({ content: 'Ce ticket n\'existe plus ou est déjà fermé.', ephemeral: true }).catch(() => {});
    return;
  }
  const category = await Category.findById(ticket.categoryId);
  if (!isStaffMember(interaction.member, category?.staffRoleId)) {
    await interaction.reply({ content: 'Tu n\'as pas la permission de faire ça.', ephemeral: true }).catch(() => {});
    return;
  }

  await sendInactivityReminder(ticket, category);
  await interaction.reply({ content: '⏰ Rappel d\'inactivité envoyé à l\'utilisateur.', ephemeral: true }).catch(() => {});

  const user = await client.users.fetch(ticket.userId).catch(() => null);
  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel) {
    const panel = buildTicketPanel({
      ticket, category, user: user || { id: ticket.userId, tag: ticket.username },
      claimedTag: ticket.claimedByTag, closed: false,
    });
    await channel.send(panel).catch(() => {});
  }
}

/** Envoie le rappel d'inactivité à l'utilisateur et marque le ticket en conséquence. */
async function sendInactivityReminder(ticket, category) {
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (user) {
    const dm = await user.createDM().catch(() => null);
    if (dm) await dm.send(buildInactivityReminderText(ticket.language)).catch(() => {});
  }

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel) {
    await channel.send('⏰ Rappel d\'inactivité envoyé à l\'utilisateur (aucune réponse depuis un moment).').catch(() => {});
  }

  ticket.inactivityWarnedAt = new Date();
  await ticket.save();
}

/** Bouton "Fermer le ticket" ou fermeture automatique (reason = 'staff' | 'inactivity'). */
async function handleClose(interaction, ticketId, { reason = 'staff' } = {}) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket || ticket.status !== 'open') {
    if (interaction) await interaction.reply({ content: 'Ce ticket est déjà fermé.', ephemeral: true }).catch(() => {});
    return;
  }

  const category = await Category.findById(ticket.categoryId);
  const auto = reason !== 'staff';

  if (interaction && !auto) {
    if (!isStaffMember(interaction.member, category?.staffRoleId)) {
      await interaction.reply({ content: 'Tu n\'as pas la permission de faire ça.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate().catch(() => {});
  }

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  const settings = await Settings.getSingleton();

  // Transcript .txt dans le salon des logs
  if (channel && settings.logChannelId) {
    const transcript = await generateTranscript(channel, ticket, category);
    const logChannel = await client.channels.fetch(settings.logChannelId).catch(() => null);
    if (logChannel) {
      const summary = buildTextContainer([
        `**Ticket #${ticket.ticketNumber} fermé — ${category?.name || ticket.categoryKey}**`,
        `👤 ${ticket.username} (\`${ticket.userId}\`)\n🌐 ${ticket.language.toUpperCase()}\n` +
          `${ticket.claimedByTag ? `🙋 Pris en charge par ${ticket.claimedByTag}\n` : ''}` +
          `🔒 Fermé par ${auto ? `fermeture automatique (${reason})` : (interaction?.member?.displayName || 'staff')}`,
      ]);
      await logChannel.send({
        components: [summary],
        flags: CV2_FLAGS,
        files: [new AttachmentBuilder(transcript, { name: `ticket-${ticket.ticketNumber}.txt` })],
      }).catch(() => {});
    }
  }

  // DM de fermeture + contexte
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (user) {
    const dm = await user.createDM().catch(() => null);
    if (dm) {
      await dm.send(buildCloseText(ticket.language, auto ? 'inactivity' : 'staff')).catch(() => {});
    }
  }

  ticket.status = 'closed';
  ticket.closedAt = new Date();
  ticket.closedBy = auto ? 'auto' : (interaction?.user?.id || 'unknown');
  ticket.closeReason = reason;
  await ticket.save();

  // Demande de notation, envoyée juste après (toujours utile, même en fermeture auto)
  if (user) {
    const dm = await user.createDM().catch(() => null);
    if (dm) await dm.send(buildRatingRequestMessage(ticket.language, ticket._id.toString())).catch(() => {});
  }

  if (channel) {
    setTimeout(() => channel.delete().catch(() => {}), 3000);
  }
}

/** Bouton de notation ⭐ reçu en DM après la fermeture du ticket. */
async function handleRating(interaction, rating, ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) {
    await interaction.update({ content: 'Ce ticket n\'existe plus.', components: [] }).catch(() => {});
    return;
  }
  if (ticket.rating) {
    await interaction.update({ content: buildRatingThanksText(ticket.language, ticket.rating), components: [] }).catch(() => {});
    return;
  }

  ticket.rating = rating;
  await ticket.save();

  await interaction.update({
    content: buildRatingThanksText(ticket.language, rating),
    components: [],
  }).catch(() => {});

  // Contexte pour le staff : la note tombe dans le salon des logs.
  const settings = await Settings.getSingleton();
  if (settings.logChannelId) {
    const logChannel = await client.channels.fetch(settings.logChannelId).catch(() => null);
    if (logChannel) {
      await logChannel.send(`⭐ Ticket #${ticket.ticketNumber} noté **${rating}/5** par ${ticket.username}.`).catch(() => {});
    }
  }
}

/** Construit un transcript .txt lisible du salon. */
async function generateTranscript(channel, ticket, category) {
  const messages = await channel.messages.fetch({ limit: 200 }).catch(() => new Map());
  const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const header = [
    `Ticket #${ticket.ticketNumber} — ${category?.name || ticket.categoryKey}`,
    `Utilisateur : ${ticket.username} (${ticket.userId})`,
    `Langue : ${ticket.language.toUpperCase()}`,
    `Créé le : ${new Date(ticket.createdAt).toLocaleString('fr-FR')}`,
    `Fermé le : ${new Date().toLocaleString('fr-FR')}`,
    ticket.claimedByTag ? `Pris en charge par : ${ticket.claimedByTag}` : 'Non pris en charge',
    '─'.repeat(60),
    '',
  ];

  if (ticket.answers?.length) {
    header.push('Réponses au formulaire :', '');
    ticket.answers.forEach((a) => {
      header.push(`Q: ${a.question}`);
      header.push(`R: ${a.answer}`);
      if (a.answerFr) header.push(`   (FR: ${a.answerFr})`);
      header.push('');
    });
    header.push('─'.repeat(60), '');
  }

  const lines = sorted.map((m) => {
    const time = new Date(m.createdTimestamp).toLocaleString('fr-FR');
    const author = m.author?.tag || 'inconnu';
    const content = m.content || '';
    const files = [...m.attachments.values()].map((a) => `  [pièce jointe] ${a.name} — ${a.url}`).join('\n');
    return `[${time}] ${author} : ${content}${files ? '\n' + files : ''}`;
  });

  const body = [...header, ...lines, '', '─'.repeat(60), 'Fin du transcript.'].join('\n');
  return Buffer.from(body, 'utf-8');
}

/** Vérifie périodiquement les tickets inactifs : rappel puis fermeture automatique. */
function startAutoCloseChecker() {
  setInterval(async () => {
    try {
      const openTickets = await Ticket.find({ status: 'open' });
      for (const ticket of openTickets) {
        const category = await Category.findById(ticket.categoryId);
        if (!category) continue;

        if (!ticket.inactivityWarnedAt) {
          // Étape 1 : rappel après `inactivityWarningMinutes` d'inactivité.
          if (!category.inactivityWarningMinutes) continue;
          const inactiveMs = Date.now() - new Date(ticket.lastActivityAt).getTime();
          if (inactiveMs > category.inactivityWarningMinutes * 60 * 1000) {
            await sendInactivityReminder(ticket, category);
          }
        } else {
          // Étape 2 : fermeture après `inactivityCloseMinutes` supplémentaires depuis le rappel.
          if (!category.inactivityCloseMinutes) continue;
          const sinceWarnMs = Date.now() - new Date(ticket.inactivityWarnedAt).getTime();
          if (sinceWarnMs > category.inactivityCloseMinutes * 60 * 1000) {
            await handleClose(null, ticket._id.toString(), { reason: 'inactivity' });
          }
        }
      }
    } catch (err) {
      console.error('[inactivityChecker] erreur :', err.message);
    }
  }, 60 * 1000); // vérification toutes les minutes (délais configurés en minutes, on veut rester précis)
}

module.exports = {
  forwardDmToChannel,
  relayStaffMessage,
  handleClaim,
  handleClose,
  handleRedirectOpen,
  handleRedirectSelect,
  handleForceRemind,
  handleRating,
  startAutoCloseChecker,
};
