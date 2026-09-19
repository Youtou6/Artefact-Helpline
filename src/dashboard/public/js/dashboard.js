// ─── Utilitaires ────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('not_authenticated');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let toastTimer = null;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = isError ? 'var(--danger)' : 'var(--accent)';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function fmtDate(d) {
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── État global ────────────────────────────────────────────────────────
let currentSettings = null;
let currentCategories = [];
let currentTicketStatus = 'open';

// ─── Navigation ─────────────────────────────────────────────────────────
const loaders = {
  settings: loadSettings,
  categories: loadCategories,
  canned: loadCanned,
  blacklist: loadBlacklist,
  tickets: () => loadTickets(currentTicketStatus),
};

document.getElementById('nav').addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  item.classList.add('active');
  document.getElementById(`view-${item.dataset.view}`).classList.add('active');
  loaders[item.dataset.view]?.();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ─── Paramètres ─────────────────────────────────────────────────────────
async function loadSettings() {
  const [s, guilds] = await Promise.all([api('/api/settings'), api('/api/guilds')]);
  currentSettings = s;

  const sel = document.getElementById('guildSelect');
  let options = '<option value="">— Aucun —</option>' + guilds.map((g) =>
    `<option value="${g.id}" ${g.id === s.guildId ? 'selected' : ''}>${escapeHtml(g.name)} — ${g.memberCount} membres</option>`
  ).join('');
  if (s.guildId && !guilds.find((g) => g.id === s.guildId)) {
    options += `<option value="${s.guildId}" selected>ID ${s.guildId} (bot absent de ce serveur)</option>`;
  }
  sel.innerHTML = options;

  const tag = document.getElementById('guildStatusTag');
  tag.textContent = s.initialized ? 'Initialisé' : 'Non initialisé';
  tag.style.color = s.initialized ? 'var(--success)' : 'var(--accent)';

  document.getElementById('guildInitHint').textContent = s.initialized
    ? `Catégorie de tickets et salon de logs déjà créés sur ${s.guildName || s.guildId}. Changer de serveur ci-dessus nécessitera une nouvelle initialisation.`
    : 'Choisis un serveur (le bot doit déjà y être invité) puis clique sur "Initialiser sur ce serveur" : le bot y créera automatiquement la catégorie de tickets et le salon de logs.';

  document.getElementById('inviteBotLink').href = s.botInviteUrl;

  document.getElementById('brandName').value = s.branding?.serverName || '';
  document.getElementById('brandLogo').value = s.branding?.logoUrl || '';
  document.getElementById('brandFooter').value = s.branding?.footerText || '';
  document.getElementById('spamMax').value = s.antiSpam?.maxAttempts ?? 3;
  document.getElementById('spamWindow').value = s.antiSpam?.windowMinutes ?? 10;

  renderAdminList(s.adminIds || []);
}

function renderAdminList(ids) {
  const el = document.getElementById('adminList');
  if (ids.length === 0) {
    el.innerHTML = '<div class="hint">Aucun ID ajouté ici (les IDs définis en variable d\'environnement ADMIN_DISCORD_IDS restent toujours autorisés).</div>';
    return;
  }
  el.innerHTML = ids.map((id) => `
    <div class="list-row">
      <div class="row-main"><span class="mono">${escapeHtml(id)}</span></div>
      <div class="row-actions"><button class="small danger" data-remove-admin="${escapeHtml(id)}">Retirer</button></div>
    </div>`).join('');
}

document.getElementById('adminList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove-admin]');
  if (!btn) return;
  const id = btn.dataset.removeAdmin;
  const newIds = (currentSettings.adminIds || []).filter((x) => x !== id);
  currentSettings = await api('/api/settings', { method: 'PATCH', body: { adminIds: newIds } });
  renderAdminList(currentSettings.adminIds);
  toast('Accès retiré.');
});

