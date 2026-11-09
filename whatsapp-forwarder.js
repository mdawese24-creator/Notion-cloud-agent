/**
 * Tuba Furniture WhatsApp 2-Way Group Forwarder & Social Broadcast Engine
 * Pure Node.js + @whiskeysockets/baileys
 * 100% Free Forever, Permanent Session Sync via Notion, Zero Touch
 */

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const https = require('https');

// WhatsApp Group Configurations
const GROUP_1 = '919945161755-1582609291@g.us'; // 🛋️𝗧𝗨𝗕𝗔 𝗙𝗨𝗥𝗡𝗜𝗧𝗨𝗥𝗘 (𝗦𝗚𝗣)🏠
const GROUP_2 = '120363419966576008@g.us';     // 🛋️🛋️𝗧𝗨𝗕𝗔 𝗙𝗨𝗥𝗡𝗜𝗧𝗨𝗥𝗘 (𝗦𝗚𝗣)🏠🏠
const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/d514blhycfkcqaxfytwnhmdwcmg1bcp9';

// Local Auth Folder
const AUTH_DIR = path.join(__dirname, 'baileys_auth');
const MEDIA_DIR = path.join(__dirname, 'public_media');

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// State Tracking
let sock = null;
let currentQrCode = null;
let currentPairingCode = null;
let connectionStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, CONNECTED, WAITING_PAIRING
let connectedPhone = null;
let lastForwardedAt = null;
let forwardCount = 0;
const processedMessageIds = new Set();
const recentLogs = [];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  recentLogs.unshift(line);
  if (recentLogs.length > 50) recentLogs.pop();
}

/**
 * Sync Auth State to/from Notion for Permanent Persistence across Render restarts
 */
async function restoreAuthFromNotion(notionReq, dbCaptureId) {
  try {
    log('Checking Notion for saved WhatsApp session bundle...');
    const res = await notionReq(`/v1/databases/${dbCaptureId}/query`, 'POST', {
      filter: {
        property: 'Name',
        title: { starts_with: '[SYSTEM_WA_AUTH]' }
      },
      page_size: 1
    });

    if (res && res.results && res.results.length > 0) {
      const pageId = res.results[0].id;
      log(`Found WhatsApp session in Notion page: ${pageId}. Downloading blocks...`);
      const blocksRes = await notionReq(`/v1/blocks/${pageId}/children`, 'GET');
      if (blocksRes && blocksRes.results) {
        let bundleStr = '';
        for (const b of blocksRes.results) {
          if (b.type === 'code' && b.code && b.code.rich_text) {
            for (const t of b.code.rich_text) {
              bundleStr += t.plain_text || t.text?.content || '';
            }
          }
        }

        if (bundleStr) {
          const bundle = JSON.parse(bundleStr);
          for (const [filename, contentBase64] of Object.entries(bundle)) {
            const filePath = path.join(AUTH_DIR, filename);
            fs.writeFileSync(filePath, Buffer.from(contentBase64, 'base64'));
          }
          log(`Successfully restored ${Object.keys(bundle).length} auth files from Notion!`);
          return pageId;
        }
      }
    }
  } catch (err) {
    log(`Notice: Could not restore auth from Notion: ${err.message}`);
  }
  return null;
}

