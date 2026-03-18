const fs = require('fs');
const path = require('path');

const KAPSO_API = 'https://api.kapso.ai/meta/whatsapp/v24.0';
const PHONE_NUMBER_ID = '597907523413541'; // Kapso Sandbox (+56 9 2040 3095)

// Load API key from credentials file, fallback to hardcoded
function loadApiKey() {
  try {
    const credsPath = path.join(__dirname, '.kapso-credentials.json');
    if (fs.existsSync(credsPath)) {
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      if (creds.apiKey) return creds.apiKey;
    }
  } catch {}
  return '3b2b4d03be0520218d8ca86509c948fee5cd0276ef6e7b1400580e0e21956c12';
}
let KAPSO_KEY = loadApiKey();
const LINK_FILE = path.join(__dirname, '.whatsapp-linked.json');

// In-memory pending codes: { code: { createdAt, resolved, phoneNumber } }
const pendingCodes = new Map();

// ─── Status ───

function getStatus() {
  try {
    if (fs.existsSync(LINK_FILE)) {
      const data = JSON.parse(fs.readFileSync(LINK_FILE, 'utf8'));
      return { linked: true, phoneNumber: data.phoneNumber, linkedAt: data.linkedAt };
    }
  } catch {}
  return { linked: false, phoneNumber: null };
}

// ─── Generate Link Code ───

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'HIVE-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];

  pendingCodes.set(code, { createdAt: Date.now(), resolved: false, phoneNumber: null });

  // Auto-expire after 10 minutes
  setTimeout(() => pendingCodes.delete(code), 10 * 60 * 1000);

  return code;
}

// ─── Poll Kapso for incoming message with code ───

async function pollForCode(code, timeoutMs = 10 * 60 * 1000) {
  const start = Date.now();
  const interval = 3000;

  while (Date.now() - start < timeoutMs) {
    try {
      const messages = await getIncomingMessages();
      if (messages && messages.length > 0) {
        for (const msg of messages) {
          const rawText = msg.text;
          const body = (typeof rawText === 'string' ? rawText : (rawText && rawText.body) || msg.body || '').trim().toUpperCase();
          if (body.includes(code)) {
            const phone = msg.from || msg.sender;
            if (phone) {
              // Save link
              const linkData = { phoneNumber: phone, linkedAt: new Date().toISOString(), code };
              fs.writeFileSync(LINK_FILE, JSON.stringify(linkData, null, 2));

              // Mark resolved
              const pending = pendingCodes.get(code);
              if (pending) {
                pending.resolved = true;
                pending.phoneNumber = phone;
              }

              // Send confirmation
              await sendMessage(phone, '✅ WhatsApp vinculado ao Claude Launcher! Agora voce pode conversar com o agente por aqui.');

              return { success: true, phoneNumber: phone };
            }
          }
        }
      }
    } catch (err) {
      console.error('[WhatsApp] Poll error:', err.message);
    }
    await sleep(interval);
  }

  pendingCodes.delete(code);
  return { success: false, reason: 'timeout' };
}

// ─── Get link status for a code ───

function getLinkStatus(code) {
  const pending = pendingCodes.get(code);
  if (!pending) return { status: 'expired' };
  if (pending.resolved) return { status: 'linked', phoneNumber: pending.phoneNumber };
  return { status: 'waiting' };
}

// ─── Send message via Kapso ───

async function sendMessage(to, text) {
  const resp = await fetch(`${KAPSO_API}/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'X-API-Key': KAPSO_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: text },
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Kapso send failed (${resp.status}): ${err.slice(0, 200)}`);
  }
  return resp.json();
}

// ─── Get incoming messages ───

async function getIncomingMessages() {
  const resp = await fetch(`${KAPSO_API}/${PHONE_NUMBER_ID}/messages`, {
    headers: { 'X-API-Key': KAPSO_KEY },
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  // Normalize: Kapso returns { data: [...] }
  const msgs = Array.isArray(data) ? data : (data.data || data.messages || []);
  // Only return inbound messages
  return msgs.filter(m => !m.to && m.from);
}

// ─── Get messages from linked number only ───

async function getLinkedMessages() {
  const status = getStatus();
  if (!status.linked) return [];
  const all = await getIncomingMessages();
  return all.filter(m => (m.from || m.sender) === status.phoneNumber);
}

// ─── Unlink ───

function unlink() {
  try { fs.unlinkSync(LINK_FILE); } catch {}
  return { linked: false };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  getStatus,
  generateCode,
  pollForCode,
  getLinkStatus,
  sendMessage,
  getIncomingMessages,
  getLinkedMessages,
  unlink,
  _setApiKey(key) { KAPSO_KEY = key; },
  _getApiKey() { return KAPSO_KEY; },
};
