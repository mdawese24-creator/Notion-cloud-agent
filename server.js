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

function convert12to24(timeStr) {
  if (!timeStr) return '12:00:00';
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return '12:00:00';
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3].toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}:00`;
}

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
  if (lower.includes('state bank') || lower.includes('@sbi') || lower.includes('0320') || lower.includes('1055')) {
    account = 'State Bank Of India/PhonePe';
  } else if (lower.includes('4932') || lower.includes('kotak') || lower.includes('@kotak')) {
    account = 'Kotak Mahindra/PhonePe';
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

      // Classification
      const lower = text.toLowerCase();
      let handledCategory = null;
      let summaryText = null;

      const isGym = lower.includes('gym') || lower.includes('workout') || (lower.includes('kg') && lower.includes('weight'));
      const isShift = lower.includes('shift') || lower.includes('roster') || lower.includes('attendance');
      const isTask = lower.includes('karna hai') || lower.includes('reminder') || lower.includes('call karna') ||
                     lower.includes('check karna') || lower.includes('pending') || lower.includes('task') || lower.includes('change karna');

      if (isGym) {
        handledCategory = '🏋️‍♂️ Gym Tracker';
        summaryText = `Logged workout in Gym Tracker: "${text}"`;
      } else if (isShift) {
        handledCategory = '📝 Note / Other';
        summaryText = `Saved Shift Roster note: "${text}"`;
      } else if (isTask) {
        const cleanTitle = text.replace(/^(task|pending|reminder)\s*[:\-]\s*/i, '').trim();
        const kaamProps = {
          Name: { title: [{ text: { content: cleanTitle } }] },
          Status: { select: { name: '⏳ Pending' } },
          'Today Date': { date: { start: getTodayIST() } }
        };
        let updated = false;
        if (syncedId) {
          try {
            const patchRes = await notionReq(`/v1/pages/${syncedId}`, 'PATCH', { properties: kaamProps });
            if (patchRes && !patchRes.error && patchRes.id) updated = true;
          } catch (e) { updated = false; }
        }
        if (!updated) {
          const newKaam = await notionReq('/v1/pages', 'POST', { parent: { database_id: DB_KAAM }, properties: kaamProps });
          syncedId = newKaam?.id;
        }
        handledCategory = '📋 Kaam Tracker';
        summaryText = `Added pending task to Kaam Tracker: "${cleanTitle}"`;
      } else {
        // Daily Expense
        // SAFETY FIRST: If an image is attached, DO NOT blindly create a Daily Expense row unless OCR succeeded with a verified date AND amount!
        if (hasImages && (!ocrParsed?.amount || !ocrParsed?.date)) {
          handledCategory = '📝 Note / Other';
          summaryText = `Receipt photo saved. OCR verification pending or manual check needed (prevented dummy expense).`;
        } else {
          let amount = ocrParsed?.amount;
          if (!amount) {
            // Explicit currency match FIRST
            const curMatch = text.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)/i) ||
                             text.match(/([\d,]+(?:\.\d+)?)\s*(?:rs|rupaye|rupees|inr)\b/i);
            if (curMatch) {
              amount = parseFloat(curMatch[1].replace(/,/g, ''));
            } else {
              // Only if text contains explicit expense intent keywords
              const hasExpenseKeyword = lower.includes('kharch') || lower.includes('spent') || lower.includes('diya') ||
                                        lower.includes('liya') || lower.includes('paid') || lower.includes('chai') ||
                                        lower.includes('fal') || lower.includes('petrol') || lower.includes('auto') ||
                                        lower.includes('rapido') || lower.includes('rent') || lower.includes('food') ||
                                        lower.includes('nashta') || lower.includes('breakfast') || lower.includes('lunch') ||
                                        lower.includes('dinner') || lower.includes('shopping') || lower.includes('recharge') ||
                                        lower.includes('bill');
              if (hasExpenseKeyword) {
                const sanitizedForNum = text
                  .replace(/\b(?:5g|4g|3g|nova\s*\d+|iphone\s*\d+|s\d+|a\d+|step\s*\d+)\b/gi, '')
                  .replace(/\b\d{6,}\b/g, ''); // ignore OTPs/Pincodes
                const numMatch = sanitizedForNum.match(/\b(\d+(?:,\d+)*(?:\.\d+)?)\b/);
                if (numMatch) {
                  const val = parseFloat(numMatch[1].replace(/,/g, ''));
                  if (val > 0 && val < 100000) amount = val;
                }
              }
            }
          }

          if (amount && amount > 0) {
            let cleanName = text
              .replace(/(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?/gi, '')
              .replace(/[\d,]+(?:\.\d+)?\s*(?:rs|rupaye|rupees|inr)/gi, '')
              .replace(/\b(kotak|sbi|state bank|cash|phonepe|gpay|paytm|debit card|debit|credit|account|spent|kharcha|diya|liya|paid|bhai|aaj|pe|se|ko|add|kardo|kar do|daily|expensive|expenses|entry)\b/gi, '')
              .trim();

            if ((!cleanName || cleanName.length < 2) && ocrParsed?.paidTo) {
              cleanName = ocrParsed.paidTo;
            } else if (!cleanName || cleanName.length < 2) {
              cleanName = (ocrParsed?.category && ocrParsed.category !== '🍜 Food Bill') ? ocrParsed.category : (text || 'Daily Expense');
            }
            cleanName = toTitleCase(cleanName);

            // Safe Date: If OCR date and time available, use exact ISO datetime!
            let targetDate = null;
            if (ocrParsed?.date && ocrParsed?.time) {
              targetDate = `${ocrParsed.date}T${convert12to24(ocrParsed.time)}.000+05:30`;
            } else if (ocrParsed?.date) {
              targetDate = ocrParsed.date;
            } else {
              const cd = page.created_time ? new Date(page.created_time) : new Date();
              const ist = new Date(cd.getTime() + (5.5 * 60 * 60 * 1000));
              targetDate = ist.toISOString().split('T')[0];
            }

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

          let expUpdated = false;
          if (syncedId) {
            try {
              const patchRes = await notionReq(`/v1/pages/${syncedId}`, 'PATCH', { properties: expProps });
              if (patchRes && !patchRes.error && patchRes.id) expUpdated = true;
            } catch (e) { expUpdated = false; }
          }
          if (!expUpdated) {
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
// -------------------------------------------------------------
// 6. Telegram Bot Integration & Smart Assistant Engine
// -------------------------------------------------------------
const KNOWLEDGE_VAULT = {
  sbi: `🏦 *State Bank of India (SBI Siruguppa)*\n\n` +
       `• *Account Holder:* S A Mohammed Awese\n` +
       `• *Account No:* \`62378030320\`\n` +
       `• *IFSC Code:* \`SBIN0040119\`\n` +
       `• *Branch:* Siruguppa, Ballari\n` +
       `• *PhonePe / Mobile:* \`8123912392\`\n` +
       `• *UPI ID:* \`8123912392@ybl\`\n\n` +
       `📋 *Ready to Copy:* \`62378030320\``,

  kotak: `🏦 *Kotak Mahindra Bank (Kotak 811 Online)*\n\n` +
         `• *Account Holder:* S A Mohammed Awese\n` +
         `• *Account No:* \`5449154932\`\n` +
         `• *IFSC Code:* \`KKBK0008296\`\n` +
         `• *PhonePe / Mobile:* \`8123912392\`\n` +
         `• *UPI ID:* \`8123912392@kotak811\`\n\n` +
         `📋 *Ready to Copy:* \`5449154932\``,

  allBanks: `🏦 *Awais Bank Accounts Vault:*\n\n` +
            `1️⃣ *State Bank of India (SBI):*\n` +
            `• A/C: \`62378030320\`\n` +
            `• IFSC: \`SBIN0040119\`\n` +
            `• UPI: \`8123912392@ybl\`\n\n` +
            `2️⃣ *Kotak Mahindra Bank (811):*\n` +
            `• A/C: \`5449154932\`\n` +
            `• IFSC: \`KKBK0008296\`\n` +
            `• UPI: \`8123912392@kotak811\``,

  voter: `🗳️ *Family Voter IDs (EPIC Numbers):*\n\n` +
         `• *Mohammed Awese (Awais):* \`UBB2822708\`\n` +
         `  Form 8 Ref: \`S10092O8C2909261200065\` (Address: 141 A Desanur)\n\n` +
         `• *Abba (Mehaboob Basha):* \`UBB1404151\` (Approved & Active)\n\n` +
         `• *Mahammad Athif (Atif):* \`UBB3353083\`\n` +
         `  Form 8 Ref: \`S10092O8C1610261200021\` (Mobile 7619574514 linked)\n\n` +
         `📍 *Address:* 141 A, Near Jamiya Masjeed, Ward No 2, Desanur, Siruguppa, Ballari - 583121`,

  passwords: `🔑 *Quick Passcodes & Wi-Fi Vault:*\n\n` +
             `• *Laptop Screen Lock:* \`552552\`\n` +
             `• *MS OneNote Password:* \`552552\`\n` +
             `• *Anvi Folder Locker:* \`552552\`\n` +
             `• *Signal App PIN:* \`552552\`\n\n` +
             `🌐 *Wi-Fi Passwords:*\n` +
             `• *Bangalore PG Wi-Fi:* \`7204572981\`\n` +
             `• *Ghansoli PG Wi-Fi:* \`9167982677\``,

  epfo: `📝 *EPFO / PF Details:*\n\n` +
        `• *UAN Number:* \`101380566434\`\n` +
        `• *UAN Password:* \`MDawais123@@\`\n` +
        `• *Grievance Reg No:* \`DELWE/E/2026/05154\`\n` +
        `• *Registration No:* \`DLCPM260250164900\``,

  gaon: `🏡 *Gaon Trip Plan (31-Oct to 03-Nov 2026 - 4 Din Chutti):*\n\n` +
        `🚆 *1. Tatkal Train Booking (30-Oct-2026):*\n` +
        `• AC Tatkal opens: *10:00 AM*\n` +
        `• Sleeper Tatkal opens: *11:00 AM* (Thane to Adoni)\n\n` +
        `🎯 *2. Gaon Pahunchne Ke Baad Wale Kaam:*\n` +
        `• 📱 *Sabse Pehle:* Abba ke mobile me "English to Kannada translate wala app" install & setup karna.\n` +
        `• 🏦 *Bank Work (20 Mins):* Indian Bank Siruguppa jakar naya ATM card lena (Sirf Abba ke signature chahiye).\n` +
        `• 📄 Atif ka color digital Voter ID PDF download karna (UBB3353083).\n` +
        `• 🚰 Desanur ghar borewell ka estimation confirm karna.\n` +
        `• 👥 Doston se milna: Sohail, Vivekananda, Khalandar.`,

  shadi: `💍 *Shaadi (Wedding) Mehman & Invitation Master List:*\n\n` +
         `⭐ *VIP / Special Friends:*\n` +
         `• *Shalu bhai sim wale (Siruguppa)*\n` +
         `  ⚠️ *Important Note:* Engagement me nahi bulaya tha to naraz hue the. Shaadi me 100% zaroor invite karna hai aur card personally dena hai taaki dil saaf ho sake!\n` +
         `• Close Friends: Sohail, Vivekananda, Khalandar\n\n` +
         `✅ Ye record Notion ke "💍 Shaadi Master Plan" page me safely added hai!`
};

