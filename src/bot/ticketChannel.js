const { AttachmentBuilder } = require('discord.js');
const client = require('./client');
const Settings = require('../models/Settings');
const Category = require('../models/Category');
const Ticket = require('../models/Ticket');
const { translateText } = require('./translate');
const { isStaffMember } = require('./permissions');
const { generateFollowUpAction } = require('./ai');
const {
  buildTicketPanel,
  buildTextContainer,
  buildSimpleContainerMessage,
  buildCategoryRedirectSelect,
  buildClaimNotifyMessage,
  buildRedirectNotifyMessage,
  buildInactivityReminderMessage,
  buildCloseMessage,
  buildAiQuestionMessage,
  buildRatingRequestMessage,
  buildRatingThanksMessage,
  CV2_FLAGS,
  CV2_EPHEMERAL_FLAGS,
} = require('./components');

// Garde-fou : nombre max de tours IA déclenchés automatiquement (à chaque réponse
// utilisateur) sans intervention humaine, pour éviter une boucle qui ne s'arrête jamais.
const MAX_AI_AUTO_TURNS = 8;

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

  // Si l'IA gère actuellement la conversation, elle enchaîne automatiquement.
  if (ticket.aiActive) {
    const category = await Category.findById(ticket.categoryId);
    if (category) {
      try {
        await runAiTurn(ticket, category, { isAutoLoop: true });
      } catch (err) {
        console.error('[ai:loop] erreur :', err.message);
        await channel.send(buildSimpleContainerMessage(
          `🤖 Erreur IA pendant la conversation automatique (${err.message}). Un humain devrait prendre le relais.`
        )).catch(() => {});
        ticket.aiActive = false;
        await ticket.save();
      }
    }
  }
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

  // Un humain vient de répondre : l'IA cède la main si elle était active.
  const wasAiActive = ticket.aiActive;
  ticket.aiActive = false;
  await touchTicket(ticket);

  if (wasAiActive) {
    await message.channel.send(buildSimpleContainerMessage(
      '🤖 L\'IA cède la main : un membre du staff vient de répondre.'
    )).catch(() => {});
  }
}

/** Bouton "Prendre en charge" */
async function handleClaim(interaction, ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply(buildSimpleContainerMessage('Ce ticket n\'existe plus ou est déjà fermé.', { ephemeral: true })).catch(() => {});
    return;
  }
  const category = await Category.findById(ticket.categoryId);
  if (!isStaffMember(interaction.member, category?.staffRoleId)) {
    await interaction.reply(buildSimpleContainerMessage('Tu n\'as pas la permission de faire ça.', { ephemeral: true })).catch(() => {});
    return;
  }
  if (ticket.claimedBy) {
    await interaction.reply(buildSimpleContainerMessage(`Déjà pris en charge par ${ticket.claimedByTag}.`, { ephemeral: true })).catch(() => {});
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

  if (user) {
    const dm = await user.createDM().catch(() => null);
    if (dm) await dm.send(buildClaimNotifyMessage(ticket.language, ticket.claimedByTag, category.anonymousReplies)).catch(() => {});
  }
}

/** Bouton "Rediriger" : ouvre un menu déroulant éphémère des autres catégories. */
async function handleRedirectOpen(interaction, ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply(buildSimpleContainerMessage('Ce ticket n\'existe plus ou est déjà fermé.', { ephemeral: true })).catch(() => {});
    return;
  }
  const category = await Category.findById(ticket.categoryId);
  if (!isStaffMember(interaction.member, category?.staffRoleId)) {
    await interaction.reply(buildSimpleContainerMessage('Tu n\'as pas la permission de faire ça.', { ephemeral: true })).catch(() => {});
    return;
  }

  const others = await Category.find({ active: true, _id: { $ne: ticket.categoryId } }).sort('order');
  if (others.length === 0) {
    await interaction.reply(buildSimpleContainerMessage('Aucune autre catégorie active disponible.', { ephemeral: true })).catch(() => {});
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

  if (!ticket || ticket.status !== 'open' || !newCategory) {
    await interaction.update(buildSimpleContainerMessage('Ce ticket ou cette catégorie n\'existe plus.', { ephemeral: true })).catch(() => {});
    return;
  }

  ticket.aiActive = false;
  await performRedirect(ticket, newCategory, {
    actorLabel: interaction.member?.displayName || interaction.user.username,
  });

  await interaction.update(buildSimpleContainerMessage(`✅ Ticket redirigé vers "${newCategory.name}".`, { ephemeral: true })).catch(() => {});
}

