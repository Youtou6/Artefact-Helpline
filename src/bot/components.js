const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  FileBuilder,
  MessageFlags,
} = require('discord.js');

// Flags obligatoires pour tout message utilisant les Components V2.
const CV2_FLAGS = MessageFlags.IsComponentsV2;
const CV2_EPHEMERAL_FLAGS = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

/**
 * Construit un container "brut" (aucun setAccentColor => pas de bande de couleur
 * sur le côté gauche, comme demandé), à partir d'une liste de blocs de texte.
 * Chaque entrée de `blocks` devient un TextDisplay séparé par un séparateur fin.
 */
function buildTextContainer(blocks, { withSeparators = false } = {}) {
  const container = new ContainerBuilder();
  blocks.forEach((block, i) => {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
    if (withSeparators && i < blocks.length - 1) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
      );
    }
  });
  return container;
}

function withActionRow(container, actionRow) {
  container.addActionRowComponents(actionRow);
  return container;
}

/** Wrapper générique : un simple message texte propre, en container, sans bouton. */
function buildSimpleContainerMessage(textOrLines, { ephemeral = false } = {}) {
  const lines = Array.isArray(textOrLines) ? textOrLines : [textOrLines];
  return { components: [buildTextContainer(lines)], flags: ephemeral ? CV2_EPHEMERAL_FLAGS : CV2_FLAGS };
}

/**
 * Un container texte + un fichier joint, correctement RÉFÉRENCÉ par un composant
 * File (obligatoire en Components V2 : sans ça, le fichier est bien uploadé mais
 * n'apparaît nulle part dans le message). `filename` doit être EXACTEMENT le même
 * nom que celui donné à l'AttachmentBuilder passé dans `files:` au moment de l'envoi.
 */
function buildFileMessage(textOrLines, filename, { ephemeral = false } = {}) {
  const lines = Array.isArray(textOrLines) ? textOrLines : [textOrLines];
  const container = buildTextContainer(lines);
  container.addFileComponents(new FileBuilder().setURL(`attachment://${filename}`));
  return { components: [container], flags: ephemeral ? CV2_EPHEMERAL_FLAGS : CV2_FLAGS };
}

// ─── Sélection de la langue ────────────────────────────────────────────────
function buildLanguageSelectMessage(branding) {
  const header = `**${branding?.serverName || 'Roblox Build Services'} — Support**`;
  const intro =
    'Please select your language / Veuillez choisir votre langue / ' +
    'Bitte wählen Sie Ihre Sprache';

  const container = buildTextContainer([header, intro]);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lang:en').setLabel('English').setStyle(ButtonStyle.Secondary).setEmoji('🇬🇧'),
    new ButtonBuilder().setCustomId('lang:fr').setLabel('Français').setStyle(ButtonStyle.Secondary).setEmoji('🇫🇷'),
    new ButtonBuilder().setCustomId('lang:de').setLabel('Deutsch').setStyle(ButtonStyle.Secondary).setEmoji('🇩🇪')
  );
  withActionRow(container, row);

  return { components: [container], flags: CV2_FLAGS };
}

// ─── Sélection de la catégorie ─────────────────────────────────────────────
const CATEGORY_PROMPT = {
  en: 'What can we help you with? Choose a category below.',
  fr: 'En quoi pouvons-nous vous aider ? Choisissez une catégorie ci-dessous.',
  de: 'Womit können wir Ihnen helfen? Wählen Sie unten eine Kategorie aus.',
};

function buildCategorySelectMessage(categories, lang, translatedNames) {
  const container = buildTextContainer([CATEGORY_PROMPT[lang] || CATEGORY_PROMPT.en]);

  const select = new StringSelectMenuBuilder()
    .setCustomId('category:select')
    .setPlaceholder(lang === 'fr' ? 'Choisir une catégorie' : lang === 'de' ? 'Kategorie wählen' : 'Choose a category')
    .addOptions(
      categories.map((cat, i) => ({
        label: (translatedNames[i] || cat.name).slice(0, 100),
        value: cat._id.toString(),
        emoji: cat.emoji || undefined,
      }))
    );

  const row = new ActionRowBuilder().addComponents(select);
  withActionRow(container, row);

  return { components: [container], flags: CV2_FLAGS };
}

