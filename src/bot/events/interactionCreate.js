const { handleLanguageSelect, handleCategorySelect, handleQuestionSelect } = require('../ticketFlow');
const {
  handleClaim,
  handleClose,
  handleRedirectOpen,
  handleRedirectSelect,
  handleForceRemind,
  handleAiFollowUp,
  handleRating,
} = require('../ticketChannel');
const { handleCannedCommand, handleCannedSelect } = require('../cannedMenu');

module.exports = async function onInteractionCreate(interaction) {
  try {
    if (interaction.isButton()) {
      const [scope, action, id] = interaction.customId.split(':');

      if (scope === 'lang') return handleLanguageSelect(interaction);
      if (scope === 'ticket' && action === 'claim') return handleClaim(interaction, id);
      if (scope === 'ticket' && action === 'close') return handleClose(interaction, id, { reason: 'staff' });
      if (scope === 'ticket' && action === 'redirect') return handleRedirectOpen(interaction, id);
      if (scope === 'ticket' && action === 'remind') return handleForceRemind(interaction, id);
      if (scope === 'ticket' && action === 'ai') return handleAiFollowUp(interaction, id);
      if (scope === 'rating') return handleRating(interaction, Number(action), id);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'category:select') return handleCategorySelect(interaction);
      if (interaction.customId === 'question:select') return handleQuestionSelect(interaction);
      if (interaction.customId.startsWith('canned:select:')) return handleCannedSelect(interaction);
      if (interaction.customId.startsWith('redirect:select:')) return handleRedirectSelect(interaction);
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'canned') return handleCannedCommand(interaction);
      return;
    }
  } catch (err) {
    console.error('[interactionCreate] erreur :', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true }).catch(() => {});
    }
  }
};