async function saveAuthToNotion(notionReq, dbCaptureId, existingPageId) {
  try {
    log('Bundling WhatsApp auth files to sync with Notion...');
    if (!fs.existsSync(AUTH_DIR)) return;
    const files = fs.readdirSync(AUTH_DIR);
    if (files.length === 0) return;

    const bundle = {};
    for (const f of files) {
      const filePath = path.join(AUTH_DIR, f);
      if (fs.statSync(filePath).isFile()) {
        bundle[f] = fs.readFileSync(filePath).toString('base64');
      }
    }

    const bundleJson = JSON.stringify(bundle);
    log(`Auth bundle size: ${(bundleJson.length / 1024).toFixed(1)} KB`);

    // Split into chunks of 1800 characters to stay within Notion rich_text limits
    const CHUNK_SIZE = 1800;
    const richTextChunks = [];
    for (let i = 0; i < bundleJson.length; i += CHUNK_SIZE) {
      richTextChunks.push({
        type: 'text',
        text: { content: bundleJson.substring(i, i + CHUNK_SIZE) }
      });
    }

    // A code block can contain up to 100 rich_text elements (180 KB)
    const codeBlocks = [];
    while (richTextChunks.length > 0) {
      const chunkBatch = richTextChunks.splice(0, 80);
      codeBlocks.push({
        object: 'block',
        type: 'code',
        code: {
          rich_text: chunkBatch,
          language: 'json'
        }
      });
    }

    if (existingPageId) {
      // Archive old blocks or update page
      const children = await notionReq(`/v1/blocks/${existingPageId}/children`, 'GET');
      if (children && children.results) {
        for (const b of children.results) {
          await notionReq(`/v1/blocks/${b.id}`, 'DELETE');
        }
      }
      await notionReq(`/v1/blocks/${existingPageId}/children`, 'PATCH', { children: codeBlocks });
      log('Successfully updated existing WhatsApp session vault in Notion!');
    } else {
      const createRes = await notionReq('/v1/pages', 'POST', {
        parent: { database_id: dbCaptureId },
        properties: {
          Name: {
            title: [{ text: { content: '[SYSTEM_WA_AUTH] Permanent Session Vault' } }]
          }
        },
        children: codeBlocks
      });
      log(`Created new WhatsApp session vault in Notion! Page ID: ${createRes?.id}`);
    }
  } catch (err) {
    log(`Notice: Could not save auth to Notion: ${err.message}`);
  }
}

/**
 * Dispatch Payload to Make.com Webhook for Social Broadcast
 */
function sendToMakeWebhook(payload) {
  return new Promise((resolve) => {
    try {
      const data = JSON.stringify(payload);
      const url = new URL(MAKE_WEBHOOK_URL);
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      }, (res) => {
        let respData = '';
        res.on('data', chunk => respData += chunk);
        res.on('end', () => {
          log(`Make.com Webhook response: HTTP ${res.statusCode}`);
          resolve({ status: res.statusCode, data: respData });
        });
      });
      req.on('error', (e) => {
        log(`Make.com Webhook error: ${e.message}`);
        resolve({ error: e.message });
      });
      req.write(data);
      req.end();
    } catch (e) {
      log(`Make.com Webhook dispatch exception: ${e.message}`);
      resolve({ error: e.message });
    }
  });
}
/**
 * Initialize Baileys WhatsApp Engine
 */