/**
 * Logique centrale de redirection, réutilisée par le bouton staff et par l'IA.
 * actorLabel = qui/quoi a décidé (nom du staff, ou "🤖 IA"). note = raison optionnelle affichée en salon.
 */
async function performRedirect(ticket, newCategory, { actorLabel = 'Staff', note = null } = {}) {
  const oldCategory = await Category.findById(ticket.categoryId);
  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  const guild = channel?.guild;

  if (channel && guild) {
    if (oldCategory?.staffRoleId && oldCategory.staffRoleId !== newCategory.staffRoleId) {
      await channel.permissionOverwrites.delete(oldCategory.staffRoleId).catch(() => {});
    }
    if (newCategory.staffRoleId) {
      await channel.permissionOverwrites.edit(newCategory.staffRoleId, {
        ViewChannel: true, SendMessages: true, AttachFiles: true,
      }).catch(() => {});
    }

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

  if (user) {
    const dm = await user.createDM().catch(() => null);
    if (dm) await dm.send(buildRedirectNotifyMessage(ticket.language, newCategory.name)).catch(() => {});
  }

  if (channel) {
    const lines = [`🔀 Ticket redirigé vers **${newCategory.name}** par ${actorLabel}.`];
    if (note) lines.push(note);
    await channel.send(buildSimpleContainerMessage(lines)).catch(() => {});

    const panel = buildTicketPanel({
      ticket, category: newCategory, user: user || { id: ticket.userId, tag: ticket.username },
      claimedTag: ticket.claimedByTag, closed: false, pingRoleId: newCategory.staffRoleId,
    });
    await channel.send({ ...panel, allowedMentions: { roles: newCategory.staffRoleId ? [newCategory.staffRoleId] : [] } }).catch(() => {});
  }
}

/** Bouton "Forcer le rappel d'inactivité" : envoie le rappel tout de suite, sans attendre le délai. */
async function handleForceRemind(interaction, ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply(buildSimpleContainerMessage('Ce ticket n\'existe plus ou est déjà fermé.', { ephemeral: true })).catch(() => {});
    return;
  }
  const category = await Category.findById(ticket.categoryId);
  if (!isStaffMember(interaction.member, category?.staffRoleId)) {
    await interaction.reply(buildSimpleContainerMessage('Tu n\'as pas la permission de faire ça.', { ephemeral: true })).catch(() => {});
    return;
  }

  await sendInactivityReminder(ticket, category);
  await interaction.reply(buildSimpleContainerMessage('⏰ Rappel d\'inactivité envoyé à l\'utilisateur.', { ephemeral: true })).catch(() => {});

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
    if (dm) await dm.send(buildInactivityReminderMessage(ticket.language)).catch(() => {});
  }

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel) {
    await channel.send(buildSimpleContainerMessage('⏰ Rappel d\'inactivité envoyé à l\'utilisateur (aucune réponse depuis un moment).')).catch(() => {});
  }

  ticket.inactivityWarnedAt = new Date();
  await ticket.save();
}

// ══════════════════════════════ ASSISTANT IA ══════════════════════════════

/** Récupère les autres catégories actives (pour que l'IA puisse choisir où rediriger). */
async function fetchOtherCategoriesForAi(category) {
  if (!category?.aiPermissions?.canRedirect) return [];
  return Category.find({ active: true, _id: { $ne: category._id } }).select('key name aiContext');
}

/** Extrait le texte lisible d'un message, y compris quand il est en Components V2 (content brut est alors vide). */
function extractMessageText(message) {
  if (message.content?.trim()) return message.content;
  if (!message.components?.length) return '';

  const out = [];
  const walk = (components) => {
    for (const c of components || []) {
      if (c.content) out.push(c.content); // TextDisplay (type 10)
      if (c.components?.length) walk(c.components); // Container (17) / Section (9)
    }
  };
  walk(message.components);
  return out.join('\n');
}

/**
 * Récupère les derniers messages du salon pour le prompt IA — filtrés pour ne
 * contenir QUE la conversation avec le client qui contacte (ses propres messages,
 * relayés par le bot, et les réponses du staff qui lui ont réellement été envoyées).
 * Tout le reste (panneau du ticket, notices de redirection/rappel/IA, pings de
 * rôle, etc.) est volontairement exclu : ce sont des informations internes au
 * serveur, pas des informations sur l'utilisateur, et elles ne partent jamais
 * vers l'API Gemini.
 */