// ─── Question de collecte (une par une) ────────────────────────────────────
const FILE_HINT = {
  en: '📎 Please attach a file to your reply to answer this question.',
  fr: '📎 Merci de joindre un fichier à ta réponse pour répondre à cette question.',
  de: '📎 Bitte fügen Sie Ihrer Antwort eine Datei bei, um diese Frage zu beantworten.',
};
const SELECT_PLACEHOLDER = { en: 'Choose an option', fr: 'Choisir une option', de: 'Option auswählen' };

/** question = { text, type, options } déjà traduits dans la langue de l'utilisateur */
function buildQuestionMessage({ text, stepLabel, lang, type = 'text', options = [] }) {
  const lines = [`**${stepLabel}**`, text];
  if (type === 'file') lines.push(FILE_HINT[lang] || FILE_HINT.en);

  const container = buildTextContainer(lines);

  if (type === 'select' && options.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('question:select')
      .setPlaceholder(SELECT_PLACEHOLDER[lang] || SELECT_PLACEHOLDER.en)
      .addOptions(options.map((opt, i) => ({ label: opt.slice(0, 100), value: String(i) })));
    withActionRow(container, new ActionRowBuilder().addComponents(select));
  }

  return { components: [container], flags: CV2_FLAGS };
}

// ─── Confirmation de création de ticket (en DM) ────────────────────────────
const TICKET_CREATED_TEXT = {
  en: (n, cat) => `✅ Your ticket **#${n}** (${cat}) has been created. Our team has been notified and will reply here shortly. You'll be kept updated in this DM as things happen (claimed, moved, closed...).`,
  fr: (n, cat) => `✅ Votre ticket **#${n}** (${cat}) a été créé. Notre équipe a été notifiée et vous répondra ici sous peu. Vous serez tenu(e) informé(e) dans ce DM à chaque étape (prise en charge, changement de catégorie, fermeture...).`,
  de: (n, cat) => `✅ Ihr Ticket **#${n}** (${cat}) wurde erstellt. Unser Team wurde benachrichtigt und wird hier in Kürze antworten. Sie werden in diesem DM über jeden Schritt informiert (Übernahme, Verschiebung, Schließung...).`,
};

function buildTicketCreatedMessage(lang, ticketNumber, categoryName) {
  const text = (TICKET_CREATED_TEXT[lang] || TICKET_CREATED_TEXT.en)(ticketNumber, categoryName);
  return { components: [buildTextContainer([text])], flags: CV2_FLAGS };
}

// ─── Panneau du ticket côté staff ───────────────────────────────────────────
function buildTicketPanel({ ticket, category, user, claimedTag, closed, pingRoleId }) {
  const lines = [];
  if (pingRoleId && !closed) lines.push(`<@&${pingRoleId}>`);
  lines.push(`**Ticket #${ticket.ticketNumber} — ${category.name}**`);
  lines.push(
    `👤 <@${user.id}> (\`${user.tag}\` · \`${user.id}\`)\n🌐 Langue : \`${ticket.language.toUpperCase()}\``
  );

  if (ticket.answers?.length) {
    const qa = ticket.answers
      .map((a) => {
        let block = `**${a.question}**\n${a.answer}`;
        if (a.answerFr) block += `\n> 🇫🇷 *${a.answerFr}*`;
        return block;
      })
      .join('\n\n');
    lines.push(qa);
  }

  lines.push(claimedTag ? `🟡 Pris en charge par **${claimedTag}**` : '⚪ Non pris en charge');

  if (!closed && ticket.aiActive) {
    lines.push('🤖 L\'IA gère actuellement cette conversation (elle répondra tant qu\'un humain n\'intervient pas ou qu\'elle n\'a pas terminé).');
  }

  if (!closed && ticket.inactivityWarnedAt) {
    lines.push(`🔔 Rappel d'inactivité envoyé <t:${Math.floor(new Date(ticket.inactivityWarnedAt).getTime() / 1000)}:R>`);
  }

  const container = buildTextContainer(lines, { withSeparators: true });

  if (!closed) {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:claim:${ticket._id}`)
        .setLabel('Prendre en charge')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🙋')
        .setDisabled(!!claimedTag),
      new ButtonBuilder()
        .setCustomId(`ticket:close:${ticket._id}`)
        .setLabel('Fermer le ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒')
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:redirect:${ticket._id}`)
        .setLabel('Rediriger')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔀'),
      new ButtonBuilder()
        .setCustomId(`ticket:remind:${ticket._id}`)
        .setLabel('Forcer le rappel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏰'),
      new ButtonBuilder()
        .setCustomId(`ticket:ai:${ticket._id}`)
        .setLabel('Rappeler l\'IA')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🤖')
    );
    withActionRow(container, row1);
    withActionRow(container, row2);
  }

  return { components: [container], flags: CV2_FLAGS };
}