async function startWhatsAppEngine({ notionReq, dbCaptureId, getBaseUrl, sendTelegramAlert }) {
  log('Starting Tuba WhatsApp Engine...');
  connectionStatus = 'CONNECTING';

  // 1. Try to restore session from Notion if local auth is empty
  let savedNotionPageId = null;
  if (!fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
    if (notionReq && dbCaptureId) {
      savedNotionPageId = await restoreAuthFromNotion(notionReq, dbCaptureId);
    }
  }

  // 2. Load MultiFileAuthState
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307], isLatest: true }));
  log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    generateHighQualityLinkPreview: true,
    browser: ['Tuba Furniture Siruguppa', 'Chrome', '1.0.0']
  });

  // Credential update debouncer for Notion sync
  let saveTimeout = null;
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      if (notionReq && dbCaptureId) {
        await saveAuthToNotion(notionReq, dbCaptureId, savedNotionPageId);
      }
    }, 5000);
  });

  // Connection Updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQrCode = await QRCode.toDataURL(qr);
      connectionStatus = 'WAITING_PAIRING';
      log('New WhatsApp QR code generated and available on /whatsapp dashboard');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      log(`Connection closed (status ${statusCode}). Reconnect: ${shouldReconnect}`);
      connectionStatus = 'DISCONNECTED';
      currentQrCode = null;
      currentPairingCode = null;

      if (shouldReconnect) {
        setTimeout(() => startWhatsAppEngine({ notionReq, dbCaptureId, getBaseUrl, sendTelegramAlert }), 5000);
      } else {
        log('Session logged out permanently. Please re-pair via /whatsapp');
        // Clear corrupt local auth
        try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
      }
    } else if (connection === 'open') {
      connectionStatus = 'CONNECTED';
      currentQrCode = null;
      currentPairingCode = null;
      connectedPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Unknown';
      log(`WhatsApp Connected successfully as: +${connectedPhone} (Abba)`);

      if (sendTelegramAlert) {
        sendTelegramAlert(`🟢 *Tuba WhatsApp Engine Connected*\n\nPhone: \`+${connectedPhone}\`\nStatus: Permanent Free Forever (Active)`);
      }

      // Sync state to Notion immediately after connection established
      if (notionReq && dbCaptureId) {
        await saveAuthToNotion(notionReq, dbCaptureId, savedNotionPageId);
      }
    }
  });

  // Message Listener (2-Way Cross-Forwarding & Social Broadcast)
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (m.type !== 'notify') return;
      for (const msg of m.messages) {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue; // Anti-loop: Never forward messages sent by self

        const chatId = msg.key.remoteJid;
        const isGroup1 = (chatId === GROUP_1);
        const isGroup2 = (chatId === GROUP_2);

        // Strict Filter: Only process messages from Tuba Group 1 or Group 2!
        if (!isGroup1 && !isGroup2) continue;

        const msgId = msg.key.id;
        if (processedMessageIds.has(msgId)) continue;
        processedMessageIds.add(msgId);
        if (processedMessageIds.size > 1000) {
          const firstKey = processedMessageIds.values().next().value;
          processedMessageIds.delete(firstKey);
        }

        const isImage = !!msg.message.imageMessage;
        const isVideo = !!msg.message.videoMessage;

        // Only furniture photos and videos are forwarded
        if (!isImage && !isVideo) continue;

        const caption = msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';
        const sourceGroupName = isGroup1 ? 'Group 1 (🛋️𝗧𝗨𝗕𝗔 𝗙𝗨𝗥𝗡𝗜𝗧𝗨𝗥𝗘)' : 'Group 2 (🛋️🛋️𝗧𝗨𝗕𝗔 𝗙𝗨𝗥𝗡𝗜𝗧𝗨𝗥𝗘)';
        const targetGroupJid = isGroup1 ? GROUP_2 : GROUP_1;
        const targetGroupName = isGroup1 ? 'Group 2' : 'Group 1';

        log(`Received ${isImage ? 'Photo' : 'Video'} in ${sourceGroupName}! Forwarding to ${targetGroupName}...`);

        // 1. Download media buffer
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
          logger: pino({ level: 'silent' }),
          reuploadRequest: sock.updateMediaMessage
        });

        if (!buffer || buffer.length === 0) {
          log('Failed to download media buffer');
          continue;
        }

        // 2. Cross-forward to Target WhatsApp Group under Abba's identity
        if (isImage) {
          await sock.sendMessage(targetGroupJid, {
            image: buffer,
            caption: caption
          });
        } else if (isVideo) {
          await sock.sendMessage(targetGroupJid, {
            video: buffer,
            caption: caption
          });
        }
        log(`✅ Successfully forwarded to ${targetGroupName} under Abba (+${connectedPhone})!`);

        forwardCount++;
        lastForwardedAt = new Date().toISOString();

        // 3. Save media file locally to serve via public URL for Make.com broadcast
        const ext = isImage ? 'jpg' : 'mp4';
        const fileName = `tuba_${Date.now()}_${msgId.substring(0, 8)}.${ext}`;
        const filePath = path.join(MEDIA_DIR, fileName);
        fs.writeFileSync(filePath, buffer);

        const baseUrl = getBaseUrl ? getBaseUrl() : 'https://awais-notion-cloud-agent.onrender.com';
        const publicMediaUrl = `${baseUrl}/media/${fileName}`;
        log(`Public Media URL generated: ${publicMediaUrl}`);

        // 4. Send Webhook to Make.com Scenario 8472724 (Instagram + Facebook + Google Maps + Telegram)
        const makePayload = {
          messages: [
            {
              id: msgId,
              chat_id: chatId,
              from_me: false,
              type: isImage ? 'image' : 'video',
              [isImage ? 'image' : 'video']: {
                link: publicMediaUrl,
                caption: caption
              }
            }
          ]
        };

        log('Broadcasting to Make.com (Instagram, Facebook, Google Maps, Telegram)...');
        sendToMakeWebhook(makePayload);

        // 5. Telegram Notification to Awais
        if (sendTelegramAlert) {
          const typeStr = isImage ? '📸 Furniture Photo' : '🎥 Furniture Video';
          sendTelegramAlert(
            `🚀 *Tuba Broadcast Executed!*\n\n` +
            `• *Type:* ${typeStr}\n` +
            `• *From:* ${sourceGroupName}\n` +
            `• *Forwarded To:* ${targetGroupName} (as Abba)\n` +
            `• *Social Broadcast:* Instagram, Facebook, Google Maps & Telegram\n` +
            (caption ? `• *Caption:* _${caption}_\n` : '') +
            `• *Total Lifetime Forwards:* ${forwardCount}`
          );
        }
      }
    } catch (err) {
      log(`Error processing incoming message: ${err.message}`);
    }
  });

  return sock;
}
/**
 * Request an 8-character Pairing Code for Abba's Phone Number
 */