document.getElementById('addAdminBtn').addEventListener('click', async () => {
  const input = document.getElementById('newAdminId');
  const id = input.value.trim();
  if (!/^\d{15,25}$/.test(id)) return toast('ID Discord invalide.', true);
  const newIds = [...new Set([...(currentSettings.adminIds || []), id])];
  currentSettings = await api('/api/settings', { method: 'PATCH', body: { adminIds: newIds } });
  renderAdminList(currentSettings.adminIds);
  input.value = '';
  toast('Accès ajouté.');
});

document.getElementById('saveGuildBtn').addEventListener('click', async () => {
  const guildId = document.getElementById('guildSelect').value;
  currentSettings = await api('/api/settings', { method: 'PATCH', body: { guildId } });
  toast('Serveur enregistré. Pense à cliquer sur "Initialiser" si ce n\'est pas déjà fait.');
  loadSettings();
});

document.getElementById('initGuildBtn').addEventListener('click', async () => {
  if (!confirm('Créer (ou recréer) la catégorie de tickets et le salon de logs sur le serveur sélectionné ?')) return;
  try {
    await api('/api/settings/initialize', { method: 'POST' });
    toast('Serveur initialisé avec succès.');
    loadSettings();
  } catch (err) {
    toast(err.message, true);
  }
});

document.getElementById('saveBrandBtn').addEventListener('click', async () => {
  const branding = {
    serverName: document.getElementById('brandName').value.trim(),
    logoUrl: document.getElementById('brandLogo').value.trim(),
    footerText: document.getElementById('brandFooter').value.trim(),
  };
  currentSettings = await api('/api/settings', { method: 'PATCH', body: { branding } });
  toast('Image de marque enregistrée.');
});

document.getElementById('saveSpamBtn').addEventListener('click', async () => {
  const antiSpam = {
    maxAttempts: Number(document.getElementById('spamMax').value) || 1,
    windowMinutes: Number(document.getElementById('spamWindow').value) || 1,
  };
  currentSettings = await api('/api/settings', { method: 'PATCH', body: { antiSpam } });
  toast('Anti-spam enregistré.');
});

// ─── Catégories ─────────────────────────────────────────────────────────
async function loadCategories() {
  currentCategories = await api('/api/categories');
  let roles = [];
  if (currentSettings?.guildId) {
    roles = await api(`/api/guilds/${currentSettings.guildId}/roles`).catch(() => []);
  }
  renderCategories(roles);
}

function roleOptions(roles, selected) {
  return '<option value="">— Aucun —</option>' + roles.map((r) =>
    `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${escapeHtml(r.name)}</option>`
  ).join('');
}

const QUESTION_TYPE_LABELS = { text: 'Texte libre', select: 'Menu déroulant', file: 'Fichier requis' };

function questionRowHTML(q) {
  const type = q.type || 'text';
  const optionsValue = (q.options || []).join(', ');
  return `
    <div class="question-item" data-qid="${q.id || ''}">
      <select data-role="qtype" style="flex:0 0 150px;">
        ${Object.entries(QUESTION_TYPE_LABELS).map(([val, label]) =>
          `<option value="${val}" ${type === val ? 'selected' : ''}>${label}</option>`
        ).join('')}
      </select>
      <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
        <input data-role="qtext" value="${escapeHtml(q.text || '')}" placeholder="Texte de la question..." />
        <input data-role="qoptions" value="${escapeHtml(optionsValue)}" placeholder="Options séparées par des virgules"
          style="${type === 'select' ? '' : 'display:none'}" />
      </div>
      <button class="small danger" data-remove-question style="flex:0 0 auto;">✕</button>
    </div>`;
}