async function handleSmartAssistant(text) {
  const lower = (text || '').toLowerCase().trim();

  // 1. GAON PLAN & TASKS
  if (lower.includes('gaon') || lower.includes('goau') || lower.includes('chutti') || lower.includes('trip') || lower.includes('desanur')) {
    return KNOWLEDGE_VAULT.gaon;
  }

  // 2. TATKAL TICKET
  if (lower.includes('tatkal') || lower.includes('train') || lower.includes('irctc') || lower.includes('ticket')) {
    return `🚆 *Tatkal Train Ticket Booking Details (Thane to Adoni):*\n\n` +
           `• *Journey Date:* 31-Oct-2026 (Gaon Trip)\n` +
           `• *Booking Date:* *30-Oct-2026* (Kal parso)\n` +
           `• *AC Tatkal:* 10:00 AM sharp\n` +
           `• *Sleeper Tatkal:* 11:00 AM sharp\n` +
           `• IRCTC User: MDawais (PIN: 5525) / mdawais (Aadhaar linked 24-ticket enable)\n\n` +
           `⏰ Kaam Tracker me reminder set hai 30-Oct 09:50 AM ka!`;
  }

  // 3. SHALU BHAI & SHADI INVITATION
  if (lower.includes('shalu') || lower.includes('shadi') || lower.includes('wedding') || lower.includes('mehman') || lower.includes('invite') || lower.includes('engagement')) {
    if (lower.includes('call') || lower.includes('sim') || lower.includes('kal')) {
      return `📞 *Shalu Bhai Call Reminder (Kaam Tracker):*\n\n` +
             `• *Time:* Kal Subha *11:05 AM* (28-Oct-2026)\n` +
             `• *Topic:* New SIM regarding follow-up\n` +
             `• *Special Note:* Shaadi me zaroor invite karna hai (Engagement me miss hone par naraz the).\n\n` +
             `⏰ Reminder Kaam Tracker me successfully saved hai!`;
    }
    return KNOWLEDGE_VAULT.shadi;
  }

  // 4. BANK DETAILS
  if (lower.includes('sbi') || (lower.includes('bank') && (lower.includes('state') || lower.includes('detail') || lower.includes('khata') || lower.includes('account')) && !lower.includes('kotak') && !lower.includes('indian'))) {
    if (lower.includes('kotak') || lower.includes('sab') || lower.includes('dono')) {
      return KNOWLEDGE_VAULT.allBanks;
    }
    return KNOWLEDGE_VAULT.sbi;
  }
  if (lower.includes('kotak') || lower.includes('811')) {
    return KNOWLEDGE_VAULT.kotak;
  }
  if (lower.includes('indian bank') || lower.includes('atm')) {
    return `🏦 *Indian Bank ATM Card Work (Siruguppa):*\n\n` +
           `• *Task:* Indian Bank Siruguppa branch jakar naya ATM card lena\n` +
           `• *Duration:* Sirf 20 minute ka work\n` +
           `• *Requirement:* Abba ke signature hone hain\n` +
           `• *Status:* ⏳ Pending (Gaon jaane ke baad karna hai)`;
  }
  if ((lower.includes('bank') && lower.includes('account')) || lower.includes('khata') || lower.includes('paisa bhejna') || lower.includes('bank details')) {
    return KNOWLEDGE_VAULT.allBanks;
  }

  // 5. VOTER ID & OFFICIAL DOCUMENTS
  if (lower.includes('voter') || lower.includes('epic') || lower.includes('form 8') || lower.includes('pan card') || lower.includes('aadhaar') || lower.includes('address')) {
    return KNOWLEDGE_VAULT.voter;
  }

  // 6. PASSWORDS & WIFI
  if (lower.includes('wifi') || lower.includes('wi-fi') || lower.includes('password') || lower.includes('screen lock') || lower.includes('pin') || lower.includes('locker')) {
    return KNOWLEDGE_VAULT.passwords;
  }

  // 7. EPFO & PF
  if (lower.includes('pf') || lower.includes('epfo') || lower.includes('uan')) {
    return KNOWLEDGE_VAULT.epfo;
  }

  // 8. AXIS BANK TASK
  if (lower.includes('axis')) {
    return `🏦 *Abba Axis Bank Task (Kaam Tracker):*\n\n` +
           `• *Task:* Abba ka Axis Bank ka details nikalo\n` +
           `• *Status:* ⏳ Pending\n` +
           `• *Date:* 2026-10-27\n\n` +
           `✅ Ye task *📋 Kaam Tracker* me pending state me saved hai!`;
  }

  // 9. PENDING KAAM / TASKS QUESTION
  if (lower.includes('pending') || lower.includes('kaam') || lower.includes('task') || lower.includes('todo')) {
    const res = await notionReq(`/v1/databases/${DB_KAAM}/query`, 'POST', {
      filter: { property: 'Status', select: { equals: '⏳ Pending' } },
      page_size: 10
    });
    const tasks = (res.results || []).map((r, i) => {
      const title = r.properties.Name?.title?.[0]?.plain_text || 'Untitled';
      const dt = r.properties['Today Date']?.date?.start || '';
      return `${i + 1}. ⏳ *${title}* ${dt ? '(' + dt + ')' : ''}`;
    });
    return `📋 *Kaam Tracker me Active Pending Tasks:*\n\n${tasks.length ? tasks.join('\n\n') : '🎉 Sabhi kaam complete hain!'}`;
  }

  // 10. TODAY'S KHARCHA
  if (lower.includes('kharcha') || lower.includes('today') || lower.includes('aaj') || lower.includes('expense')) {
    const today = getTodayIST();
    const expRes = await notionReq(`/v1/databases/${DB_EXPENSES}/query`, 'POST', {
      filter: { property: 'Date', date: { on_or_after: today } },
      sorts: [{ property: 'Date', direction: 'descending' }]
    });
    let total = 0;
    const items = (expRes.results || []).map(r => {
      const amt = r.properties?.['Amount (₹)']?.number || 0;
      const name = r.properties?.Name?.title?.[0]?.plain_text || 'Expense';
      const cat = r.properties?.Category?.select?.name || '';
      total += amt;
      return `• *₹${amt}* — ${name} (${cat})`;
    });
    return `📊 *Aaj ka Kharcha (${today}):*\n\n${items.join('\n') || 'Aaj abhi tak koi kharcha add nahi hua hai.'}\n\n💰 *Total Kharcha:* ₹${total.toFixed(2)}`;
  }

  // 11. RECHARGE QUESTION
  if (lower.includes('recharge')) {
    const res = await notionReq(`/v1/databases/${DB_EXPENSES}/query`, 'POST', {
      filter: { property: 'Category', select: { equals: '📱 Mobile Recharge' } },
      sorts: [{ property: 'Date', direction: 'descending' }],
      page_size: 5
    });
    const list = (res.results || []).map(r => {
      const amt = r.properties?.['Amount (₹)']?.number || 0;
      const name = r.properties?.Name?.title?.[0]?.plain_text || 'Recharge';
      const d = (r.properties?.Date?.date?.start || '').split('T')[0];
      return `• *₹${amt}* — ${name} (${d})`;
    });
    return `📱 *Recent Recharges:*\n\n${list.join('\n') || 'Koi recharge record nahi mila!'}`;
  }

  // 12. SALARY
  if (lower.includes('salary') || lower.includes('kamai')) {
    return `💼 *Bharti Airtel Salary Records:*\n\n` +
           `• *Monthly Salary:* ₹20,000+ (Credited to SBI)\n` +
           `• *Night Allowance:* ₹1,350 (Credited 21-Oct to SBI)\n` +
           `• Official reimbursement (DTH ₹1,800) pending claim in Kaam Tracker.`;
  }

  // 13. EXPLICIT ADD COMMANDS
  if (lower.startsWith('add task:') || lower.startsWith('task:') || lower.startsWith('kaam:')) {
    const clean = text.replace(/^(add task:|task:|kaam:)\s*/i, '').trim();
    if (clean) {
      await notionReq('/v1/pages', 'POST', {
        parent: { database_id: DB_KAAM },
        properties: {
          Name: { title: [{ text: { content: clean } }] },
          Status: { select: { name: '⏳ Pending' } },
          'Today Date': { date: { start: getTodayIST() } }
        }
      });
      return `✅ *Naya Task Add Ho Gaya Kaam Tracker me:*\n\n⏳ "${clean}"`;
    }
  }

  // 14. GENERAL NOTION EXPENSE SEARCH
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

  // 15. IF USER WANTS TO SAVE AS NOTE
  if (!lower.includes('?') && !lower.includes('batao') && !lower.includes('kya') && !lower.includes('kaise')) {
    await notionReq('/v1/pages', 'POST', {
      parent: { database_id: DB_CAPTURE },
      properties: {
        'Note / Baat': { title: [{ text: { content: text } }] },
        'Status': { select: { name: '⏳ New' } }
      }
    });
    return `✅ Quick Capture me add ho gaya: "${text}". Auto-sync ise turant process kar raha hai!`;
  }

  // DEFAULT
  return `🤖 *Awais Smart Assistant:*\n\n` +
         `Aap mujhse kabhi bhi pooch sakte hain:\n` +
         `• 🏡 *"Gaon plan"* ya *"Tatkal ticket"*\n` +
         `• 💍 *"Shaadi guest list"* ya *"Shalu bhai call"*\n` +
         `• 🏦 *"SBI bank details"* ya *"Kotak details"*\n` +
         `• 📋 *"Pending kaam"* ya *"Tasks"*\n` +
         `• 💰 *"Aaj ka kharcha"* ya *"Recharges"*\n` +
         `• 🗳️ *"Voter ID"* ya *"Family Address"*\n` +
         `• 🔑 *"Wi-Fi password"* ya *"Laptop PIN"*`;
}

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
    if (data) req.write(data);
    req.end();
  });
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
              text: `👋 Assalamu Alaikum Awais Bhai! Main aapka 24/7 Smart Notion Assistant hu.\n\nAap mujhse kisi bhi waqt sawaal pooch sakte hain:\n🏡 "Gaon plan" ya "Tatkal ticket"\n💍 "Shaadi guest list" ya "Shalu bhai call"\n🏦 "SBI bank details" ya "Kotak account"\n📋 "Pending kaam"\n💰 "Aaj ka kharcha"\n🗳️ "Voter ID"\n🔑 "Wi-Fi password"\n\nAapka laptop band ho to bhi ye cloud me 24/7 chalta rahega!`
            });
          } else if (text) {
            const reply = await handleSmartAssistant(text);
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

// -------------------------------------------------------------
// 7. Mobile Web Assistant & HTTP Server
// -------------------------------------------------------------
function getWebUIHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Awais Pocket Brain ⚡</title>
  <meta name="theme-color" content="#0f172a">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #0f172a; color: #f8fafc; min-height: 100vh; padding: 16px; padding-bottom: 80px; }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #1e293b; }
    .title { font-size: 20px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
    .badge { background: #059669; color: #fff; font-size: 11px; padding: 3px 8px; border-radius: 12px; font-weight: 600; }
    
    .search-box { position: relative; margin-bottom: 20px; }
    .search-input { width: 100%; background: #1e293b; border: 1px solid #334155; color: #fff; padding: 14px 44px 14px 16px; border-radius: 12px; font-size: 15px; outline: none; transition: border-color 0.2s; }
    .search-input:focus { border-color: #38bdf8; }
    .search-btn { position: absolute; right: 8px; top: 8px; bottom: 8px; width: 36px; background: #38bdf8; border: none; border-radius: 8px; color: #0f172a; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    
    .section-title { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; font-weight: 600; margin-bottom: 10px; }
    .quick-chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 12px; margin-bottom: 20px; scrollbar-width: none; }
    .quick-chips::-webkit-scrollbar { display: none; }
    .chip { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; padding: 8px 14px; border-radius: 20px; font-size: 13px; white-space: nowrap; cursor: pointer; display: flex; align-items: center; gap: 6px; }
    .chip:active { background: #334155; }
    
    .cards-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 14px; cursor: pointer; transition: transform 0.1s, border-color 0.2s; position: relative; }
    .card:active { transform: scale(0.98); border-color: #38bdf8; }
    .card-icon { font-size: 24px; margin-bottom: 8px; }
    .card-name { font-size: 14px; font-weight: 600; color: #f1f5f9; }
    .card-sub { font-size: 12px; color: #94a3b8; margin-top: 2px; }
    .copy-tag { position: absolute; right: 10px; top: 10px; font-size: 10px; background: #334155; color: #38bdf8; padding: 2px 6px; border-radius: 6px; }

    .result-card { background: #1e293b; border: 1px solid #38bdf8; border-radius: 14px; padding: 16px; margin-bottom: 24px; display: none; }
    .result-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 12px; color: #38bdf8; font-weight: 600; }
    .result-body { font-size: 14px; line-height: 1.6; white-space: pre-wrap; color: #f8fafc; word-break: break-word; }

    .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #10b981; color: #fff; padding: 10px 20px; border-radius: 24px; font-size: 13px; font-weight: 600; box-shadow: 0 10px 25px rgba(0,0,0,0.5); display: none; z-index: 999; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title"><span>⚡</span> Awais Pocket Brain</div>
    <div class="badge">ONLINE 24/7</div>
  </div>

  <div class="search-box">
    <input type="text" id="queryInput" class="search-input" placeholder="Poochho: Gaon plan, SBI details, Shalu call, Tatkal..." />
    <button class="search-btn" onclick="sendQuery()">➔</button>
  </div>

  <div class="quick-chips">
    <div class="chip" onclick="askQuick('gaon plan')">🏡 Gaon Plan (31-Oct)</div>
    <div class="chip" onclick="askQuick('tatkal ticket booking')">🚆 Tatkal Booking</div>
    <div class="chip" onclick="askQuick('shalu bhai call reminder')">📞 Shalu Call (11:05 AM)</div>
    <div class="chip" onclick="askQuick('shaadi invitation guest list')">💍 Shaadi Guest List</div>
    <div class="chip" onclick="askQuick('mere sbi bank ka sara details dedo')">🏦 SBI Details</div>
    <div class="chip" onclick="askQuick('kotak account no batao')">🏦 Kotak Bank</div>
    <div class="chip" onclick="askQuick('pending kaam dikhao')">📋 Pending Kaam</div>
    <div class="chip" onclick="askQuick('aaj ka kharcha kitna hua')">💰 Aaj ka Kharcha</div>
    <div class="chip" onclick="askQuick('voter id details')">🗳️ Voter IDs</div>
    <div class="chip" onclick="askQuick('wifi password kya hai')">🔑 Wi-Fi & PINs</div>
  </div>

  <div class="result-card" id="resultCard">
    <div class="result-header">
      <span>AI ASSISTANT JAWAB:</span>
      <span onclick="closeResult()" style="cursor:pointer; color:#ef4444;">✕ Close</span>
    </div>
    <div class="result-body" id="resultBody"></div>
  </div>

  <div class="section-title">⚡ Instant Bank Details (1-Tap Copy)</div>
  <div class="cards-grid">
    <div class="card" onclick="copyText('62378030320', 'SBI A/C: 62378030320')">
      <div class="copy-tag">Copy A/C</div>
      <div class="card-icon">🔵</div>
      <div class="card-name">SBI Siruguppa</div>
      <div class="card-sub">62378030320</div>
      <div class="card-sub" style="color:#64748b; font-size:11px;">IFSC: SBIN0040119</div>
    </div>
    <div class="card" onclick="copyText('5449154932', 'Kotak A/C: 5449154932')">
      <div class="copy-tag">Copy A/C</div>
      <div class="card-icon">🔴</div>
      <div class="card-name">Kotak 811</div>
      <div class="card-sub">5449154932</div>
      <div class="card-sub" style="color:#64748b; font-size:11px;">IFSC: KKBK0008296</div>
    </div>
    <div class="card" onclick="copyText('8123912392@ybl', 'UPI: 8123912392@ybl')">
      <div class="copy-tag">Copy UPI</div>
      <div class="card-icon">📱</div>
      <div class="card-name">PhonePe / UPI</div>
      <div class="card-sub">8123912392@ybl</div>
      <div class="card-sub" style="color:#64748b; font-size:11px;">SBI linked</div>
    </div>
    <div class="card" onclick="copyText('552552', 'PIN: 552552')">
      <div class="copy-tag">Copy PIN</div>
      <div class="card-icon">🔑</div>
      <div class="card-name">Device Passcode</div>
      <div class="card-sub">552552</div>
      <div class="card-sub" style="color:#64748b; font-size:11px;">Laptop/OneNote/Locker</div>
    </div>
  </div>

  <div class="toast" id="toast">Copied to clipboard!</div>

  <script>
    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 2000);
    }

    function copyText(val, label) {
      navigator.clipboard.writeText(val).then(() => {
        showToast('✅ ' + (label || 'Copied!'));
      }).catch(() => {
        showToast('Value: ' + val);
      });
    }

    function askQuick(text) {
      document.getElementById('queryInput').value = text;
      sendQuery();
    }

    function closeResult() {
      document.getElementById('resultCard').style.display = 'none';
    }

    async function sendQuery() {
      const q = document.getElementById('queryInput').value.trim();
      if (!q) return;
      const card = document.getElementById('resultCard');
      const body = document.getElementById('resultBody');
      card.style.display = 'block';
      body.innerText = 'Searching Notion & Vault... ⏳';
      try {
        const res = await fetch('/api/ask?q=' + encodeURIComponent(q));
        const json = await res.json();
        body.innerText = json.answer || 'Koi jawab nahi mila.';
      } catch (e) {
        body.innerText = 'Error querying assistant: ' + e.message;
      }
    }

    document.getElementById('queryInput').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') sendQuery();
    });
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  if (pathname === '/api/ask') {
    let q = urlObj.searchParams.get('q') || '';
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      await new Promise(r => req.on('end', r));
      try {
        const parsed = JSON.parse(body);
        if (parsed.q || parsed.query) q = parsed.q || parsed.query;
      } catch (e) {}
    }
    const answer = await handleSmartAssistant(q);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, query: q, answer: answer }));
    return;
  }

  if (pathname === '/health' || pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ONLINE',
      service: 'Awais 24/7 Pocket Brain & Cloud Agent',
      time: new Date().toISOString(),
      istDate: getTodayIST(),
      laptopRequired: false
    }));
    return;
  }

  // Web UI on root
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(getWebUIHtml());
});

server.listen(PORT, () => {
  console.log(`🚀 [Cloud Worker] Online on port ${PORT}. 24/7 Autonomous Sync & Smart Assistant Active!`);
  
  // Start 20-second Quick Capture Sync loop
  setInterval(runQuickCaptureSync, 20000);
  runQuickCaptureSync(); // Run immediately on start

  // Start Telegram Bot polling
  pollTelegram();

  // Self-ping every 10 minutes to prevent Render free instance from sleeping
  setInterval(() => {
    https.get('https://awais-notion-cloud-agent.onrender.com/health', (res) => {
      console.log(`[Keep-Alive] Pinged self. Status: ${res.statusCode}`);
    }).on('error', (err) => {
      console.log(`[Keep-Alive] Ping error: ${err.message}`);
    });
  }, 10 * 60 * 1000);
});