// ─── Menu de redirection vers une autre catégorie (ephemeral, côté staff) ──
function buildCategoryRedirectSelect(categories, ticketId) {
  const container = buildTextContainer(['Rediriger ce ticket vers :']);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`redirect:select:${ticketId}`)
    .setPlaceholder('Choisir la nouvelle catégorie')
    .addOptions(categories.map((c) => ({
      label: c.name.slice(0, 100),
      value: c._id.toString(),
      emoji: c.emoji || undefined,
    })));
  withActionRow(container, new ActionRowBuilder().addComponents(select));
  return { components: [container], flags: CV2_EPHEMERAL_FLAGS };
}

// ─── Notifications DM ───────────────────────────────────────────────────────
const CLAIM_NOTIFY_TEXT = {
  en: (tag) => `🙋 Your ticket has been picked up by **${tag}**. They'll be assisting you from now on.`,
  fr: (tag) => `🙋 Votre ticket a été pris en charge par **${tag}**. Cette personne va vous accompagner à partir de maintenant.`,
  de: (tag) => `🙋 Ihr Ticket wurde von **${tag}** übernommen. Diese Person wird Sie ab jetzt betreuen.`,
};
const CLAIM_NOTIFY_TEXT_ANON = {
  en: '🙋 Your ticket has been picked up by our team. Someone will be assisting you from now on.',
  fr: '🙋 Votre ticket a été pris en charge par notre équipe. Une personne va vous accompagner à partir de maintenant.',
  de: '🙋 Ihr Ticket wurde von unserem Team übernommen. Jemand wird Sie ab jetzt betreuen.',
};

function buildClaimNotifyMessage(lang, staffTag, anonymous) {
  const text = anonymous ? (CLAIM_NOTIFY_TEXT_ANON[lang] || CLAIM_NOTIFY_TEXT_ANON.en) : (CLAIM_NOTIFY_TEXT[lang] || CLAIM_NOTIFY_TEXT.en)(staffTag);
  return buildSimpleContainerMessage(text);
}

const REDIRECT_NOTIFY_TEXT = {
  en: (cat) => `🔀 Your ticket has been moved to a different category: **${cat}**. A staff member from that team will take it from here.`,
  fr: (cat) => `🔀 Votre ticket a été redirigé vers une autre catégorie : **${cat}**. Un membre de cette équipe va prendre le relais.`,
  de: (cat) => `🔀 Ihr Ticket wurde in eine andere Kategorie verschoben: **${cat}**. Ein Mitarbeiter dieses Teams wird sich nun darum kümmern.`,
};
function buildRedirectNotifyMessage(lang, newCategoryName) {
  const text = (REDIRECT_NOTIFY_TEXT[lang] || REDIRECT_NOTIFY_TEXT.en)(newCategoryName);
  return buildSimpleContainerMessage(text);
}

