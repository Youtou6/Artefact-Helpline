// État en mémoire des utilisateurs en train de créer un ticket (pas encore en base
// tant que le ticket n'est pas réellement créé). Un seul process bot => une Map suffit.

const pendingFlows = new Map(); // userId -> { step, language, categoryId, questions, answers, index }
const spamLog = new Map(); // userId -> [timestamps]

function getFlow(userId) {
  return pendingFlows.get(userId) || null;
}

function startFlow(userId) {
  const flow = { step: 'language', language: null, categoryId: null, questions: [], answers: [], index: 0 };
  pendingFlows.set(userId, flow);
  return flow;
}

function updateFlow(userId, patch) {
  const flow = pendingFlows.get(userId);
  if (!flow) return null;
  Object.assign(flow, patch);
  return flow;
}

function clearFlow(userId) {
  pendingFlows.delete(userId);
}

/** Retourne true si l'utilisateur a dépassé la limite anti-spam pour démarrer un flow. */
function isRateLimited(userId, windowMinutes, maxAttempts) {
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const attempts = (spamLog.get(userId) || []).filter((t) => now - t < windowMs);
  spamLog.set(userId, attempts);
  return attempts.length >= maxAttempts;
}

function recordAttempt(userId) {
  const attempts = spamLog.get(userId) || [];
  attempts.push(Date.now());
  spamLog.set(userId, attempts);
}

module.exports = { getFlow, startFlow, updateFlow, clearFlow, isRateLimited, recordAttempt };