async function fetchRecentMessagesForAi(channelId, ticket, category, limit = 16) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return { channel: null, recentMessages: [] };

  // Sur-échantillonne un peu puisqu'on va filtrer une partie des messages (notices internes).
  const fetched = await channel.messages.fetch({ limit: Math.min(limit * 3, 100) }).catch(() => new Map());
  const sorted = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const recentMessages = [];
  for (const m of sorted) {
    const text = extractMessageText(m).trim();
    if (!text) continue;

    if (m.author?.bot) {
      // Uniquement le relais d'un message DM du client (format "**Pseudo**\n...").
      const match = text.match(/^\*\*(.+?)\*\*\n([\s\S]*)$/);
      if (match && match[1] === ticket.username) {
        recentMessages.push(`Customer: ${match[2]}`);
      }
      // Tout le reste (panneau, notices IA/redirection/rappel, confirmations) est ignoré.
      continue;
    }

    // Message écrit directement par un membre du staff.
    const label = category?.anonymousReplies ? 'Staff' : (m.member?.displayName || m.author?.username || 'Staff');
    recentMessages.push(`${label}: ${text}`);
  }

  return { channel, recentMessages: recentMessages.slice(-limit) };
}

/** Envoie en DM la question/le message que l'IA a choisi, et note l'action en salon. */
async function sendAiQuestionDm(ticket, question, channel) {
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (user) {
    const dm = await user.createDM().catch(() => null);
    if (dm) await dm.send(buildAiQuestionMessage(question)).catch(() => {});
  }
  if (channel) {
    await channel.send(buildSimpleContainerMessage(`🤖 Question envoyée à l'utilisateur :\n> ${question}`)).catch(() => {});
  }
  ticket.lastActivityAt = new Date();
  ticket.inactivityWarnedAt = null;
}

/** Poste le fichier récapitulatif de l'IA dans le salon, une fois sa collecte terminée. */
async function sendAiSummaryFile(ticket, category, summaryText, channel) {
  if (!channel) return;
  const header = [
    `Résumé IA — Ticket #${ticket.ticketNumber} — ${category?.name || ticket.categoryKey}`,
    `Utilisateur Discord : ${ticket.username} (${ticket.userId})`,
    `Généré le : ${new Date().toLocaleString('fr-FR')}`,
    '─'.repeat(60),
    '',
  ];
  const body = [...header, summaryText?.trim() || '(résumé vide)'].join('\n');
  const buffer = Buffer.from(body, 'utf-8');

  await channel.send({
    ...buildSimpleContainerMessage('🤖 L\'IA a terminé sa collecte d\'informations pour ce ticket. Résumé ci-joint :'),
    files: [new AttachmentBuilder(buffer, { name: `ia-resume-ticket-${ticket.ticketNumber}.txt` })],
  }).catch(() => {});
}

/** Notifie le salon qu'un humain doit prendre le relais (ping du rôle staff si défini). */
async function notifyHumanNeeded(ticket, category, reason, channel) {
  if (!channel) return;
  const lines = [];
  if (category?.staffRoleId) lines.push(`<@&${category.staffRoleId}>`);
  lines.push(`🤖 L'IA a besoin d'un humain ici${reason ? ` : ${reason}` : '.'}`);

  await channel.send({
    ...buildSimpleContainerMessage(lines),
    allowedMentions: category?.staffRoleId ? { roles: [category.staffRoleId] } : undefined,
  }).catch(() => {});
}

/**
 * Applique le résultat retourné par Gemini et met à jour l'état "IA active" du ticket
 * en conséquence : reste active si elle pose une question, se coupe sinon (fin, humain
 * requis, ou redirection).
 */
