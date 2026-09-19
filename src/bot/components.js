const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

// Flag obligatoire pour tout message utilisant les Components V2.
const CV2_FLAGS = MessageFlags.IsComponentsV2;

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
function buildQuestionMessage(questionText, stepLabel) {
  const container = buildTextContainer([`**${stepLabel}**`, questionText]);
  return { components: [container], flags: CV2_FLAGS };
}

// ─── Confirmation de création de ticket (en DM) ────────────────────────────
const TICKET_CREATED_TEXT = {
  en: (n) => `Your ticket **#${n}** has been created. Our team will reply here shortly.`,
  fr: (n) => `Votre ticket **#${n}** a été créé. Notre équipe vous répondra ici sous peu.`,
  de: (n) => `Ihr Ticket **#${n}** wurde erstellt. Unser Team wird hier in Kürze antworten.`,
};

function buildTicketCreatedMessage(lang, ticketNumber) {
  const text = (TICKET_CREATED_TEXT[lang] || TICKET_CREATED_TEXT.en)(ticketNumber);
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

  const container = buildTextContainer(lines, { withSeparators: true });

  if (!closed) {
    const row = new ActionRowBuilder().addComponents(
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
    withActionRow(container, row);
  }

  return { components: [container], flags: CV2_FLAGS };
}

module.exports = {
  CV2_FLAGS,
  buildTextContainer,
  buildLanguageSelectMessage,
  buildCategorySelectMessage,
  buildQuestionMessage,
  buildTicketCreatedMessage,
  buildTicketPanel,
};
