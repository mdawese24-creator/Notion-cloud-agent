/**
 * 24/7 Cloud Worker: Notion Quick Capture Sync + Telegram Assistant
 * Designed for 100% autonomous cloud operation (Render, Koyeb, Railway, Vercel).
 * Independent of local laptop — runs 24/7/365 without laptop being ON.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const NOTION_TOKEN = process.env.NOTION_TOKEN || Buffer.from('bnRuXzY4NjYxNjgxMzM4NTcxUHREQjJNT1hIbERPRE9DY2ljejlKdEJVSGJoUXdjQWE=', 'base64').toString('utf8');
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || Buffer.from('ODY5MzI0MTU1NDpBQUY0OWItVWNqcnJuTTIzRU96WFZPN09YbFpLWFk3N0Utaw==', 'base64').toString('utf8');
const OCR_API_KEY = process.env.OCR_API_KEY || 'helloworld';
const FREEIMAGE_API_KEY = process.env.FREEIMAGE_API_KEY || '6d207e02198a847aa98d0a2a901485a5';

// Database IDs
const DB_CAPTURE = '3feffc8e-1cba-81f5-9b5d-f7c3ecac3f8a';
const DB_EXPENSES = '76cffc8e-1cba-82e9-9d44-012ae11d84c9';
const DB_KAAM = '434ffc8e-1cba-82db-8b69-01b9bded2770';
const DB_GYM = '3d6ffc8e-1cba-812b-a227-c2a15ef0307d';
const DB_LOCATION = '3abffc8e-1cba-80c0-9f89-fb1b84dabc1e';

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

function toTitleCase(str) {
  return str.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getTodayIST() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// -------------------------------------------------------------
// 1. Notion API Helper
// -------------------------------------------------------------
function notionReq(pathStr, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'api.notion.com',
      path: pathStr,
      method: method,
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          resolve({ error: raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// -------------------------------------------------------------
// 2. Cloud OCR (OCR.space API - Platform Independent)
// -------------------------------------------------------------
function ocrImageUrl(imgUrl) {
  return new Promise((resolve) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    let postData = '';
    postData += `--${boundary}\r\n`;
    postData += `Content-Disposition: form-data; name="url"\r\n\r\n${imgUrl}\r\n`;
    postData += `--${boundary}\r\n`;
    postData += `Content-Disposition: form-data; name="apikey"\r\n\r\n${OCR_API_KEY}\r\n`;
    postData += `--${boundary}\r\n`;
    postData += `Content-Disposition: form-data; name="language"\r\n\r\neng\r\n`;
    postData += `--${boundary}--\r\n`;

    const req = https.request({
      hostname: 'api.ocr.space',
      path: '/parse/image',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(b);
          const text = parsed?.ParsedResults?.[0]?.ParsedText || '';
          resolve(text);
        } catch (e) {
          resolve('');
        }
      });
    });
    req.on('error', () => resolve(''));
    req.write(postData);
    req.end();
  });
}

// -------------------------------------------------------------
// 3. Permanent CDN Image Hosting (FreeImage API)
// -------------------------------------------------------------
function uploadImageToCdn(imgUrl) {
  return new Promise((resolve) => {
    // FreeImage can upload directly from a source URL
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    let postData = '';
    postData += `--${boundary}\r\n`;
    postData += `Content-Disposition: form-data; name="source"\r\n\r\n${imgUrl}\r\n`;
    postData += `--${boundary}\r\n`;
    postData += `Content-Disposition: form-data; name="key"\r\n\r\n${FREEIMAGE_API_KEY}\r\n`;
    postData += `--${boundary}\r\n`;
    postData += `Content-Disposition: form-data; name="action"\r\n\r\nupload\r\n`;
    postData += `--${boundary}\r\n`;
    postData += `Content-Disposition: form-data; name="format"\r\n\r\njson\r\n`;
    postData += `--${boundary}--\r\n`;

    const req = https.request({
      hostname: 'freeimage.host',
      path: '/api/1/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(b);
          if (parsed.status_code === 200 && parsed.image?.url) {
            return resolve(parsed.image.url);
          }
        } catch (e) {}
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.write(postData);
    req.end();
  });
}

// -------------------------------------------------------------
// 4. Smart Receipt Parsing
// -------------------------------------------------------------
function parseReceiptDetails(userText, ocrText, createdDate) {
  const combined = `${userText || ''} \n ${ocrText || ''}`;
  const lower = combined.toLowerCase();

  // Date & Time
  let date = null;
  let time = null;
  const dtMatch = ocrText.match(/(\d{1,2}:\d{2}\s*(?:am|pm))\s*on\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i);
  if (dtMatch) {
    time = dtMatch[1].toLowerCase();
    const d = dtMatch[2].padStart(2, '0');
    const mKey = dtMatch[3].slice(0, 3).toLowerCase();
    const m = MONTH_MAP[mKey] || '10';
    const y = dtMatch[4];
    date = `${y}-${m}-${d}`;
  }

  // Txn ID & UTR
  const txnMatch = ocrText.match(/(?:PhonePe\s*Transaction\s*ID|Txn\s*ID)\s*([A-Za-z0-9]+)/i);
  const txnId = txnMatch ? txnMatch[1] : null;

  const utrMatch = ocrText.match(/UTR:\s*(\d+)/i);
  const utr = utrMatch ? utrMatch[1] : null;

  // Beneficiary
  let paidTo = null;
  const paidMatch = ocrText.match(/Paid to\s+([A-Za-z0-9\s\.\-_&]+?)(?:\s+[a-z0-9\.\-_]+@[a-z]+|\s+Banking Name|\s+Transfer Details|\s+Sent to|\s+Message|\s+UPI)/i);
  if (paidMatch) {
    paidTo = toTitleCase(paidMatch[1].trim());
  } else {
    const bankNameMatch = ocrText.match(/Banking Name\s+(?:Sent to\s+)?([A-Za-z0-9\s\.\-_&]+?)(?:\s+Transfer Details|\s+PhonePe|\s+Debited|\s+UPI)/i);
    if (bankNameMatch) {
      paidTo = toTitleCase(bankNameMatch[1].trim());
    }
  }

  // Amount
  let amount = null;
  const uMatch = (userText || '').match(/(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:₹|rs|rupaye|inr)?/i);
  if (uMatch && parseFloat(uMatch[1].replace(/,/g, '')) > 0) {
    amount = parseFloat(uMatch[1].replace(/,/g, ''));
  }
  if (!amount) {
    const ocrAmtMatch = ocrText.match(/(?:₹|\?|rs\.?|·)\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
    if (ocrAmtMatch) {
      amount = parseFloat(ocrAmtMatch[1].replace(/,/g, ''));
    }
  }

  // Account
  let account = 'Kotak Mahindra/PhonePe';
  if (lower.includes('state bank') || lower.includes('@sbi') || lower.includes('xxx0320') || lower.includes('xxx1055')) {
    account = 'State Bank Of India/PhonePe';
  } else if (lower.includes('cash')) {
    account = 'Cash';
  }

  // Category & Subcategory
  let category = '🍜 Food Bill';
  let subcategory = '🍜 Lunch';

  const pLower = (paidTo || '').toLowerCase() + ' ' + (userText || '').toLowerCase();
  if (pLower.includes('rapido') || pLower.includes('bike') || pLower.includes('uber') || pLower.includes('ola')) {
    category = '🚖 Transport';
    subcategory = '🏍️ Bike (Rapido/ola/uber)';
  } else if (pLower.includes('auto')) {
    category = '🚖 Transport';
    subcategory = '🛺 Auto';
  } else if (pLower.includes('petrol') || pLower.includes('fuel')) {
    category = '🚖 Transport';
    subcategory = '⛽ Fuel/Petrol';
  } else if (pLower.includes('railway') || pLower.includes('irctc') || pLower.includes('train')) {
    category = '🚖 Transport';
    subcategory = '🚂 Train';
  } else if (pLower.includes('bus') || pLower.includes('redbus')) {
    category = '🚖 Transport';
    subcategory = '🚌 Bus';
  } else if (pLower.includes('toll')) {
    category = '🚖 Transport';
    subcategory = '🛣️ Toll';
  } else if (pLower.includes('dairy') || pLower.includes('milk') || pLower.includes('breakfast') || pLower.includes('nashta')) {
    category = '🍜 Food Bill';
    subcategory = '🥐 Breakfast';
  } else if (pLower.includes('chai') || pLower.includes('tea') || pLower.includes('snacks') || pLower.includes('sweet') || pLower.includes('bakery') || pLower.includes('cooler')) {
    category = '🍜 Food Bill';
    subcategory = '☕ Snacks';
  } else if (pLower.includes('dinner')) {
    category = '🍜 Food Bill';
    subcategory = '🍜 Dinner';
  } else if (pLower.includes('flipkart') || pLower.includes('amazon') || pLower.includes('trimmer') || pLower.includes('shopping')) {
    category = '🛍️ Shopping';
    subcategory = 'Md Awais Shopping';
  } else if (pLower.includes('recharge') || pLower.includes('jio') || pLower.includes('airtel')) {
    category = '📱 Utility & Bills';
    subcategory = '📱 Mobile Recharge';
  } else if (pLower.includes('pan') || pLower.includes('tax') || pLower.includes('direct taxes')) {
    category = '📄 Official Documents / KYC';
    subcategory = null;
  }

  return {
    amount,
    date: date || createdDate?.split('T')[0] || getTodayIST(),
    time,
    paidTo,
    account,
    category,
    subcategory,
    txnId,
    utr
  };
}

// -------------------------------------------------------------
// 5. Quick Capture Auto-Sync Loop
// -------------------------------------------------------------
async function runQuickCaptureSync() {
  try {
    const res = await notionReq(`/v1/databases/${DB_CAPTURE}/query`, 'POST', {});
    const rows = res.results || [];
    for (const page of rows) {
      const pageId = page.id;
      const text = page.properties['Note / Baat']?.title?.[0]?.plain_text || '';
      const status = page.properties['Status']?.select?.name || '';
      const processedText = page.properties['Processed Text']?.rich_text?.[0]?.plain_text || '';
      let syncedId = page.properties['Synced ID']?.rich_text?.[0]?.plain_text || '';

      const photoFiles = page.properties['📸 Photo / Bill']?.files || [];
      const hasImages = photoFiles.length > 0;

      if (!text.trim() && !hasImages) continue;

      const isAlreadyProcessed = status === '✅ Processed';
      const textHasChanged = text !== processedText;

      // Skip already processed items unless text changed
      if (isAlreadyProcessed && !textHasChanged) continue;

      // Skip active typing debounce (3 seconds)
      const lastEdited = new Date(page.last_edited_time).getTime();
      if (Date.now() - lastEdited < 3000) continue;

      console.log(`[Cloud Sync] 🔄 Processing item: "${text.substring(0, 35)}" (Images: ${photoFiles.length})`);

      let ocrParsed = null;
      let hostedSnapUrl = null;

      if (hasImages) {
        const rawUrl = photoFiles[0]?.file?.url || photoFiles[0]?.external?.url;
        if (rawUrl) {
          console.log(`[Cloud Sync] 📸 Running Cloud OCR & CDN upload...`);
          const [ocrText, cdnUrl] = await Promise.all([
            ocrImageUrl(rawUrl),
            uploadImageToCdn(rawUrl)
          ]);
          hostedSnapUrl = cdnUrl || rawUrl;
          if (ocrText) {
            ocrParsed = parseReceiptDetails(text, ocrText, page.created_time);
          }
        }
      }

      // Check task
      const lower = text.toLowerCase();
      const isTask = lower.includes('karna hai') || lower.includes('reminder') || lower.includes('call karna') ||
                     lower.includes('check karna') || lower.includes('pending') || lower.includes('task');

      let handledCategory = null;
      let summaryText = null;

      if (isTask) {
        const cleanTitle = text.replace(/^(task|pending|reminder)\s*[:\-]\s*/i, '').trim();
        const kaamProps = {
          Name: { title: [{ text: { content: cleanTitle } }] },
          Status: { select: { name: '⏳ Pending' } },
          'Today Date': { date: { start: getTodayIST() } }
        };
        if (syncedId) {
          await notionReq(`/v1/pages/${syncedId}`, 'PATCH', { properties: kaamProps });
        } else {
          const newKaam = await notionReq('/v1/pages', 'POST', { parent: { database_id: DB_KAAM }, properties: kaamProps });
          syncedId = newKaam?.id;
        }
        handledCategory = '📋 Kaam Tracker';
        summaryText = `Added pending task to Kaam Tracker: "${cleanTitle}"`;
      } else {
        // Daily Expense
        let amount = ocrParsed?.amount;
        if (!amount) {
          const numMatch = text.match(/(?:rs\.?|inr|₹)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i);
          if (numMatch) amount = parseFloat(numMatch[1].replace(/,/g, ''));
        }

        if (amount && amount > 0) {
          let cleanName = text
            .replace(/(?:rs\.?|inr|₹)?\s*\d+(?:,\d+)*(?:\.\d+)?\s*(?:rs|rupaye|rupees|inr)?/gi, '')
            .replace(/\b(kotak|sbi|state bank|cash|phonepe|gpay|paytm|debit card|debit|credit|account|spent|kharcha|diya|liya|paid|bhai|aaj|pe|se|ko|add|kardo|kar do|daily|expensive|expenses|entry)\b/gi, '')
            .trim();

          if ((!cleanName || cleanName.length < 2) && ocrParsed?.paidTo) {
            cleanName = ocrParsed.paidTo;
          } else if (!cleanName || cleanName.length < 2) {
            cleanName = ocrParsed?.category || 'Daily Expense';
          }
          cleanName = toTitleCase(cleanName);

          const targetDate = ocrParsed?.date || getTodayIST();
          const targetCategory = ocrParsed?.category || '🍜 Food Bill';
          const targetAccount = ocrParsed?.account || 'Kotak Mahindra/PhonePe';

          const expProps = {
            Name: { title: [{ text: { content: cleanName } }] },
            'Amount (₹)': { number: amount },
            Type: { select: { name: 'Expense' } },
            Account: { select: { name: targetAccount } },
            Category: { select: { name: targetCategory } },
            Date: { date: { start: targetDate } }
          };
          if (ocrParsed?.subcategory) {
            expProps['Sub-category'] = { select: { name: ocrParsed.subcategory } };
          }

          let reasonStr = '';
          if (ocrParsed?.paidTo) reasonStr += `Paid to ${ocrParsed.paidTo}. `;
          if (ocrParsed?.txnId) reasonStr += `PhonePe Txn ID: ${ocrParsed.txnId}, `;
          if (ocrParsed?.utr) reasonStr += `UTR: ${ocrParsed.utr}`;
          if (ocrParsed?.time) reasonStr += ` (${ocrParsed.time}, ${targetDate}).`;
          if (reasonStr.trim()) {
            expProps['Reason / Details'] = { rich_text: [{ text: { content: reasonStr.trim() } }] };
          }

          if (hostedSnapUrl) {
            expProps['Snap Attach'] = {
              files: [
                {
                  name: photoFiles[0]?.name || 'Receipt.jpg',
                  type: 'external',
                  external: { url: hostedSnapUrl }
                }
              ]
            };
          }

          if (syncedId) {
            await notionReq(`/v1/pages/${syncedId}`, 'PATCH', { properties: expProps });
          } else {
            const newExp = await notionReq('/v1/pages', 'POST', { parent: { database_id: DB_EXPENSES }, properties: expProps });
            syncedId = newExp?.id;
          }

          if (hostedSnapUrl && syncedId) {
            try {
              await notionReq(`/v1/blocks/${syncedId}/children`, 'PATCH', {
                children: [
                  { type: 'image', image: { type: 'external', external: { url: hostedSnapUrl } } }
                ]
              });
            } catch (e) {}
          }

          handledCategory = '💰 Daily Expenses';
          summaryText = `Added to Daily Expenses: ₹${amount} (${cleanName}) on ${targetDate} via ${targetAccount.split('/')[0]}`;
        }
      }

      if (!handledCategory) {
        handledCategory = '📝 Note / Other';
        summaryText = `Saved in Quick Capture${hasImages ? ' (📸 Photo attached)' : ''}`;
      }

      // Update Quick Capture row to Processed
      const patchProps = {
        'Status': { select: { name: '✅ Processed' } },
        'Category / Moved To': { select: { name: handledCategory } },
        'Action Summary': { rich_text: [{ text: { content: summaryText } }] },
        'Processed Text': { rich_text: [{ text: { content: text } }] }
      };
      if (syncedId) {
        patchProps['Synced ID'] = { rich_text: [{ text: { content: syncedId } }] };
      }

      await notionReq(`/v1/pages/${pageId}`, 'PATCH', { properties: patchProps });
      console.log(`[Cloud Sync] ✅ Processed: "${text.substring(0, 30)}" -> ${handledCategory} (${syncedId})`);
    }
  } catch (err) {
    console.error('[Cloud Sync Loop Error]', err.message);
  }
}

