const client = require('./client');
const { discord } = require('../config/env');

const onReady = require('./events/ready');
const onMessageCreate = require('./events/messageCreate');
const onInteractionCreate = require('./events/interactionCreate');

client.once('clientReady', () => onReady(client));
client.on('messageCreate', onMessageCreate);
client.on('interactionCreate', onInteractionCreate);

client.on('error', (err) => console.error('[bot] erreur client :', err));

async function startBot() {
  await client.login(discord.token);
  return client;
}

module.exports = { startBot, client };