async function requestPairingCode(phoneNumber) {
  if (!sock) throw new Error('WhatsApp engine is not initialized');
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  log(`Requesting pairing code for +${cleanPhone}...`);
  const code = await sock.requestPairingCode(cleanPhone);
  currentPairingCode = code;
  log(`Pairing code received: ${code}`);
  return code;
}

/**
 * Generate Status HTML Page for /whatsapp
 */
function getWhatsAppDashboardHtml() {
  const isOnline = (connectionStatus === 'CONNECTED');
  const badgeColor = isOnline ? '#10b981' : (connectionStatus === 'WAITING_PAIRING' ? '#f59e0b' : '#ef4444');
  const statusLabel = isOnline ? 'ONLINE & ACTIVE' : (connectionStatus === 'WAITING_PAIRING' ? 'READY TO LINK (Scan QR / Code)' : connectionStatus);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tuba Furniture WhatsApp Gateway ⚡</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card: #121826;
      --border: #222f46;
      --primary: #10b981;
      --primary-hover: #059669;
      --accent: #6366f1;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 24px; min-height: 100vh; }
    .container { max-width: 800px; margin: 0 auto; }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .title { font-size: 22px; font-weight: 800; display: flex; align-items: center; gap: 10px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; background: rgba(255,255,255,0.06); }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: ${badgeColor}; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; }
    .card-title { font-size: 13px; color: var(--text-muted); font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 20px; font-weight: 700; }
    .pairing-box { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 24px; margin-bottom: 24px; }
    .qr-container { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
    .qr-img { width: 260px; height: 260px; border-radius: 12px; background: white; padding: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .code-display { font-size: 32px; font-weight: 800; letter-spacing: 4px; color: var(--primary); padding: 16px 24px; background: rgba(16,185,129,0.1); border: 2px dashed var(--primary); border-radius: 12px; margin: 16px 0; text-align: center; }
    .btn { display: inline-flex; align-items: center; justify-content: center; background: var(--primary); color: #fff; font-weight: 700; font-size: 15px; padding: 12px 24px; border-radius: 12px; border: none; cursor: pointer; transition: 0.2s; text-decoration: none; }
    .btn:hover { background: var(--primary-hover); }
    .btn-secondary { background: var(--accent); }
    .input-group { display: flex; gap: 10px; margin-top: 14px; }
    .input { flex: 1; background: #0c121e; border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; color: #fff; font-size: 15px; outline: none; }
    .input:focus { border-color: var(--primary); }
    .log-box { background: #0c121e; border: 1px solid var(--border); border-radius: 12px; padding: 16px; max-height: 220px; overflow-y: auto; font-family: monospace; font-size: 12px; color: #cbd5e1; }
    .log-line { margin-bottom: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">🛋️ Tuba Furniture WhatsApp Gateway</div>
      <div class="badge"><div class="dot"></div>${statusLabel}</div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">Connected Identity</div>
        <div class="card-value">${isOnline ? `+${connectedPhone} (Abba)` : 'Not Linked'}</div>
      </div>
      <div class="card">
        <div class="card-title">Lifetime Forwards</div>
        <div class="card-value">${forwardCount} Items</div>
      </div>
      <div class="card">
        <div class="card-title">Last Activity</div>
        <div class="card-value" style="font-size:14px; margin-top:6px;">${lastForwardedAt ? new Date(lastForwardedAt).toLocaleString() : 'No activity yet'}</div>
      </div>
    </div>

    ${!isOnline ? `
    <div class="pairing-box">
      <h3 style="margin-bottom:12px; font-size:18px;">📲 Link Abba's Phone (One-Time Permanent Setup)</h3>
      <p style="color:var(--text-muted); font-size:14px; margin-bottom:16px;">
        Choose either method below. Once linked, the session is permanently saved in Notion and will NEVER ask you to re-link!
      </p>

      <div style="display:flex; flex-wrap:wrap; gap:24px; align-items:center;">
        ${currentQrCode ? `
        <div class="qr-container">
          <img class="qr-img" src="${currentQrCode}" alt="WhatsApp QR Code">
          <p style="margin-top:10px; font-size:13px; color:var(--text-muted);">Scan in WhatsApp &gt; Linked Devices</p>
        </div>
        ` : ''}

        <div style="flex:1; min-width:260px;">
          <h4 style="font-size:15px; margin-bottom:8px;">Option 2: Link with Phone Number (Pairing Code)</h4>
          <p style="color:var(--text-muted); font-size:13px;">Enter Abba's 10-digit number to get an 8-character pairing code:</p>
          <div class="input-group">
            <input class="input" id="phoneInput" type="text" value="919945161755" placeholder="919945161755">
            <button class="btn" onclick="getPairingCode()">Get Code</button>
          </div>
          <div id="codeResult">
            ${currentPairingCode ? `<div class="code-display">${currentPairingCode}</div><p style="font-size:13px; color:var(--primary);">Enter this code on Abba's phone under Linked Devices &gt; Link with phone number!</p>` : ''}
          </div>
        </div>
      </div>
    </div>
    ` : `
    <div class="pairing-box" style="border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.03);">
      <h3 style="color:var(--primary); margin-bottom:8px;">✅ 100% Zero-Touch 2-Way Gateway is ACTIVE</h3>
      <p style="color:var(--text-muted); font-size:14px; line-height:1.6;">
        • <b>Group 1 ➔ Group 2:</b> Furniture photos/videos sent to Group 1 auto-forward to Group 2 under Abba's name.<br>
        • <b>Group 2 ➔ Group 1:</b> Messages sent in Group 2 cross-forward to Group 1.<br>
        • <b>Social Broadcast:</b> Instagram, Facebook, Google Maps (*Call Now* CTA) and Telegram Channel are auto-posted via Make.com.<br>
        • <b>Session Persistence:</b> Saved in Notion cloud vault. Survives all Render restarts permanently.
      </p>
    </div>
    `}

    <div class="card">
      <div class="card-title">Live Forwarding & Broadcast Logs</div>
      <div class="log-box">
        ${recentLogs.length > 0 ? recentLogs.map(l => `<div class="log-line">${l}</div>`).join('') : '<div style="color:#64748b;">Waiting for new incoming furniture messages in Group 1 or Group 2...</div>'}
      </div>
    </div>
  </div>

  <script>
    async function getPairingCode() {
      const phone = document.getElementById('phoneInput').value;
      const res = await fetch('/api/whatsapp/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (data.code) {
        document.getElementById('codeResult').innerHTML = '<div class="code-display">' + data.code + '</div><p style="font-size:13px; color:var(--primary); font-weight:600;">Enter this 8-digit code on Abba\\'s phone: WhatsApp &gt; Linked Devices &gt; Link with phone number!</p>';
      } else {
        alert(data.error || 'Failed to generate pairing code');
      }
    }
  </script>
</body>
</html>`;
}

module.exports = {
  startWhatsAppEngine,
  requestPairingCode,
  getWhatsAppDashboardHtml,
  getStatus: () => ({
    status: connectionStatus,
    connectedPhone,
    forwardCount,
    lastForwardedAt,
    hasQr: !!currentQrCode,
    pairingCode: currentPairingCode
  })
};