function renderCategories(roles) {
  const el = document.getElementById('categoriesList');
  if (currentCategories.length === 0) {
    el.innerHTML = '<div class="panel"><div class="empty-state">Aucune catégorie pour l\'instant. Crée "Support" et "Order a build" ci-dessus.</div></div>';
    return;
  }

  el.innerHTML = currentCategories.map((cat) => `
    <div class="panel" data-cat-id="${cat._id}">
      <div class="panel-title">
        <span>${escapeHtml(cat.emoji)} ${escapeHtml(cat.name)} <span class="tag">${escapeHtml(cat.key)}</span></span>
        <label class="checkbox-row" style="font-size:12.5px; color:var(--text-soft);">
          <input type="checkbox" data-field="active" ${cat.active ? 'checked' : ''} /> Active
        </label>
      </div>

      <div class="field-row">
        <div class="field"><label>Emoji</label><input data-field="emoji" value="${escapeHtml(cat.emoji)}" /></div>
        <div class="field" style="flex:2"><label>Nom</label><input data-field="name" value="${escapeHtml(cat.name)}" /></div>
      </div>

      <div class="field-row">
        <div class="field">
          <label>Rôle staff pingé</label>
          <select data-field="staffRoleId">${roleOptions(roles, cat.staffRoleId)}</select>
        </div>
        <div class="field">
          <label>Format du nom de salon</label>
          <input data-field="ticketNameFormat" class="mono" value="${escapeHtml(cat.ticketNameFormat)}" />
        </div>
      </div>
      <div class="hint" style="margin-top:-8px; margin-bottom:14px;">Variables : <code>{key}</code> <code>{user}</code> <code>{count}</code></div>

      <div class="checkbox-row field">
        <input type="checkbox" data-field="anonymousReplies" ${cat.anonymousReplies ? 'checked' : ''} />
        <label style="margin:0;">Réponses staff anonymes</label>
      </div>

      <div class="field-row">
        <div class="field">
          <label>Rappel d'inactivité après (minutes, 0 = désactivé)</label>
          <input type="number" min="0" data-field="inactivityWarningMinutes" value="${cat.inactivityWarningMinutes ?? 0}" />
        </div>
        <div class="field">
          <label>Puis fermeture après (minutes suivant le rappel, 0 = désactivé)</label>
          <input type="number" min="0" data-field="inactivityCloseMinutes" value="${cat.inactivityCloseMinutes ?? 0}" />
        </div>
      </div>
      <div class="hint" style="margin-top:-8px; margin-bottom:14px;">Ex : 1440 puis 720 = rappel après 24h d'inactivité, fermeture 12h plus tard si toujours rien.</div>

      <div class="field">
        <label>Contexte pour l'IA (optionnel) — utilisé par le bouton "Rappeler l'IA" et la réponse automatique</label>
        <textarea data-field="aiContext" rows="3" placeholder="Ex : Cette catégorie sert aux commandes de build Roblox sur mesure. Pose des questions sur le budget, le style, la taille de la map, la deadline, les références visuelles.">${escapeHtml(cat.aiContext || '')}</textarea>
      </div>

      <div class="field">
        <label>Informations à récupérer avant de terminer (séparées par des virgules)</label>
        <input data-field="aiInfoToCollect" value="${escapeHtml((cat.aiInfoToCollect || []).join(', '))}" placeholder="Ex : Budget, Style souhaité, Taille de la map, Deadline, Références visuelles" />
        <div class="hint">Une fois tout récupéré (ou si rien n'est précisé ici et qu'elle juge avoir assez demandé), l'IA envoie un fichier récapitulatif dans le salon et s'arrête.</div>
      </div>

      <div class="checkbox-row field">
        <input type="checkbox" data-field="aiAutoRespond" ${cat.aiAutoRespond ? 'checked' : ''} />
        <label style="margin:0;">L'IA répond en premier, juste après la création du ticket (avant le staff)</label>
      </div>

      <label style="display:block; margin-bottom:6px;">Droits de l'IA pour cette catégorie</label>
      <div class="field-row" style="margin-bottom:14px;">
        <div class="checkbox-row field">
          <input type="checkbox" data-field="aiCanAskQuestions" ${cat.aiPermissions?.canAskQuestions !== false ? 'checked' : ''} />
          <label style="margin:0;">Peut poser des questions de suivi</label>
        </div>
        <div class="checkbox-row field">
          <input type="checkbox" data-field="aiCanRedirect" ${cat.aiPermissions?.canRedirect ? 'checked' : ''} />
          <label style="margin:0;">Peut rediriger vers une autre catégorie</label>
        </div>
      </div>
      <div class="hint" style="margin-top:-8px; margin-bottom:14px;">Dans tous les cas, l'IA peut toujours terminer sa collecte (fichier récap envoyé) ou passer la main à un humain — ce n'est jamais bloqué.</div>

      <hr class="divider" />
      <label>Questions posées avant création du ticket</label>
      <div class="questions-list">
        ${cat.questions.map((q) => questionRowHTML(q)).join('')}
      </div>
      <button class="small" data-add-question style="margin-bottom:16px;">+ Ajouter une question</button>

      <div style="display:flex; gap:10px;">
        <button class="primary" data-save-category>Enregistrer</button>
        <button class="danger" data-delete-category>Supprimer la catégorie</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('addCategoryBtn').addEventListener('click', async () => {
  const name = document.getElementById('newCatName').value.trim();
  const emoji = document.getElementById('newCatEmoji').value.trim() || '📁';
  if (!name) return toast('Le nom de la catégorie est requis.', true);
  await api('/api/categories', { method: 'POST', body: { name, emoji, order: currentCategories.length } });
  document.getElementById('newCatName').value = '';
  toast('Catégorie créée.');
  loadCategories();
});

document.getElementById('categoriesList').addEventListener('change', (e) => {
  if (!e.target.matches('[data-role="qtype"]')) return;
  const row = e.target.closest('.question-item');
  const optionsInput = row.querySelector('[data-role="qoptions"]');
  optionsInput.style.display = e.target.value === 'select' ? '' : 'none';
});

document.getElementById('categoriesList').addEventListener('click', async (e) => {
  const panel = e.target.closest('[data-cat-id]');
  if (!panel) return;
  const catId = panel.dataset.catId;

  if (e.target.matches('[data-add-question]')) {
    const list = panel.querySelector('.questions-list');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = questionRowHTML({ id: '', type: 'text', text: '', options: [] });
    const row = wrapper.firstElementChild;
    list.appendChild(row);
    row.querySelector('[data-role="qtext"]').focus();
    return;
  }

  if (e.target.matches('[data-remove-question]')) {
    e.target.closest('.question-item').remove();
    return;
  }

  if (e.target.matches('[data-delete-category]')) {
    if (!confirm(`Supprimer la catégorie "${panel.querySelector('[data-field="name"]').value}" ? Cette action est irréversible.`)) return;
    await api(`/api/categories/${catId}`, { method: 'DELETE' });
    toast('Catégorie supprimée.');
    loadCategories();
    return;
  }

  if (e.target.matches('[data-save-category]')) {
    const get = (field) => panel.querySelector(`[data-field="${field}"]`);
    const questions = [...panel.querySelectorAll('.question-item')].map((row) => {
      const type = row.querySelector('[data-role="qtype"]').value;
      const text = row.querySelector('[data-role="qtext"]').value.trim();
      const options = row.querySelector('[data-role="qoptions"]').value
        .split(',').map((s) => s.trim()).filter(Boolean);
      return { id: row.dataset.qid || undefined, type, text, options };
    }).filter((q) => q.text);

    const body = {
      name: get('name').value.trim(),
      emoji: get('emoji').value.trim() || '📁',
      staffRoleId: get('staffRoleId').value || null,
      ticketNameFormat: get('ticketNameFormat').value.trim() || '{key}-{count}',
      anonymousReplies: get('anonymousReplies').checked,
      inactivityWarningMinutes: Number(get('inactivityWarningMinutes').value) || 0,
      inactivityCloseMinutes: Number(get('inactivityCloseMinutes').value) || 0,
      aiContext: get('aiContext').value.trim(),
      aiInfoToCollect: get('aiInfoToCollect').value.split(',').map((s) => s.trim()).filter(Boolean),
      aiAutoRespond: get('aiAutoRespond').checked,
      aiPermissions: {
        canAskQuestions: get('aiCanAskQuestions').checked,
        canRedirect: get('aiCanRedirect').checked,
      },
      active: get('active').checked,
      questions,
    };
    await api(`/api/categories/${catId}`, { method: 'PUT', body });
    toast('Catégorie enregistrée.');
    loadCategories();
  }
});

// ─── Réponses prédéfinies ───────────────────────────────────────────────
async function loadCanned() {
  const [canned, categories] = await Promise.all([api('/api/canned'), api('/api/categories')]);
  currentCategories = categories;

  const sel = document.getElementById('newCannedCategory');
  sel.innerHTML = '<option value="">Toutes catégories</option>' +
    categories.map((c) => `<option value="${c._id}">${escapeHtml(c.emoji)} ${escapeHtml(c.name)}</option>`).join('');

  renderCanned(canned, categories);
}

function renderCanned(canned, categories) {
  const el = document.getElementById('cannedList');
  if (canned.length === 0) {
    el.innerHTML = '<div class="panel"><div class="empty-state">Aucune réponse prédéfinie pour l\'instant.</div></div>';
    return;
  }
  const catOptions = (selected) => '<option value="">Toutes catégories</option>' +
    categories.map((c) => `<option value="${c._id}" ${String(c._id) === String(selected) ? 'selected' : ''}>${escapeHtml(c.emoji)} ${escapeHtml(c.name)}</option>`).join('');

  el.innerHTML = canned.map((r) => `
    <div class="panel" data-canned-id="${r._id}">
      <div class="field-row">
        <div class="field" style="flex:2"><label>Libellé</label><input data-field="label" value="${escapeHtml(r.label)}" /></div>
        <div class="field"><label>Catégorie</label><select data-field="categoryId">${catOptions(r.categoryId)}</select></div>
      </div>
      <div class="field"><label>Contenu</label><textarea data-field="content" rows="3">${escapeHtml(r.content)}</textarea></div>
      <div style="display:flex; gap:10px;">
        <button class="primary" data-save-canned>Enregistrer</button>
        <button class="danger" data-delete-canned>Supprimer</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('addCannedBtn').addEventListener('click', async () => {
  const label = document.getElementById('newCannedLabel').value.trim();
  const content = document.getElementById('newCannedContent').value.trim();
  const categoryId = document.getElementById('newCannedCategory').value || null;
  if (!label || !content) return toast('Libellé et contenu sont requis.', true);
  await api('/api/canned', { method: 'POST', body: { label, content, categoryId } });
  document.getElementById('newCannedLabel').value = '';
  document.getElementById('newCannedContent').value = '';
  toast('Réponse créée.');
  loadCanned();
});

document.getElementById('cannedList').addEventListener('click', async (e) => {
  const panel = e.target.closest('[data-canned-id]');
  if (!panel) return;
  const id = panel.dataset.cannedId;

  if (e.target.matches('[data-delete-canned]')) {
    if (!confirm('Supprimer cette réponse prédéfinie ?')) return;
    await api(`/api/canned/${id}`, { method: 'DELETE' });
    toast('Réponse supprimée.');
    loadCanned();
    return;
  }

  if (e.target.matches('[data-save-canned]')) {
    const get = (field) => panel.querySelector(`[data-field="${field}"]`);
    await api(`/api/canned/${id}`, {
      method: 'PUT',
      body: {
        label: get('label').value.trim(),
        content: get('content').value.trim(),
        categoryId: get('categoryId').value || null,
      },
    });
    toast('Réponse enregistrée.');
  }
});

// ─── Blacklist ──────────────────────────────────────────────────────────
async function loadBlacklist() {
  const entries = await api('/api/blacklist');
  const el = document.getElementById('blacklistList');
  if (entries.length === 0) {
    el.innerHTML = '<div class="panel"><div class="empty-state">Aucun utilisateur blacklisté.</div></div>';
    return;
  }
  el.innerHTML = '<div class="panel">' + entries.map((b) => `
    <div class="list-row">
      <div class="row-main">
        <div class="row-title">${escapeHtml(b.username || 'Pseudo inconnu')}</div>
        <div class="row-sub">${escapeHtml(b.userId)}${b.reason ? ' — ' + escapeHtml(b.reason) : ''}</div>
      </div>
      <div class="row-actions"><button class="small danger" data-remove-bl="${b._id}">Retirer</button></div>
    </div>
  `).join('') + '</div>';
}

document.getElementById('addBlacklistBtn').addEventListener('click', async () => {
  const userId = document.getElementById('newBlUserId').value.trim();
  const username = document.getElementById('newBlUsername').value.trim();
  const reason = document.getElementById('newBlReason').value.trim();
  if (!/^\d{15,25}$/.test(userId)) return toast('ID Discord invalide.', true);
  await api('/api/blacklist', { method: 'POST', body: { userId, username, reason } });
  document.getElementById('newBlUserId').value = '';
  document.getElementById('newBlUsername').value = '';
  document.getElementById('newBlReason').value = '';
  toast('Utilisateur blacklisté.');
  loadBlacklist();
});

document.getElementById('blacklistList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-remove-bl]');
  if (!btn) return;
  await api(`/api/blacklist/${btn.dataset.removeBl}`, { method: 'DELETE' });
  toast('Retiré de la blacklist.');
  loadBlacklist();
});

