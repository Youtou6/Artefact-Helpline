const { geminiApiKey, geminiModel } = require('../config/env');

const LANG_NAMES = { en: 'English', fr: 'French', de: 'German' };

const ASK_QUESTION_TOOL = {
  name: 'ask_question',
  description: 'Ask the customer one short, friendly follow-up question to keep gathering the missing information. Use this as long as you have more relevant questions to ask.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to send to the customer, written in their language. No preamble, just the question.' },
    },
    required: ['question'],
  },
};

const FINISH_TOOL = {
  name: 'finish_collection',
  description: 'Call this ONCE you have gathered everything relevant for this ticket (all items on the "information to collect" list, if any, or once you judge there is nothing more useful to ask). This ends your involvement and hands a full written summary to the human staff.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A complete, well-organized summary (in French, for staff) of everything gathered from the customer so far: form answers and conversation. Use short labeled lines, one piece of information per line.',
      },
    },
    required: ['summary'],
  },
};

const REQUEST_HUMAN_TOOL = {
  name: 'request_human',
  description: 'Call this at ANY point if a human staff member should take over instead of you: the customer is asking for a human, the request is ambiguous, sensitive, out of scope, the customer seems upset, or you are unsure how to proceed. This immediately ends your involvement.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'One short sentence in French explaining why a human is needed now.' },
    },
    required: ['reason'],
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

function buildPrompt({ categoryName, categoryContext, infoToCollect, discordUsername, answers, language, recentMessages, canRedirect, otherCategories }) {
  const langName = LANG_NAMES[language] || 'English';

  const answersText = (answers || [])
    .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
    .join('\n\n') || '(no form answers)';

  const conversationText = (recentMessages || []).join('\n') || '(no messages yet)';

  let prompt =
    `You are a helpful, concise support assistant for a Roblox build-commission service (staff sell custom Roblox builds to customers). ` +
    `You are having a direct conversation with the customer via Discord DMs, relayed into this ticket.\n\n` +
    `Customer's Discord username: ${discordUsername || 'unknown'}\n` +
    `Current ticket category: "${categoryName}".\n` +
    `Context the staff gave you for this category:\n"""${categoryContext?.trim() || 'No specific context provided.'}"""\n\n`;

  if (infoToCollect?.length) {
    prompt += `Information you must try to gather from the customer before finishing, if not already covered:\n` +
      infoToCollect.map((item) => `- ${item}`).join('\n') + '\n\n';
  } else {
    prompt += `No specific checklist was provided — use your judgment: ask 1-3 relevant questions based on the category context, then finish.\n\n`;
  }

  prompt +=
    `Information the customer already provided via the intake form:\n${answersText}\n\n` +
    `Recent conversation in the ticket (most recent last):\n${conversationText}\n\n`;

  if (canRedirect && otherCategories?.length) {
    prompt += `Other categories you may redirect this ticket to, ONLY if it clearly belongs there instead:\n` +
      otherCategories.map((c) => `- key "${c.key}": ${c.name}${c.aiContext ? ' — ' + c.aiContext : ''}`).join('\n') + '\n\n';
  }

  prompt +=
    `Decide the single best next action and call exactly one of the available tools to perform it. ` +
    `Keep asking relevant questions one at a time as long as useful information is still missing. ` +
    `Call finish_collection as soon as you have what you need (do not ask unnecessary questions). ` +
    `Call request_human immediately if a human should take over instead. ` +
    `Anything shown to the customer must be written in ${langName}.`;

  return prompt;
}

/**
 * Demande à Gemini de décider et d'exécuter UN tour de la conversation :
 * poser une question, terminer (avec résumé), demander un humain, ou rediriger.
 * Retourne { type: 'action', name, args } ou { type: 'text', text } en repli.
 */
async function generateFollowUpAction({ categoryName, categoryContext, infoToCollect, discordUsername, answers, language, recentMessages, permissions, otherCategories }) {
  if (!geminiApiKey) {
    const err = new Error('missing_api_key');
    err.code = 'missing_api_key';
    throw err;
  }

  const functionDeclarations = [FINISH_TOOL, REQUEST_HUMAN_TOOL];
  if (permissions?.canAskQuestions) functionDeclarations.push(ASK_QUESTION_TOOL);
  if (permissions?.canRedirect && otherCategories?.length) {
    functionDeclarations.push(buildRedirectTool(otherCategories.map((c) => c.key)));
  }

  const prompt = buildPrompt({
    categoryName, categoryContext, infoToCollect, discordUsername, answers, language, recentMessages,
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
        generationConfig: { temperature: 0.6, maxOutputTokens: 800 },
      }),
    }
  );

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    const err = new Error(`Gemini API a répondu ${res.status} : ${bodyText.slice(0, 300)}`);
    err.code = 'api_error';
    err.status = res.status;
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

  const finishReason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
  const err = new Error(`Réponse vide de Gemini${finishReason ? ` (raison : ${finishReason})` : ' (probablement bloquée par les filtres de sécurité)'}.`);
  err.code = 'empty_response';
  throw err;
}

module.exports = { generateFollowUpAction };