async function applyAiResult(result, ticket, category, channel) {
  if (result.type === 'action' && result.name === 'redirect_ticket') {
    const newCategory = await Category.findOne({ key: result.args.category_key, active: true });
    ticket.aiActive = false;
    if (!newCategory) {
      await ticket.save();
      if (channel) {
        await channel.send(buildSimpleContainerMessage(
          `🤖 L'IA a proposé une redirection vers une catégorie introuvable ("${result.args.category_key}").`
        )).catch(() => {});
      }
      return 'Redirection invalide proposée par l\'IA (catégorie introuvable).';
    }
    await ticket.save();
    await performRedirect(ticket, newCategory, {
      actorLabel: '🤖 IA',
      note: result.args.reason ? `Raison donnée par l'IA : ${result.args.reason}` : null,
    });
    return `Redirigé vers "${newCategory.name}" par l'IA.${result.args.reason ? ' ' + result.args.reason : ''}`;
  }

  if (result.type === 'action' && result.name === 'finish_collection') {
    await sendAiSummaryFile(ticket, category, result.args.summary, channel);
    ticket.aiActive = false;
    await ticket.save();
    return 'Collecte terminée, résumé envoyé au staff.';
  }

  if (result.type === 'action' && result.name === 'request_human') {
    await notifyHumanNeeded(ticket, category, result.args.reason, channel);
    ticket.aiActive = false;
    await ticket.save();
    return `Un humain est nécessaire : ${result.args.reason || 'raison non précisée'}.`;
  }

  if (result.type === 'action' && result.name === 'ask_question') {
    await sendAiQuestionDm(ticket, result.args.question, channel);
    ticket.aiActive = true;
    await ticket.save();
    return `Question envoyée : ${result.args.question}`;
  }

  if (result.type === 'text') {
    // Repli : le modèle a répondu en texte libre plutôt qu'en appelant un outil.
    await sendAiQuestionDm(ticket, result.text, channel);
    ticket.aiActive = true;
    await ticket.save();
    return `Question envoyée : ${result.text}`;
  }

  ticket.aiActive = false;
  await ticket.save();
  return 'L\'IA n\'a proposé aucune action exploitable.';
}

/**
 * Un tour de l'IA : rassemble le contexte, appelle Gemini, applique le résultat.
 * isAutoLoop = true uniquement quand c'est déclenché automatiquement par une réponse
 * utilisateur pendant que l'IA est déjà active (soumis au garde-fou anti-boucle).
 * Un appel manuel (bouton) ou la toute première réponse automatique à la création
 * du ticket ne sont jamais limités.
 */
const AI_RETRY_DELAY_MS = 60 * 1000; // ~1 minute entre les tentatives
const AI_MAX_ATTEMPTS = 3; // 1 essai + 2 nouvelles tentatives avant d'abandonner

function isRetryableAiError(err) {
  if (err.code === 'missing_api_key') return false;
  if (err.code === 'api_error' && err.status) {
    // Pas la peine de réessayer une erreur de config (modèle inconnu, requête invalide...).
    return err.status === 429 || err.status >= 500;
  }
  // Réponse vide / filtrée, erreur réseau, ou statut inconnu : ça vaut le coup de réessayer.
  return true;
}

/** Appelle Gemini avec des tentatives espacées d'environ 1 minute en cas d'échec transitoire. */
async function generateWithRetry(params, { onRetry } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS; attempt++) {
    try {
      return await generateFollowUpAction(params);
    } catch (err) {
      lastErr = err;
      if (!isRetryableAiError(err) || attempt === AI_MAX_ATTEMPTS) throw err;
      if (onRetry) await onRetry(attempt, err).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, AI_RETRY_DELAY_MS));
    }
  }
  throw lastErr;
}

async function runAiTurn(ticket, category, { isAutoLoop = false } = {}) {
  const { channel, recentMessages } = await fetchRecentMessagesForAi(ticket.channelId, ticket, category);

  if (isAutoLoop && ticket.aiTurnCount >= MAX_AI_AUTO_TURNS) {
    ticket.aiActive = false;
    await ticket.save();
    await notifyHumanNeeded(ticket, category, 'limite de tours automatiques atteinte', channel);
    return 'Limite de tours IA atteinte, un humain doit prendre le relais.';
  }

  const otherCategories = await fetchOtherCategoriesForAi(category);

  ticket.aiTurnCount = (ticket.aiTurnCount || 0) + 1;
  await ticket.save();

  const result = await generateWithRetry({
    categoryName: category.name,
    categoryContext: category.aiContext,
    infoToCollect: category.aiInfoToCollect,
    discordUsername: ticket.username,
    answers: ticket.answers,
    language: ticket.language,
    recentMessages,
    permissions: category.aiPermissions,
    otherCategories,
  }, {
    onRetry: async (attempt, err) => {
      if (channel) {
        await channel.send(buildSimpleContainerMessage(
          `🤖 Petit souci technique côté IA (${err.message}). Nouvelle tentative dans environ 1 minute... (essai ${attempt + 1}/${AI_MAX_ATTEMPTS})`
        )).catch(() => {});
      }
    },
  });

  return applyAiResult(result, ticket, category, channel);
}