// ─── Tickets ────────────────────────────────────────────────────────────
async function loadTickets(status) {
  currentTicketStatus = status;
  document.getElementById('ticketsOpenBtn').classList.toggle('primary', status === 'open');
  document.getElementById('ticketsClosedBtn').classList.toggle('primary', status === 'closed');

  const tickets = await api(`/api/tickets?status=${status}`);
  const el = document.getElementById('ticketsList');
  if (tickets.length === 0) {
    el.innerHTML = `<div class="panel"><div class="empty-state">Aucun ticket ${status === 'open' ? 'ouvert' : 'fermé'}.</div></div>`;
    return;
  }

  const guildId = currentSettings?.guildId;
  el.innerHTML = '<div class="panel">' + tickets.map((t) => {
    const link = guildId ? `https://discord.com/channels/${guildId}/${t.channelId}` : null;
    const ratingBadge = t.rating ? `<span class="badge ok">${'⭐'.repeat(t.rating)}</span>` : (status === 'closed' ? '<span class="badge">Pas de note</span>' : '');
    const sub = status === 'closed'
      ? `${t.language.toUpperCase()} · fermé ${fmtDate(t.closedAt)} · ${t.closeReason === 'inactivity' ? 'inactivité' : 'staff'}`
      : `${t.language.toUpperCase()} · ${fmtDate(t.createdAt)} · ${t.claimedByTag ? 'Pris en charge par ' + escapeHtml(t.claimedByTag) : 'Non pris en charge'}`;
    return `
    <div class="list-row">
      <div class="row-main">
        <div class="row-title">#${t.ticketNumber} — ${escapeHtml(t.categoryId?.emoji || '')} ${escapeHtml(t.categoryId?.name || t.categoryKey)} — ${escapeHtml(t.username)} ${ratingBadge}</div>
        <div class="row-sub">${sub}</div>
      </div>
      <div class="row-actions">${link ? `<a class="btn small" href="${link}" target="_blank">Voir le salon</a>` : ''}</div>
    </div>`;
  }).join('') + '</div>';
}

document.getElementById('ticketsOpenBtn').addEventListener('click', () => loadTickets('open'));
document.getElementById('ticketsClosedBtn').addEventListener('click', () => loadTickets('closed'));

// ─── Démarrage ──────────────────────────────────────────────────────────
(async function init() {
  try {
    const me = await api('/auth/me');
    document.getElementById('userName').textContent = me.username;
    if (me.avatar) document.getElementById('userAvatar').src = me.avatar;
  } catch {
    return; // déjà redirigé vers /login.html par api()
  }
  loadSettings();
})();
