const { ChannelType, PermissionFlagsBits } = require('discord.js');
const client = require('./client');
const Settings = require('../models/Settings');
const Category = require('../models/Category');
const Ticket = require('../models/Ticket');
const Blacklist = require('../models/Blacklist');
const Counter = require('../models/Counter');
const { translateText } = require('./translate');
const flowState = require('./flowState');
const {
  buildLanguageSelectMessage,
  buildCategorySelectMessage,
  buildQuestionMessage,
  buildTicketCreatedMessage,
  buildTicketPanel,
} = require('./components');

const REMINDER_TEXT = {
  language: 'Please use the buttons above / Merci d\'utiliser les boutons ci-dessus / Bitte benutzen Sie die Schaltflächen oben.',
  fr: 'Merci d\'utiliser le menu ci-dessus pour choisir une catégorie.',
  en: 'Please use the menu above to choose a category.',
  de: 'Bitte verwenden Sie das Menü oben, um eine Kategorie auszuwählen.',
};

const BLACKLIST_TEXT =
  'You are not allowed to open a ticket. / Vous n\'êtes pas autorisé(e) à ouvrir un ticket. / ' +
  'Sie dürfen kein Ticket eröffnen.';

const COOLDOWN_TEXT = {
  en: 'You\'re creating tickets too quickly. Please wait a few minutes and try again.',
  fr: 'Vous créez des tickets trop rapidement. Merci de patienter quelques minutes avant de réessayer.',
  de: 'Sie erstellen zu schnell Tickets. Bitte warten Sie ein paar Minuten und versuchen Sie es erneut.',
};

function sanitizeForChannelName(str) {
  return (str || 'user')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'user';
}

function buildChannelName(format, username, count, categoryKey) {
  const padded = String(count).padStart(4, '0');
  return (format || '{key}-{count}')
    .replace('{user}', sanitizeForChannelName(username))
    .replace('{count}', padded)
    .replace('{key}', categoryKey)
    .slice(0, 90);
}

/** Point d'entrée pour tout message reçu en DM par le bot. */
async function handleDirectMessage(message) {
  const userId = message.author.id;

  const blacklisted = await Blacklist.findOne({ userId });
  if (blacklisted) {
    await message.channel.send(BLACKLIST_TEXT).catch(() => {});
    return;
  }

  const openTicket = await Ticket.findOne({ userId, status: 'open' });
  if (openTicket) {
    const { forwardDmToChannel } = require('./ticketChannel');
    await forwardDmToChannel(openTicket, message);
    return;
  }

  const flow = flowState.getFlow(userId);

  if (!flow) {
    const settings = await Settings.getSingleton();
    if (settings.antiSpam?.maxAttempts) {
      if (flowState.isRateLimited(userId, settings.antiSpam.windowMinutes, settings.antiSpam.maxAttempts)) {
        await message.channel.send(COOLDOWN_TEXT.en + '\n' + COOLDOWN_TEXT.fr + '\n' + COOLDOWN_TEXT.de).catch(() => {});
        return;
      }
      flowState.recordAttempt(userId);
    }
    flowState.startFlow(userId);
    const payload = buildLanguageSelectMessage(settings.branding);
    await message.channel.send(payload).catch(() => {});
    return;
  }

  if (flow.step === 'language') {
    await message.channel.send(REMINDER_TEXT.language).catch(() => {});
    return;
  }

  if (flow.step === 'category') {
    await message.channel.send(REMINDER_TEXT[flow.language] || REMINDER_TEXT.en).catch(() => {});
    return;
  }

  if (flow.step === 'questions') {
    await handleQuestionAnswer(message, flow);
    return;
  }
}

/** Interaction bouton lang:en / lang:fr / lang:de */
async function handleLanguageSelect(interaction) {
  const userId = interaction.user.id;
  const lang = interaction.customId.split(':')[1];
  const flow = flowState.getFlow(userId);

  if (!flow || flow.step !== 'language') {
    await interaction.reply('This session has expired. Please send a new message to start again.').catch(() => {});
    return;
  }

  flowState.updateFlow(userId, { language: lang, step: 'category' });

  const categories = await Category.find({ active: true }).sort('order');
  if (categories.length === 0) {
    await interaction.update({
      components: [require('./components').buildTextContainer([
        'No category is configured yet. Please contact staff directly.',
      ])],
      flags: require('./components').CV2_FLAGS,
    }).catch(() => {});
    flowState.clearFlow(userId);
    return;
  }

  const translatedNames = await Promise.all(
    categories.map((c) => (lang === 'fr' ? c.name : translateText(c.name, lang)))
  );

  const payload = buildCategorySelectMessage(categories, lang, translatedNames);
  await interaction.update(payload).catch(() => {});
}

