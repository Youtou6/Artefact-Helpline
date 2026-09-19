const express = require('express');
const { discord, adminIds: envAdminIds } = require('../../config/env');
const Settings = require('../../models/Settings');

const router = express.Router();

const OAUTH_BASE = 'https://discord.com/api/oauth2';
const API_BASE = 'https://discord.com/api/v10';

router.get('/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: discord.clientId,
    redirect_uri: discord.redirectUri,
    response_type: 'code',
    scope: 'identify',
  });
  res.redirect(`${OAUTH_BASE}/authorize?${params.toString()}`);
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/auth/login');

  try {
    const tokenRes = await fetch(`${OAUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: discord.clientId,
        client_secret: discord.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: discord.redirectUri,
      }),
    });

    if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status})`);
    const tokenData = await tokenRes.json();

    const userRes = await fetch(`${API_BASE}/users/@me`, {
      headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new Error(`User fetch failed (${userRes.status})`);
    const user = await userRes.json();

    const settings = await Settings.getSingleton();
    const allowedIds = new Set([...envAdminIds, ...settings.adminIds]);

    if (!allowedIds.has(user.id)) {
      return res.redirect('/unauthorized.html');
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : null,
    };
    res.redirect('/dashboard.html');
  } catch (err) {
    console.error('[auth] erreur OAuth2 :', err.message);
    res.status(500).send('Erreur lors de la connexion avec Discord. Réessaie.');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not_authenticated' });
  res.json(req.session.user);
});

module.exports = router;
