const { AttachmentBuilder } = require('discord.js');
const client = require('./client');
const Settings = require('../models/Settings');
const Category = require('../models/Category');
const Ticket = require('../models/Ticket');
const { translateText } = require('./translate');
const { isStaffMember } = require('./permissions');
const { buildTicketPanel, buildTextContainer, CV2_FLAGS } = require('./components');

const CLOSE_TEXT = {
  en: 'This ticket has been closed. Feel free to DM us again if you need anything else.',
  fr: 'Ce ticket a été fermé. N\'hésitez pas à nous recontacter en DM si besoin.',
  de: 'Dieses Ticket wurde geschlossen. Kontaktieren Sie uns gerne erneut per DM, falls Sie weitere Hilfe benötigen.',
};

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
  ticket.lastActivityAt = new Date();
  await ticket.save();
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

  ticket.lastActivityAt = new Date();
  await ticket.save();
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
}

/** Bouton "Fermer le ticket" ou fermeture automatique (auto = true). */
async function handleClose(interaction, ticketId, { auto = false } = {}) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket || ticket.status !== 'open') {
    if (interaction) await interaction.reply({ content: 'Ce ticket est déjà fermé.', ephemeral: true }).catch(() => {});
    return;
  }

  const category = await Category.findById(ticket.categoryId);

  if (interaction && !auto) {
    if (!isStaffMember(interaction.member, category?.staffRoleId)) {
      await interaction.reply({ content: 'Tu n\'as pas la permission de faire ça.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferUpdate().catch(() => {});
  }

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  const settings = await Settings.getSingleton();

  // Transcript
  if (channel && settings.logChannelId) {
    const transcript = await generateTranscript(channel, ticket, category);
    const logChannel = await client.channels.fetch(settings.logChannelId).catch(() => null);
    if (logChannel) {
      const summary = buildTextContainer([
        `**Ticket #${ticket.ticketNumber} fermé — ${category?.name || ticket.categoryKey}**`,
        `👤 ${ticket.username} (\`${ticket.userId}\`)\n🌐 ${ticket.language.toUpperCase()}\n` +
          `${ticket.claimedByTag ? `🙋 Pris en charge par ${ticket.claimedByTag}\n` : ''}` +
          `🔒 Fermé par ${auto ? 'fermeture automatique (inactivité)' : (interaction?.member?.displayName || 'staff')}`,
      ]);
      await logChannel.send({
        components: [summary],
        flags: CV2_FLAGS,
        files: [new AttachmentBuilder(transcript, { name: `ticket-${ticket.ticketNumber}.html` })],
      }).catch(() => {});
    }
  }

  // DM de fermeture
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (user) {
    const dm = await user.createDM().catch(() => null);
    if (dm) await dm.send(CLOSE_TEXT[ticket.language] || CLOSE_TEXT.en).catch(() => {});
  }

  ticket.status = 'closed';
  ticket.closedAt = new Date();
  ticket.closedBy = auto ? 'auto' : (interaction?.user?.id || 'unknown');
  await ticket.save();

  if (channel) {
    setTimeout(() => channel.delete().catch(() => {}), 3000);
  }
}

/** Construit un transcript HTML basique et lisible du salon. */
async function generateTranscript(channel, ticket, category) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => new Map());
  const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const rows = sorted.map((m) => {
    const author = m.author?.tag || 'inconnu';
    const time = new Date(m.createdTimestamp).toLocaleString('fr-FR');
    const content = (m.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const files = [...m.attachments.values()].map((a) => `<div><a href="${a.url}">${a.name}</a></div>`).join('');
    return `<div class="msg"><span class="meta">${time} — <strong>${author}</strong></span><div class="content">${content}</div>${files}</div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Transcript ticket #${ticket.ticketNumber}</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; background:#0f172a; color:#e2e8f0; padding:24px; }
  h1 { font-size:18px; border-bottom:1px solid #334155; padding-bottom:12px; }
  .msg { padding:10px 0; border-bottom:1px solid #1e293b; }
  .meta { color:#94a3b8; font-size:12px; }
  .content { margin-top:4px; white-space:pre-wrap; }
  a { color:#60a5fa; }
</style></head>
<body>
  <h1>Ticket #${ticket.ticketNumber} — ${category?.name || ticket.categoryKey} — ${ticket.username}</h1>
  ${rows || '<p>Aucun message.</p>'}
</body></html>`;

  return Buffer.from(html, 'utf-8');
}

/** Vérifie périodiquement les tickets inactifs à fermer automatiquement. */
function startAutoCloseChecker() {
  setInterval(async () => {
    try {
      const openTickets = await Ticket.find({ status: 'open' });
      for (const ticket of openTickets) {
        const category = await Category.findById(ticket.categoryId);
        if (!category?.autoCloseMinutes) continue;
        const inactiveMs = Date.now() - new Date(ticket.lastActivityAt).getTime();
        if (inactiveMs > category.autoCloseMinutes * 60 * 1000) {
          await handleClose(null, ticket._id.toString(), { auto: true });
        }
      }
    } catch (err) {
      console.error('[autoClose] erreur :', err.message);
    }
  }, 5 * 60 * 1000); // vérification toutes les 5 minutes
}

module.exports = { forwardDmToChannel, relayStaffMessage, handleClaim, handleClose, startAutoCloseChecker };