/** Interaction select menu category:select */
async function handleCategorySelect(interaction) {
  const userId = interaction.user.id;
  const flow = flowState.getFlow(userId);

  if (!flow || flow.step !== 'category') {
    await interaction.reply('This session has expired. Please send a new message to start again.').catch(() => {});
    return;
  }

  const categoryId = interaction.values[0];
  const category = await Category.findById(categoryId);
  if (!category || !category.active) {
    await interaction.reply('This category is no longer available.').catch(() => {});
    flowState.clearFlow(userId);
    return;
  }

  flowState.updateFlow(userId, {
    categoryId,
    questions: category.questions,
    answers: [],
    index: 0,
    step: 'questions',
  });

  if (category.questions.length === 0) {
    await finalizeTicket(interaction.user, flowState.getFlow(userId), interaction);
    return;
  }

  await sendQuestion(interaction.user, flowState.getFlow(userId), interaction);
}

async function sendQuestion(user, flow, interaction = null) {
  const question = flow.questions[flow.index];
  const lang = flow.language;
  const text = lang === 'fr' ? question.text : await translateText(question.text, lang);
  const stepLabel = `${flow.index + 1}/${flow.questions.length}`;
  const payload = buildQuestionMessage(text, stepLabel);

  if (interaction) {
    await interaction.update(payload).catch(() => {});
  } else {
    const dmChannel = await user.createDM();
    await dmChannel.send(payload).catch(() => {});
  }
}

async function handleQuestionAnswer(message, flow) {
  const question = flow.questions[flow.index];
  const rawAnswer = message.content?.trim() || '(pas de texte)';

  const attachmentUrls = [...message.attachments.values()].map((a) => a.url);
  const answerWithAttachments = attachmentUrls.length
    ? `${rawAnswer}\n${attachmentUrls.join('\n')}`
    : rawAnswer;

  let answerFr = null;
  if (flow.language === 'de') {
    answerFr = await translateText(rawAnswer, 'fr');
  }

  flow.answers.push({ question: question.text, answer: answerWithAttachments, answerFr });
  flow.index += 1;

  if (flow.index < flow.questions.length) {
    await sendQuestion(message.author, flow);
  } else {
    await finalizeTicket(message.author, flow);
  }
}

async function finalizeTicket(user, flow, interaction = null) {
  const settings = await Settings.getSingleton();

  if (!settings.guildId || !settings.initialized || !settings.ticketCategoryId) {
    const errText = 'The support system is not fully configured yet. Please contact an administrator.';
    if (interaction) await interaction.update({ content: errText, components: [] }).catch(() => {});
    else await (await user.createDM()).send(errText).catch(() => {});
    flowState.clearFlow(user.id);
    return;
  }

  const guild = client.guilds.cache.get(settings.guildId);
  if (!guild) {
    flowState.clearFlow(user.id);
    return;
  }

  const category = await Category.findById(flow.categoryId);
  const seq = await Counter.next(category.key);
  const channelName = buildChannelName(category.ticketNameFormat, user.username, seq, category.key);

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
  ];
  if (category.staffRoleId) {
    overwrites.push({
      id: category.staffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: settings.ticketCategoryId,
    permissionOverwrites: overwrites,
    topic: `Ticket #${seq} • ${category.name} • ${user.tag} (${user.id})`,
  });

  const ticket = await Ticket.create({
    ticketNumber: seq,
    userId: user.id,
    username: user.tag,
    language: flow.language,
    categoryId: category._id,
    categoryKey: category.key,
    channelId: channel.id,
    answers: flow.answers,
    lastActivityAt: new Date(),
  });

  const panel = buildTicketPanel({
    ticket, category, user, claimedTag: null, closed: false, pingRoleId: category.staffRoleId,
  });
  await channel.send({ ...panel, allowedMentions: { roles: category.staffRoleId ? [category.staffRoleId] : [] } });

  const confirmPayload = buildTicketCreatedMessage(flow.language, seq);
  if (interaction) await interaction.update(confirmPayload).catch(() => {});
  else await (await user.createDM()).send(confirmPayload).catch(() => {});

  flowState.clearFlow(user.id);
}

module.exports = { handleDirectMessage, handleLanguageSelect, handleCategorySelect };
