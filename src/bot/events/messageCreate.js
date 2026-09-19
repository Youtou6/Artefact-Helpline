const { ChannelType } = require('discord.js');
const { handleDirectMessage } = require('../ticketFlow');
const { relayStaffMessage } = require('../ticketChannel');
const Ticket = require('../../models/Ticket');
const Category = require('../../models/Category');

module.exports = async function onMessageCreate(message) {
  if (message.author.bot) return;

  if (message.channel.type === ChannelType.DM) {
    await handleDirectMessage(message).catch((err) => console.error('[messageCreate:dm]', err));
    return;
  }

  if (message.guildId) {
    const ticket = await Ticket.findOne({ channelId: message.channelId, status: 'open' });
    if (!ticket) return;
    const category = await Category.findById(ticket.categoryId);
    await relayStaffMessage(message, ticket, category).catch((err) => console.error('[messageCreate:staff]', err));
  }
};
