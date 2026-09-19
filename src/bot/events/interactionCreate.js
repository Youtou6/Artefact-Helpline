const { handleLanguageSelect, handleCategorySelect } = require('../ticketFlow');
const { handleClaim, handleClose } = require('../ticketChannel');
const { handleCannedCommand, handleCannedSelect } = require('../cannedMenu');

module.exports = async function onInteractionCreate(interaction) {
  try {
    if (interaction.isButton()) {
      const [scope, action, id] = interaction.customId.split(':');

      if (scope === 'lang') return handleLanguageSelect(interaction);
      if (scope === 'ticket' && action === 'claim') return handleClaim(interaction, id);
      if (scope === 'ticket' && action === 'close') return handleClose(interaction, id);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'category:select') return handleCategorySelect(interaction);
      if (interaction.customId.startsWith('canned:select:')) return handleCannedSelect(interaction);
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
