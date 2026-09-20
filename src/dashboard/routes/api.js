const express = require('express');
const { client } = require('../../bot/index');
const { initializeGuild } = require('../../bot/setup');
const Settings = require('../../models/Settings');
const Category = require('../../models/Category');
const CannedResponse = require('../../models/CannedResponse');
const Blacklist = require('../../models/Blacklist');
const Ticket = require('../../models/Ticket');

const router = express.Router();

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Serveurs Discord disponibles (le bot doit y être invité) ─────────────
router.get('/guilds', (req, res) => {
  const guilds = [...client.guilds.cache.values()].map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.iconURL({ size: 64 }),
    memberCount: g.memberCount,
  }));
  res.json(guilds);
});

router.get('/guilds/:id/roles', (req, res) => {
  const guild = client.guilds.cache.get(req.params.id);
  if (!guild) return res.status(404).json({ error: 'guild_not_found_or_bot_absent' });
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id) // exclut @everyone
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }));
  res.json(roles);
});

// ─── Settings ───────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  const settings = await Settings.getSingleton();
  const guild = settings.guildId ? client.guilds.cache.get(settings.guildId) : null;
  res.json({
    ...settings.toObject(),
    guildName: guild?.name || null,
    guildFound: !!guild,
    botInviteUrl: `https://discord.com/api/oauth2/authorize?client_id=${client.user?.id || ''}&permissions=402672720&scope=bot%20applications.commands`,
  });
});

router.patch('/settings', async (req, res) => {
  const settings = await Settings.getSingleton();
  const { guildId, adminIds, branding, antiSpam } = req.body;

  if (typeof guildId === 'string' && guildId !== settings.guildId) {
    settings.guildId = guildId || null;
    settings.ticketCategoryId = null;
    settings.logChannelId = null;
    settings.initialized = false;
  }

  if (Array.isArray(adminIds)) settings.adminIds = adminIds.map((s) => s.trim()).filter(Boolean);
  if (branding && typeof branding === 'object') {
    settings.branding = { ...settings.branding.toObject?.() ?? settings.branding, ...branding };
  }
  if (antiSpam && typeof antiSpam === 'object') {
    settings.antiSpam = { ...settings.antiSpam.toObject?.() ?? settings.antiSpam, ...antiSpam };
  }

  await settings.save();
  res.json(settings);
});

router.post('/settings/initialize', async (req, res) => {
  const settings = await Settings.getSingleton();
  if (!settings.guildId) return res.status(400).json({ error: 'no_guild_configured' });
  try {
    const result = await initializeGuild(settings.guildId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Catégories ─────────────────────────────────────────────────────────
router.get('/categories', async (req, res) => {
  const categories = await Category.find().sort('order');
  res.json(categories);
});

router.post('/categories', async (req, res) => {
  try {
    const { name, emoji, staffRoleId, ticketNameFormat, anonymousReplies, inactivityWarningMinutes, inactivityCloseMinutes, order, aiContext } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name_required' });

    let key = slugify(name);
    if (!key) key = `cat-${Date.now()}`;
    let uniqueKey = key;
    let i = 1;
    while (await Category.findOne({ key: uniqueKey })) {
      uniqueKey = `${key}-${i++}`;
    }

    const category = await Category.create({
      key: uniqueKey,
      name: name.trim(),
      emoji: emoji || '📁',
      staffRoleId: staffRoleId || null,
      ticketNameFormat: ticketNameFormat || '{key}-{count}',
      anonymousReplies: !!anonymousReplies,
      inactivityWarningMinutes: Number(inactivityWarningMinutes) || 0,
      inactivityCloseMinutes: Number(inactivityCloseMinutes) || 0,
      order: Number(order) || 0,
      aiContext: aiContext || '',
      questions: [],
    });
    res.status(201).json(category);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/categories/:id', async (req, res) => {
  try {
    const allowed = ['name', 'emoji', 'staffRoleId', 'ticketNameFormat', 'anonymousReplies', 'inactivityWarningMinutes', 'inactivityCloseMinutes', 'order', 'active', 'questions', 'aiContext', 'aiInfoToCollect', 'aiAutoRespond', 'aiPermissions'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (update.questions) {
      // Assigne un id stable à toute nouvelle question qui n'en a pas encore, et nettoie le type/options.
      update.questions = update.questions.map((q, i) => ({
        id: q.id || `q_${Date.now()}_${i}`,
        type: ['text', 'select', 'file'].includes(q.type) ? q.type : 'text',
        text: q.text,
        options: q.type === 'select' ? (Array.isArray(q.options) ? q.options.filter(Boolean) : []) : [],
      }));
    }
    const category = await Category.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!category) return res.status(404).json({ error: 'not_found' });

    // Si un rôle staff est défini, s'assure qu'il peut voir le salon de logs
    // (sinon le staff ne verrait jamais les transcripts, même si le bot les poste bien).
    if (category.staffRoleId) {
      const settings = await Settings.getSingleton();
      if (settings.guildId && settings.logChannelId) {
        const guild = client.guilds.cache.get(settings.guildId);
        const logChannel = guild ? await guild.channels.fetch(settings.logChannelId).catch(() => null) : null;
        if (logChannel) {
          await logChannel.permissionOverwrites.edit(category.staffRoleId, {
            ViewChannel: true, ReadMessageHistory: true,
          }).catch(() => {});
        }
      }
    }

    res.json(category);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/categories/:id', async (req, res) => {
  await Category.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ─── Réponses prédéfinies ───────────────────────────────────────────────
router.get('/canned', async (req, res) => {
  const responses = await CannedResponse.find().sort('label');
  res.json(responses);
});

router.post('/canned', async (req, res) => {
  try {
    const { categoryId, label, content } = req.body;
    if (!label || !content) return res.status(400).json({ error: 'label_and_content_required' });
    const created = await CannedResponse.create({ categoryId: categoryId || null, label, content });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/canned/:id', async (req, res) => {
  const { categoryId, label, content } = req.body;
  const update = {};
  if (categoryId !== undefined) update.categoryId = categoryId || null;
  if (label !== undefined) update.label = label;
  if (content !== undefined) update.content = content;
  const updated = await CannedResponse.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json(updated);
});

router.delete('/canned/:id', async (req, res) => {
  await CannedResponse.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ─── Blacklist ──────────────────────────────────────────────────────────
router.get('/blacklist', async (req, res) => {
  const entries = await Blacklist.find().sort('-createdAt');
  res.json(entries);
});

router.post('/blacklist', async (req, res) => {
  try {
    const { userId, username, reason } = req.body;
    if (!userId || !/^\d{15,25}$/.test(userId.trim())) {
      return res.status(400).json({ error: 'invalid_user_id' });
    }
    const entry = await Blacklist.findOneAndUpdate(
      { userId: userId.trim() },
      { userId: userId.trim(), username: username || '', reason: reason || '', addedBy: req.session.user.username },
      { upsert: true, new: true }
    );
    res.status(201).json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/blacklist/:id', async (req, res) => {
  await Blacklist.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ─── Tickets (lecture seule) ────────────────────────────────────────────
router.get('/tickets', async (req, res) => {
  const status = req.query.status === 'closed' ? 'closed' : 'open';
  const tickets = await Ticket.find({ status }).sort('-createdAt').limit(100).populate('categoryId', 'name emoji');
  res.json(tickets);
});

module.exports = router;
