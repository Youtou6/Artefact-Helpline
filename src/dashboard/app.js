const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const { sessionSecret, mongoUri } = require('../config/env');
const ensureAuth = require('./middleware/ensureAuth');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');

function createApp() {
  const app = express();

  // Indispensable derrière le proxy de Render (et la plupart des hébergeurs) :
  // sans ça, Express ne détecte pas que la connexion entrante est bien du HTTPS,
  // et refuse silencieusement de poser le cookie de session (secure: true).
  app.set('trust proxy', 1);

  app.use(express.json());
  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl: mongoUri, collectionName: 'sessions' }),
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      },
    })
  );

  // Ping pour UptimeRobot — doit répondre vite et sans authentification.
  app.get('/health', (req, res) => res.status(200).send('ok'));

  app.use('/auth', authRoutes);
  app.use('/api', ensureAuth, apiRoutes);

  app.get('/', (req, res) => {
    res.redirect(req.session.user ? '/dashboard.html' : '/login.html');
  });

  app.use(express.static(path.join(__dirname, 'public')));

  return app;
}

module.exports = { createApp };
