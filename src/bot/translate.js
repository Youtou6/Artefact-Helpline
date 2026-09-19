// Traduction gratuite, sans compte ni clé API (option choisie : pas de carte bancaire requise).
// @vitalets/google-translate-api est un module ESM pur : on l'importe dynamiquement
// depuis notre code CommonJS pour éviter de convertir tout le projet en ESM.

let _translateFn = null;
async function getTranslateFn() {
  if (!_translateFn) {
    const mod = await import('@vitalets/google-translate-api');
    _translateFn = mod.translate;
  }
  return _translateFn;
}

/**
 * Traduit un texte vers une langue cible.
 * En cas d'échec (service indisponible, rate-limit...), on renvoie le texte
 * original précédé d'une note plutôt que de faire planter le bot.
 */
async function translateText(text, targetLang) {
  if (!text || !text.trim()) return text;
  try {
    const translate = await getTranslateFn();
    const { text: translated } = await translate(text, { to: targetLang });
    return translated;
  } catch (err) {
    console.error('[translate] Échec de traduction :', err.message);
    return `${text}\n*(traduction automatique indisponible)*`;
  }
}

module.exports = { translateText };