const INACTIVITY_REMINDER_TEXT = {
  en: 'We haven\'t heard from you in a while 👋 Is there anything else we can help you with? This ticket will be closed automatically if there\'s no reply.',
  fr: 'Nous n\'avons plus de nouvelles depuis un moment 👋 Avez-vous encore besoin d\'aide ? Ce ticket sera fermé automatiquement en l\'absence de réponse.',
  de: 'Wir haben schon länger nichts mehr von Ihnen gehört 👋 Benötigen Sie noch Hilfe? Dieses Ticket wird automatisch geschlossen, wenn keine Antwort erfolgt.',
};
function buildInactivityReminderMessage(lang) {
  return buildSimpleContainerMessage(INACTIVITY_REMINDER_TEXT[lang] || INACTIVITY_REMINDER_TEXT.en);
}

const CLOSE_TEXT = {
  en: {
    staff: 'This ticket has been closed. Feel free to DM us again if you need anything else.',
    inactivity: 'This ticket has been closed automatically due to inactivity. Feel free to DM us again anytime.',
  },
  fr: {
    staff: 'Ce ticket a été fermé. N\'hésitez pas à nous recontacter en DM si besoin.',
    inactivity: 'Ce ticket a été fermé automatiquement en raison de l\'inactivité. N\'hésitez pas à nous recontacter en DM quand vous voulez.',
  },
  de: {
    staff: 'Dieses Ticket wurde geschlossen. Kontaktieren Sie uns gerne erneut per DM, falls Sie weitere Hilfe benötigen.',
    inactivity: 'Dieses Ticket wurde automatisch wegen Inaktivität geschlossen. Kontaktieren Sie uns gerne jederzeit erneut per DM.',
  },
};
function buildCloseMessage(lang, reason = 'staff') {
  const dict = CLOSE_TEXT[lang] || CLOSE_TEXT.en;
  return buildSimpleContainerMessage(dict[reason] || dict.staff);
}

// ─── Question posée par l'IA (DM) ───────────────────────────────────────────
function buildAiQuestionMessage(questionText) {
  return buildSimpleContainerMessage(`🤖 ${questionText}`);
}

// ─── Notation post-ticket ───────────────────────────────────────────────────
const RATING_PROMPT_TEXT = {
  en: 'Before you go — how would you rate the support you received?',
  fr: 'Avant de vous quitter — comment évalueriez-vous le support reçu ?',
  de: 'Bevor Sie gehen — wie würden Sie den erhaltenen Support bewerten?',
};

function buildRatingRequestMessage(lang, ticketId) {
  const container = buildTextContainer([RATING_PROMPT_TEXT[lang] || RATING_PROMPT_TEXT.en]);
  const row = new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map((n) =>
      new ButtonBuilder()
        .setCustomId(`rating:${n}:${ticketId}`)
        .setLabel('⭐'.repeat(n))
        .setStyle(ButtonStyle.Secondary)
    )
  );
  withActionRow(container, row);
  return { components: [container], flags: CV2_FLAGS };
}

const RATING_THANKS_TEXT = {
  en: (n) => `Thanks for your feedback! You rated us ${'⭐'.repeat(n)}.`,
  fr: (n) => `Merci pour votre retour ! Vous nous avez noté ${'⭐'.repeat(n)}.`,
  de: (n) => `Danke für Ihr Feedback! Sie haben uns mit ${'⭐'.repeat(n)} bewertet.`,
};
function buildRatingThanksMessage(lang, rating) {
  const text = (RATING_THANKS_TEXT[lang] || RATING_THANKS_TEXT.en)(rating);
  return buildSimpleContainerMessage(text);
}

module.exports = {
  CV2_FLAGS,
  CV2_EPHEMERAL_FLAGS,
  buildTextContainer,
  buildSimpleContainerMessage,
  buildFileMessage,
  buildLanguageSelectMessage,
  buildCategorySelectMessage,
  buildQuestionMessage,
  buildTicketCreatedMessage,
  buildTicketPanel,
  buildCategoryRedirectSelect,
  buildClaimNotifyMessage,
  buildRedirectNotifyMessage,
  buildInactivityReminderMessage,
  buildCloseMessage,
  buildAiQuestionMessage,
  buildRatingRequestMessage,
  buildRatingThanksMessage,
};
