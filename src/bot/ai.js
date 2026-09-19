const { geminiApiKey, geminiModel } = require('../config/env');

const LANG_NAMES = { en: 'English', fr: 'French', de: 'German' };

/**
 * Demande à Gemini (API gratuite de Google) de générer UNE question de suivi,
 * à partir du contexte donné par le staff pour la catégorie, des réponses déjà
 * fournies par le client, et des derniers messages du salon pour éviter les
 * répétitions.
 */
async function generateFollowUpQuestion({ categoryContext, answers, language, recentMessages }) {
  if (!geminiApiKey) {
    const err = new Error('missing_api_key');
    err.code = 'missing_api_key';
    throw err;
  }

  const langName = LANG_NAMES[language] || 'English';

  const answersText = (answers || [])
    .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
    .join('\n\n') || '(no form answers)';

  const conversationText = (recentMessages || []).join('\n') || '(no messages yet)';

  const prompt =
    `You are a helpful, concise support assistant for a Roblox build-commission service (staff sell custom Roblox builds to customers).\n\n` +
    `Context the staff gave you for this ticket's category:\n"""${categoryContext?.trim() || 'No specific context provided.'}"""\n\n` +
    `Information the customer already provided via the intake form:\n${answersText}\n\n` +
    `Recent conversation in the ticket (most recent last):\n${conversationText}\n\n` +
    `Based on all of the above, write EXACTLY ONE short, friendly, specific follow-up question to ask the ` +
    `customer next, in ${langName}, to gather information still missing. Do not repeat something already ` +
    `answered or discussed above. Output ONLY the question itself — no preamble, no quotes, no explanation.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 200 },
      }),
    }
  );

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const err = new Error(`Gemini API a répondu ${res.status} : ${bodyText.slice(0, 300)}`);
    err.code = 'api_error';
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || !text.trim()) {
    const err = new Error('Réponse vide de Gemini (probablement bloquée par les filtres de sécurité).');
    err.code = 'empty_response';
    throw err;
  }

  return text.trim();
}

module.exports = { generateFollowUpQuestion };
