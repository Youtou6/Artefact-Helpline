const { geminiApiKey, geminiModel } = require('../config/env');

const LANG_NAMES = { en: 'English', fr: 'French', de: 'German' };

const ASK_QUESTION_TOOL = {
  name: 'ask_question',
  description: 'Ask the customer one short, friendly follow-up question to gather information still missing, based on the category context and what they already told us.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to send to the customer, written in their language. No preamble, just the question.' },
    },
    required: ['question'],
  },
};

function buildRedirectTool(categoryKeys) {
  return {
    name: 'redirect_ticket',
    description: 'Move this ticket to a different, more appropriate category. Only use this when the customer\'s request CLEARLY does not belong in the current category.',
    parameters: {
      type: 'object',
      properties: {
        category_key: { type: 'string', enum: categoryKeys, description: 'The key of the correct category.' },
        reason: { type: 'string', description: 'One short sentence in French explaining why, for the staff.' },
      },
      required: ['category_key', 'reason'],
    },
  };
}

function buildPrompt({ categoryName, categoryContext, answers, language, recentMessages, canRedirect, otherCategories }) {
  const langName = LANG_NAMES[language] || 'English';

  const answersText = (answers || [])
    .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
    .join('\n\n') || '(no form answers)';

  const conversationText = (recentMessages || []).join('\n') || '(no messages yet)';

  let prompt =
    `You are a helpful, concise support assistant for a Roblox build-commission service (staff sell custom Roblox builds to customers).\n\n` +
    `Current ticket category: "${categoryName}".\n` +
    `Context the staff gave you for this category:\n"""${categoryContext?.trim() || 'No specific context provided.'}"""\n\n` +
    `Information the customer already provided via the intake form:\n${answersText}\n\n` +
    `Recent conversation in the ticket (most recent last):\n${conversationText}\n\n`;

  if (canRedirect && otherCategories?.length) {
    prompt += `Other categories you may redirect this ticket to, ONLY if it clearly belongs there instead:\n` +
      otherCategories.map((c) => `- key "${c.key}": ${c.name}${c.aiContext ? ' — ' + c.aiContext : ''}`).join('\n') + '\n\n';
  }

  prompt +=
    `Decide the single best next action and call exactly one of the available tools to perform it. ` +
    `Prefer asking a follow-up question unless the category is clearly wrong. ` +
    `Anything shown to the customer must be written in ${langName}.`;

  return prompt;
}

/**
 * Demande à Gemini de décider et d'exécuter UNE action (poser une question de
 * suivi, ou rediriger le ticket), selon les permissions accordées à la catégorie.
 * Retourne { type: 'action', name, args } ou { type: 'text', text } en repli.
 */
async function generateFollowUpAction({ categoryName, categoryContext, answers, language, recentMessages, permissions, otherCategories }) {
  if (!geminiApiKey) {
    const err = new Error('missing_api_key');
    err.code = 'missing_api_key';
    throw err;
  }

  const functionDeclarations = [];
  if (permissions?.canAskQuestions) functionDeclarations.push(ASK_QUESTION_TOOL);
  if (permissions?.canRedirect && otherCategories?.length) {
    functionDeclarations.push(buildRedirectTool(otherCategories.map((c) => c.key)));
  }

  if (functionDeclarations.length === 0) {
    const err = new Error('no_permissions');
    err.code = 'no_permissions';
    throw err;
  }

  const prompt = buildPrompt({
    categoryName, categoryContext, answers, language, recentMessages,
    canRedirect: permissions?.canRedirect, otherCategories,
  });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ functionDeclarations }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 300 },
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
  const parts = data?.candidates?.[0]?.content?.parts || [];

  const fnPart = parts.find((p) => p.functionCall || p.function_call);
  if (fnPart) {
    const fc = fnPart.functionCall || fnPart.function_call;
    return { type: 'action', name: fc.name, args: fc.args || {} };
  }

  const textPart = parts.find((p) => p.text?.trim());
  if (textPart) return { type: 'text', text: textPart.text.trim() };

  const err = new Error('Réponse vide de Gemini (probablement bloquée par les filtres de sécurité).');
  err.code = 'empty_response';
  throw err;
}

module.exports = { generateFollowUpAction };