/** Bouton "Rappeler l'IA" : déclenché manuellement par le staff, y compris si l'IA était déjà partie. */
async function handleAiFollowUp(interaction, ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply(buildSimpleContainerMessage('Ce ticket n\'existe plus ou est déjà fermé.', { ephemeral: true })).catch(() => {});
    return;
  }
  const category = await Category.findById(ticket.categoryId);
  if (!isStaffMember(interaction.member, category?.staffRoleId)) {
    await interaction.reply(buildSimpleContainerMessage('Tu n\'as pas la permission de faire ça.', { ephemeral: true })).catch(() => {});
    return;
  }

  await interaction.deferReply({ flags: CV2_EPHEMERAL_FLAGS }).catch(() => interaction.deferReply({ ephemeral: true }).catch(() => {}));

  // Un rappel manuel repart avec un budget de tours frais.
  ticket.aiTurnCount = 0;

  try {
    const summary = await runAiTurn(ticket, category, { isAutoLoop: false });
    await interaction.editReply(buildSimpleContainerMessage(`✅ ${summary}`)).catch(() => {});
  } catch (err) {
    console.error('[ai] erreur :', err.message);
    let msg = `❌ Erreur IA : ${err.message}`;
    if (err.code === 'missing_api_key') {
      msg = '❌ Aucune clé Gemini configurée. Ajoute GEMINI_API_KEY dans les variables d\'environnement (voir README).';
    }
    await interaction.editReply(buildSimpleContainerMessage(msg)).catch(() => {});
  }
}

/**
 * "L'IA répond en premier" : déclenché automatiquement juste après la création
 * du ticket si la catégorie a `aiAutoRespond` activé. Aucune interaction Discord
 * ici (ce n'est pas un clic de bouton), donc pas de reply/deferReply.
 */
async function triggerAiAutoRespond(ticket, category) {
  if (!category?.aiAutoRespond) return;

  try {
    await runAiTurn(ticket, category, { isAutoLoop: false });
  } catch (err) {
    console.error('[ai:auto] erreur :', err.message);
    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (channel) {
      await channel.send(buildSimpleContainerMessage(
        `🤖 L'IA n'a pas pu répondre automatiquement (${err.message}).`
      )).catch(() => {});
    }
  }
}

// ═══════════════════════════ FIN ASSISTANT IA ═════════════════════════════

