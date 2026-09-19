# Modmail Roblox Build Services

Bot Discord modmail multilingue (EN/FR/DE, traduction automatique gratuite pour l'allemand) avec dashboard d'administration sécurisé, pour un serveur de vente de services de build Roblox.

## Ce que fait le bot

- Un utilisateur DM le bot → choix de la langue → choix d'une catégorie (Support / Order a build / autres, configurables) → questions spécifiques à la catégorie → création automatique d'un salon de ticket privé.
- Les messages sont relayés entre le DM de l'utilisateur et le salon (avec traduction automatique DE ⇄ FR, texte original toujours visible côté staff).
- Claim, fermeture avec transcript, blacklist, réponses prédéfinies (`/canned`), fermeture automatique après inactivité — tout est géré depuis un **dashboard web** protégé par connexion Discord.

---

## 1. Créer l'application Discord

1. Va sur https://discord.com/developers/applications → **New Application**, donne-lui un nom.
2. Onglet **Bot** :
   - Clique sur **Reset Token** puis copie le token → ce sera `DISCORD_BOT_TOKEN`.
   - Active les deux **Privileged Gateway Intents** suivants (obligatoires) :
     - `SERVER MEMBERS INTENT`
     - `MESSAGE CONTENT INTENT`
   - Tu peux personnaliser l'avatar et le nom du bot ici.
3. Onglet **OAuth2 → General** :
   - Copie le **Client ID** → `DISCORD_CLIENT_ID`.
   - Copie le **Client Secret** (clique sur "Reset Secret" si besoin) → `DISCORD_CLIENT_SECRET`.
   - Dans **Redirects**, ajoute :
     - `http://localhost:3000/auth/callback` (pour tester en local, optionnel)
     - `https://TON-APP.onrender.com/auth/callback` (tu ajouteras cette ligne une fois ton service Render créé à l'étape 5, avec la vraie URL)

### Inviter le bot sur ton serveur de test

Une fois le bot en ligne (après déploiement), le dashboard (page **Paramètres**) te donne un bouton **"Inviter le bot"** avec les bonnes permissions déjà configurées. Utilise-le pour l'ajouter à ton serveur de test, puis plus tard à ton serveur définitif — c'est tout l'intérêt du système : **rien n'est codé en dur**, tu changes juste le serveur actif dans le dashboard.

---

## 2. Créer la base de données (MongoDB Atlas, gratuit, sans CB)

1. Va sur https://www.mongodb.com/cloud/atlas/register et crée un compte (email suffit, aucune carte bancaire requise pour le tier gratuit).
2. Crée un cluster **M0 (Free)**.
3. **Database Access** → crée un utilisateur (identifiant + mot de passe, note-les).
4. **Network Access** → **Add IP Address** → **Allow Access from Anywhere** (`0.0.0.0/0`) — nécessaire car Render n'a pas d'IP fixe sur le plan gratuit.
5. **Connect** → **Drivers** → copie l'URI (ressemble à `mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`).
6. Ajoute un nom de base à la fin, par exemple : `.../modmail?retryWrites=true...` → ce sera ta `MONGODB_URI`.

---

## 3. Récupérer le projet sur GitHub

Dans ce dossier :

```bash
git init            # si pas déjà fait
git add .
git commit -m "Initial commit"
```

Crée un nouveau repo (vide, sans README) sur https://github.com/new, puis :

```bash
git remote add origin https://github.com/TON-USER/TON-REPO.git
git branch -M main
git push -u origin main
```

⚠️ Le fichier `.env` est ignoré par git (`.gitignore`) — ne le commit jamais, il contient tes secrets.

---

## 4. Générer le secret de session

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Garde la valeur générée, ce sera `SESSION_SECRET`.

---

## 5. Déployer sur Render

1. Sur https://dashboard.render.com → **New +** → **Web Service** → connecte ton repo GitHub.
2. Render devrait détecter `render.yaml` automatiquement (sinon configure manuellement) :
   - **Runtime** : Node
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Plan** : Free
3. Dans l'onglet **Environment**, renseigne toutes les variables (voir `.env.example`) :
   `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `ADMIN_DISCORD_IDS`, `MONGODB_URI`, `SESSION_SECRET`, `PUBLIC_URL`, `NODE_ENV=production`.
   - `ADMIN_DISCORD_IDS` = ton propre ID Discord (clic droit sur ton profil → Copier l'ID, active le mode développeur dans Discord si besoin : Paramètres → Avancés).
   - `DISCORD_REDIRECT_URI` et `PUBLIC_URL` : une fois Render t'a donné ton URL (`https://ton-app.onrender.com`), mets `https://ton-app.onrender.com/auth/callback` et `https://ton-app.onrender.com` respectivement, puis redéploie.
4. Une fois déployé, retourne sur le portail développeur Discord → OAuth2 → Redirects, et ajoute la vraie URL de callback Render si ce n'est pas déjà fait.

Le plan **free** de Render met le service en veille après ~15 minutes sans requête HTTP entrante — c'est pour ça qu'on configure UptimeRobot juste après. Le stockage disque du plan gratuit n'est pas persistant, c'est pour ça que **tout** est en base MongoDB.

---

## 6. Garder le bot éveillé avec UptimeRobot

1. Crée un compte gratuit sur https://uptimerobot.com.
2. **Add New Monitor** :
   - Type : **HTTP(s)**
   - URL : `https://ton-app.onrender.com/health`
   - Intervalle : 5 minutes (le minimum gratuit, largement suffisant — le service se met en veille après 15 min d'inactivité)
3. C'est tout. Cet endpoint ne nécessite aucune authentification et répond juste `ok`.

---

## 7. Premiers pas dans le dashboard

1. Va sur `https://ton-app.onrender.com` → **Se connecter avec Discord** (avec le compte dont l'ID est dans `ADMIN_DISCORD_IDS`).
2. Onglet **Paramètres** :
   - Invite le bot sur ton serveur de test via le bouton dédié s'il n'y est pas déjà.
   - Sélectionne ce serveur dans la liste déroulante → **Enregistrer le serveur**.
   - Clique sur **Initialiser sur ce serveur** : le bot crée automatiquement la catégorie de tickets et le salon de logs.
3. Onglet **Catégories** : crée `Support` et `Order a build`, configure leur rôle staff (crée d'abord ce rôle sur ton serveur Discord), leurs questions, etc.
4. Onglet **Réponses prédéfinies** : ajoute tes messages types (accessibles en salon de ticket via `/canned`).
5. Teste en DM le bot avec un compte utilisateur.

### Migrer vers le serveur définitif

Quand tu es prêt : invite le bot sur ton vrai serveur, va dans **Paramètres**, choisis ce nouveau serveur dans la liste, **Enregistrer**, puis **Initialiser sur ce serveur**. Tes catégories, questions et réponses prédéfinies restent inchangées (elles ne dépendent pas du serveur) — seuls le rôle staff par catégorie et le salon des logs seront à revérifier/recréer.

---

## Nouveautés : contexte utilisateur, notation, inactivité en 2 temps, redirection, questions avancées, IA

- **Contexte utilisateur** : l'utilisateur reçoit désormais un DM à chaque étape clé (ticket créé avec son numéro et sa catégorie, prise en charge par un staff, redirection vers une autre catégorie, rappel d'inactivité, fermeture — avec la raison). Tous les messages du bot (y compris ces notifications) sont maintenant affichés en containers, sans bande de couleur, pour un rendu homogène.
- **Transcript** : un vrai fichier `.txt` lisible (horodatage, auteur, contenu, pièces jointes, réponses au formulaire) est posté dans le salon de logs à chaque fermeture.
- **Notation** : juste après la fermeture, l'utilisateur reçoit un DM avec 5 boutons ⭐ pour noter le support. La note apparaît dans le dashboard (onglet Tickets) et dans le salon de logs.
- **Inactivité en 2 temps** (configurable par catégorie, dans le dashboard) : après *X* minutes sans activité, un rappel est envoyé à l'utilisateur et noté dans le salon ; si toujours rien après encore *Y* minutes, le ticket se ferme automatiquement. Un bouton **"Forcer le rappel"** sur le panneau du ticket permet de déclencher ce rappel manuellement, à tout moment.
- **Redirection de ticket** : bouton **"Rediriger"** sur le panneau du ticket → menu déroulant des autres catégories actives. Le salon est renommé, les permissions du rôle staff mises à jour, et l'utilisateur prévenu.
- **Questions avancées** : dans l'éditeur de catégorie, chaque question a désormais un type — *Texte libre*, *Menu déroulant* (avec ses options séparées par des virgules) ou *Fichier requis* (le bot exige une pièce jointe avant de continuer).
- **Assistant IA (Gemini, gratuit)** : chaque catégorie a un champ **"Contexte pour l'IA"** dans le dashboard (ex : *"Cette catégorie sert aux commandes de build Roblox sur mesure, demande le budget, le style, la deadline..."*), et deux **droits** activables séparément :
  - *Peut poser des questions de suivi* : l'IA formule une question pertinente et l'envoie en DM.
  - *Peut rediriger vers une autre catégorie* : si la demande ne correspond clairement pas à la catégorie actuelle, l'IA peut déplacer le ticket elle-même (salon renommé, permissions mises à jour, utilisateur prévenu — exactement comme une redirection manuelle, avec la raison notée en salon).
  
  Deux façons de la déclencher :
  - **Manuellement** : bouton **"Question IA"** sur le panneau du ticket, à tout moment.
  - **Automatiquement** : option **"L'IA répond en premier"** par catégorie — dès la création du ticket, avant même que le staff n'intervienne, l'IA analyse les réponses au formulaire et agit (pose une question ou redirige si besoin).

  Techniquement, l'IA ne "décide" jamais dans le vide : elle choisit parmi les actions explicitement autorisées pour la catégorie (function calling Gemini), donc désactiver un droit dans le dashboard le rend réellement impossible à utiliser, pas juste déconseillé.

### Configurer l'IA (Gemini, gratuit)

1. Va sur https://aistudio.google.com/apikey (connecte-toi avec un compte Google).
2. Clique sur **Create API key** → copie la clé générée.
3. Sur Render, ajoute la variable d'environnement `GEMINI_API_KEY` avec cette valeur, puis redéploie.
4. C'est tout — le bouton "Question IA" fonctionne dès le prochain ticket. Le tier gratuit de Google AI Studio suffit largement pour cet usage (quelques appels par ticket, pas de gros volume).
5. **Google fait évoluer ses modèles très régulièrement** (le nom par défaut de ce projet, `gemini-3.6-flash`, peut lui-même être retiré un jour). Si le bouton "Question IA" renvoie une erreur du type *"this model is no longer available"*, l'erreur indique elle-même le nom du modèle de remplacement recommandé — mets simplement à jour la variable `GEMINI_MODEL` sur Render (pas besoin de toucher au code) avec ce nom, puis redéploie. Liste à jour : https://ai.google.dev/gemini-api/docs/models.

⚠️ Sur le tier gratuit, Google peut utiliser le contenu envoyé pour améliorer ses modèles — évite d'y mettre des informations sensibles (coordonnées bancaires, etc.). Le contexte de catégorie et les réponses du formulaire suffisent largement pour des questions de suivi utiles.



- **Traduction** : librairie gratuite sans clé API (`@vitalets/google-translate-api`). Aucune traduction n'est faite entre l'anglais et le français (le staff gère directement), uniquement DE ⇄ FR.
- **Un seul ticket ouvert à la fois** par utilisateur.
- **Components V2** (containers Discord) utilisés pour tous les messages du bot, sans bande de couleur.
- Si tu modifies le code, `npm run dev` relance automatiquement le process à chaque sauvegarde (Node 18+ requis).

## Support

En cas de souci de déploiement, vérifie en premier les logs Render (onglet **Logs**) — la plupart des erreurs viennent d'une variable d'environnement manquante ou d'une IP non autorisée sur MongoDB Atlas.