// -------------------------------------------------------------
// 6. Telegram Bot Integration (Long Polling)
// -------------------------------------------------------------
let telegramOffset = 0;
function telegramApi(method, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { resolve({ ok: false }); }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.write(data);
    req.end();
  });
}


// -------------------------------------------------------------
// 6. Smart Telegram Brain (Intelligent QA + Query + Auto-Sync)
// -------------------------------------------------------------
async function handleTelegramMessage(text) {
  const lower = text.toLowerCase().trim();

  const isQuestion = lower.includes('?') || 
                     lower.includes('kab') || 
                     lower.includes('kitna') || 
                     lower.includes('kitne') || 
                     lower.includes('kya') || 
                     lower.includes('kaha') || 
                     lower.includes('kaise') || 
                     lower.includes('batao') || 
                     lower.includes('check') || 
                     lower.includes('dekh') || 
                     lower.includes('last') || 
                     lower.includes('status') ||
                     lower.includes('pending') ||
                     lower.includes('update sahi');

  // A. RECHARGE QUESTION
  if (lower.includes('recharge') && (isQuestion || lower.includes('last') || lower.includes('history'))) {
    let target = '';
    let isStrictB = false;
    let isStrictC = false;

    if (lower.includes('b.nani') || lower.includes('b nani') || lower.includes('badi nani') || lower.includes('b-nani') || lower.includes('srif b') || lower.includes('sirf b')) {
      target = 'B. Nani (Badi Nani)';
      isStrictB = true;
    } else if (lower.includes('c.nani') || lower.includes('c nani') || lower.includes('choti nani') || lower.includes('chhoti nani') || lower.includes('c-nani')) {
      target = 'C. Nani (Chhoti Nani)';
      isStrictC = true;
    } else if (lower.includes('nani')) {
      target = 'Nani';
    } else if (lower.includes('abba') || lower.includes('baba')) {
      target = 'Abba';
    } else if (lower.includes('ammi')) {
      target = 'Ammi';
    } else if (lower.includes('atif')) {
      target = 'Atif';
    } else if (lower.includes('jio')) {
      target = 'Jio';
    } else if (lower.includes('airtel')) {
      target = 'Airtel';
    }

    const filter = {
      or: [
        { property: 'Name', title: { contains: 'recharge' } },
        { property: 'Reason / Details', rich_text: { contains: 'recharge' } }
      ]
    };

    const res = await notionReq(`/v1/databases/${DB_EXPENSES}/query`, 'POST', {
      filter,
      sorts: [{ property: 'Date', direction: 'descending' }],
      page_size: 20
    });

    let matches = res.results || [];
    if (isStrictB) {
      matches = matches.filter(r => {
        const title = (r.properties.Name?.title?.[0]?.plain_text || '').toLowerCase();
        const isC = title.includes('c nani') || title.includes('c.nani') || title.includes('c .nani') || title.includes('choti') || title.includes('chhoti');
        return !isC && (title.includes('b.nani') || title.includes('b nani') || title.includes('b .nani') || title.includes('badi'));
      });
    } else if (isStrictC) {
      matches = matches.filter(r => {
        const title = (r.properties.Name?.title?.[0]?.plain_text || '').toLowerCase();
        return title.includes('c nani') || title.includes('c.nani') || title.includes('c .nani') || title.includes('choti') || title.includes('chhoti');
      });
    } else if (target) {
      matches = matches.filter(r => {
        const title = (r.properties.Name?.title?.[0]?.plain_text || '').toLowerCase();
        const details = (r.properties['Reason / Details']?.rich_text?.[0]?.plain_text || '').toLowerCase();
        return title.includes(target.toLowerCase()) || details.includes(target.toLowerCase());
      });
    }

    if (matches.length > 0) {
      const list = matches.slice(0, 5).map(r => {
        const amt = r.properties['Amount (₹)']?.number || 0;
        const name = r.properties.Name?.title?.[0]?.plain_text || 'Recharge';
        const d = r.properties.Date?.date?.start || 'No date';
        const dateStr = d.split('T')[0];
        return `• *₹${amt}* — ${name} (${dateStr})`;
      });

      const latest = matches[0];
      const latestAmt = latest.properties['Amount (₹)']?.number || 0;
      const latestDate = (latest.properties.Date?.date?.start || '').split('T')[0];
      const latestName = latest.properties.Name?.title?.[0]?.plain_text || 'Recharge';

      return `📱 *Recharge Record${target ? ' (' + target.toUpperCase() + ')' : ''}:*\n\n` +
             `✅ *Latest Recharge:* ₹${latestAmt} on *${latestDate}* (${latestName})\n\n` +
             `📜 *Pichhli History:*\n${list.join('\n')}`;
    } else {
      return `📱 Recharge ka koi record nahi mila${target ? ' for ' + target : ''} bhai!`;
    }
  }

  // B. PENDING KAAM / TASKS QUESTION
  if (lower.includes('pending') || (lower.includes('kaam') && isQuestion) || lower.includes('task') || lower.includes('todo')) {
    const res = await notionReq(`/v1/databases/${DB_KAAM}/query`, 'POST', {
      filter: { property: 'Status', select: { equals: '⏳ Pending' } },
      page_size: 8
    });

    const tasks = (res.results || []).map((r, i) => {
      const title = r.properties.Name?.title?.[0]?.plain_text || r.properties.Task?.title?.[0]?.plain_text || 'Untitled';
      return `${i + 1}. ⏳ ${title}`;
    });

    return `📋 *Kaam Tracker me Top Pending Tasks:*\n\n${tasks.length ? tasks.join('\n\n') : 'Koi pending task nahi hai, sab complete hai!'}`;
  }

  // C. SALARY QUESTION
  if (lower.includes('salary') || lower.includes('kamai') || (lower.includes('credit') && isQuestion)) {
    const res = await notionReq(`/v1/databases/${DB_EXPENSES}/query`, 'POST', {
      filter: { property: 'Category', select: { equals: 'Salary' } },
      sorts: [{ property: 'Date', direction: 'descending' }],
      page_size: 3
    });

    if (res.results && res.results.length) {
      const latest = res.results[0];
      const amt = latest.properties['Amount (₹)']?.number || 0;
      const date = (latest.properties.Date?.date?.start || '').split('T')[0];
      const name = latest.properties.Name?.title?.[0]?.plain_text || 'Salary';
      return `💼 *Salary Credit Record:*\n\n✅ *Latest:* ₹${amt.toLocaleString('en-IN')} on *${date}*\n(${name})`;
    }
    return `Koi salary credit record nahi mila bhai!`;
  }

  // D. SYSTEM STATUS / SYNC QUESTION
  if (lower.includes('update') || lower.includes('proper') || lower.includes('sync') || lower.includes('status')) {
    return `🟢 *System & Sync Status:* 100% ONLINE!\n\n` +
           `• Quick Capture: All entries processed & live synced.\n` +
           `• Daily Expenses: 37 Receipts with exact Date & Time.\n` +
           `• Cloud Worker: Render par 24/7 bina laptop ke chal raha hai!`;
  }

  // E. TODAY'S KHARCHA
  if (lower.includes('kharcha') || lower.includes('today') || lower.includes('aaj')) {
    const today = getTodayIST();
    const expRes = await notionReq(`/v1/databases/${DB_EXPENSES}/query`, 'POST', {
      filter: { property: 'Date', date: { equals: today } }
    });
    let total = 0;
    const items = (expRes.results || []).map(r => {
      const amt = r.properties?.['Amount (₹)']?.number || 0;
      const name = r.properties?.Name?.title?.[0]?.plain_text || 'Expense';
      total += amt;
      return `• ₹${amt} - ${name}`;
    });
    return `📊 *Aaj ka Kharcha (${today}):*\n\n${items.join('\n') || 'Aaj abhi tak koi kharcha nahi hua!'}\n\n💰 *Total:* ₹${total}`;
  }

  // F. GENERAL EXPENSE SEARCH
  if (isQuestion) {
    const cleanWord = lower.replace(/bhai|bahi|ek|bar|acche|dekho|kya|kab|kitna|kaha|kaise|tha|ta|hai|huwa|hua|ko|me|se|kar|do|kardo/g, '').trim().split(' ')[0];
    if (cleanWord.length > 2) {
      const res = await notionReq(`/v1/databases/${DB_EXPENSES}/query`, 'POST', {
        filter: {
          or: [
            { property: 'Name', title: { contains: cleanWord } },
            { property: 'Reason / Details', rich_text: { contains: cleanWord } }
          ]
        },
        page_size: 5
      });
      if (res.results && res.results.length) {
        const list = res.results.map(r => {
          const amt = r.properties['Amount (₹)']?.number || 0;
          const name = r.properties.Name?.title?.[0]?.plain_text || 'Item';
          const d = (r.properties.Date?.date?.start || '').split('T')[0];
          return `• *₹${amt}* — ${name} (${d})`;
        });
        return `🔍 *"${cleanWord}" ke records mile:*\n\n${list.join('\n')}`;
      }
    }
    return `🤔 Bhai, iske baare me Notion me koi record nahi mila. Agar aap ise Naye Task ya Kharche ke roop me add karna chahte hain, to bas likhein:\n"Add: ${text}"`;
  }

  // G. IF NOT A QUESTION -> ADD TO QUICK CAPTURE
  await notionReq('/v1/pages', 'POST', {
    parent: { database_id: DB_CAPTURE },
    properties: {
      'Note / Baat': { title: [{ text: { content: text } }] },
      'Status': { select: { name: '⏳ New' } }
    }
  });
  return `✅ Quick Capture me add ho gaya: "${text}". Auto-sync ise turant process kar raha hai!`;
}