/** Bouton "Fermer le ticket" ou fermeture automatique (reason = 'staff' | 'inactivity'). */
async function handleClose(interaction, ticketId, { reason = 'staff' } = {}) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket || ticket.status !== 'open') {
    if (interaction) await interaction.reply(buildSimpleContainerMessage('Ce ticket est déjà fermé.', { ephemeral: true })).catch(() => {});
    return;
  }

  const category = await Category.findById(ticket.categoryId);
  const auto = reason !== 'staff';

  if (interaction && !auto) {
    if (!isStaffMember(interaction.member, category?.staffRoleId)) {
      await interaction.reply(buildSimpleContainerMessage('Tu n\'as pas la permission de faire ça.', { ephemeral: true })).catch(() => {});
      return;
    }
    await interaction.deferUpdate().catch(() => {});
  }

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  const settings = await Settings.getSingleton();

  // Transcript .txt dans le salon des logs
  let transcriptPosted = false;
  if (channel) {
    if (!settings.logChannelId) {
      console.error(`[transcript] Ticket #${ticket.ticketNumber} : aucun logChannelId configuré (Settings.logChannelId est vide). Le salon ne sera pas supprimé.`);
    } else {
      const logChannel = await client.channels.fetch(settings.logChannelId).catch((err) => {
        console.error(`[transcript] Ticket #${ticket.ticketNumber} : impossible de récupérer le salon de logs (${settings.logChannelId}) :`, err.message);
        return null;
      });

      if (!logChannel) {
        console.error(`[transcript] Ticket #${ticket.ticketNumber} : salon de logs introuvable (supprimé sur Discord, ou ID obsolète après un changement de serveur). Re-clique sur "Initialiser sur ce serveur" dans le dashboard.`);
      } else {
        const transcript = await generateTranscript(channel, ticket, category);
        const summary = buildTextContainer([
          `**Ticket #${ticket.ticketNumber} fermé — ${category?.name || ticket.categoryKey}**`,
          `👤 ${ticket.username} (\`${ticket.userId}\`)\n🌐 ${ticket.language.toUpperCase()}\n` +
            `${ticket.claimedByTag ? `🙋 Pris en charge par ${ticket.claimedByTag}\n` : ''}` +
            `🔒 Fermé par ${auto ? `fermeture automatique (${reason})` : (interaction?.member?.displayName || 'staff')}`,
        ]);
        try {
          const logMessage = await logChannel.send({
            components: [summary],
            flags: CV2_FLAGS,
            files: [new AttachmentBuilder(transcript, { name: `ticket-${ticket.ticketNumber}.txt` })],
          });
          ticket.transcriptUrl = `https://discord.com/channels/${channel.guild.id}/${logChannel.id}/${logMessage.id}`;
          transcriptPosted = true;
        } catch (err) {
          console.error(
            `[transcript] Ticket #${ticket.ticketNumber} : échec de l'envoi dans le salon de logs — ` +
            `très probablement un problème de permissions du bot sur ce salon. Re-clique sur ` +
            `"Initialiser sur ce serveur" dans le dashboard pour les réparer. Détail :`, err.message
          );
        }
      }
    }
  }

  // DM de fermeture + contexte
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (user) {
    const dm = await user.createDM().catch(() => null);
    if (dm) await dm.send(buildCloseMessage(ticket.language, auto ? 'inactivity' : 'staff')).catch(() => {});
  }

  ticket.status = 'closed';
  ticket.aiActive = false;
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
    if (transcriptPosted) {
      setTimeout(() => channel.delete().catch(() => {}), 3000);
    } else {
      // On ne perd jamais la conversation en silence : si le transcript n'a pas pu être
      // archivé, le salon reste en place (juste renommé) jusqu'à ce que ce soit corrigé.
      await channel.send(buildSimpleContainerMessage(
        '⚠️ Ce ticket est fermé côté utilisateur, mais le transcript n\'a pas pu être envoyé dans le salon ' +
        'de logs (permissions ou configuration à vérifier). Ce salon n\'a donc PAS été supprimé automatiquement, ' +
        'pour ne pas perdre la conversation. Vérifie la configuration dans le dashboard (Paramètres → ' +
        '"Initialiser sur ce serveur"), puis supprime ce salon manuellement une fois le transcript récupéré.'
      )).catch(() => {});
      await channel.setName(`⚠️-${channel.name}`.slice(0, 90)).catch(() => {});
    }
  }
}

/** Bouton de notation ⭐ reçu en DM après la fermeture du ticket. */
async function handleRating(interaction, rating, ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) {
    await interaction.update(buildSimpleContainerMessage('Ce ticket n\'existe plus.')).catch(() => {});
    return;
  }
  if (ticket.rating) {
    await interaction.update(buildRatingThanksMessage(ticket.language, ticket.rating)).catch(() => {});
    return;
  }

  ticket.rating = rating;
  await ticket.save();

  await interaction.update(buildRatingThanksMessage(ticket.language, rating)).catch(() => {});

  const settings = await Settings.getSingleton();
  if (settings.logChannelId) {
    const logChannel = await client.channels.fetch(settings.logChannelId).catch(() => null);
    if (logChannel) {
      await logChannel.send(buildSimpleContainerMessage(
        `⭐ Ticket #${ticket.ticketNumber} noté **${rating}/5** par ${ticket.username}.`
      )).catch(() => {});
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
    const content = extractMessageText(m) || '(message sans texte)';
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
          if (!category.inactivityWarningMinutes) continue;
          const inactiveMs = Date.now() - new Date(ticket.lastActivityAt).getTime();
          if (inactiveMs > category.inactivityWarningMinutes * 60 * 1000) {
            await sendInactivityReminder(ticket, category);
          }
        } else {
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
  }, 60 * 1000);
}

module.exports = {
  forwardDmToChannel,
  relayStaffMessage,
  handleClaim,
  handleClose,
  handleRedirectOpen,
  handleRedirectSelect,
  handleForceRemind,
  handleAiFollowUp,
  triggerAiAutoRespond,
  handleRating,
  startAutoCloseChecker,
};