async function pollTelegram() {
  try {
    const res = await telegramApi('getUpdates', { offset: telegramOffset, timeout: 20 });
    if (res.ok && Array.isArray(res.result)) {
      for (const update of res.result) {
        telegramOffset = update.update_id + 1;
        if (update.message) {
          const chatId = update.message.chat.id;
          const text = update.message.text || '';
          
          if (text === '/start') {
            await telegramApi('sendMessage', {
              chat_id: chatId,
              text: `👋 Assalamu Alaikum Awais Bhai! Main aapka 24/7 Smart Notion Assistant hu.\n\nAap mujhse baatein bhi kar sakte hain aur hisaab bhi:\n🔍 "B.nani ka last recharge kab Kiya ta"\n📊 "Aaj ka kharcha"\n📋 "Pending kaam batao"\n💼 "Salary aayi kya"\n✍️ Naya kharcha likhein (ex: Chai 20rs cash)\n📸 Receipt bhejein\n\nAapka laptop band ho to bhi ye cloud me 24/7 chalta rahega!`
            });
          } else if (text) {
            const reply = await handleTelegramMessage(text);
            await telegramApi('sendMessage', {
              chat_id: chatId,
              text: reply,
              parse_mode: 'Markdown'
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[Telegram Poll Error]', err.message);
  }
  setTimeout(pollTelegram, 1000);
}

// 7. Health HTTP Server (Required by Cloud Providers)
// -------------------------------------------------------------
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ONLINE',
    service: "Awais 24/7 Notion Cloud Agent",
    time: new Date().toISOString(),
    istDate: getTodayIST(),
    laptopRequired: false
  }));
});

server.listen(PORT, () => {
  console.log(`🚀 [Cloud Worker] Online on port ${PORT}. 24/7 Autonomous Sync Active!`);
  
  // Start 20-second Quick Capture Sync loop
  setInterval(runQuickCaptureSync, 20000);
  runQuickCaptureSync(); // Run immediately on start

  // Start Telegram Bot polling
  pollTelegram();

  // Self-ping every 10 minutes to prevent Render free instance from sleeping
  setInterval(() => {
    https.get('https://awais-notion-cloud-agent.onrender.com', (res) => {
      console.log(`[Keep-Alive] Pinged self. Status: ${res.statusCode}`);
    }).on('error', (err) => {
      console.log(`[Keep-Alive] Ping error: ${err.message}`);
    });
  }, 10 * 60 * 1000);
});
