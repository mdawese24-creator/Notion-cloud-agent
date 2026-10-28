/**
 * 24/7 Cloud Worker: Notion Quick Capture Sync + Smart Notion Brain Assistant
 * Designed for 100% autonomous operation (Render, Koyeb, Railway, Vercel).
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
const DB_SIM = '3adffc8e-1cba-8196-8758-fe0a4a9f7b56';
const DB_KHATABOOK = '3cbffc8e-1cba-837d-b149-81cc5a36bdf3';
const DB_LOCATION = '3abffc8e-1cba-80c0-9f89-fb1b84dabc1e';

const MONTH_NAMES = {
  '01': 'January', '02': 'February', '03': 'March', '04': 'April',
  '05': 'May', '06': 'June', '07': 'July', '08': 'August',
  '09': 'September', '10': 'October', '11': 'November', '12': 'December'
};

const MONTH_MAP = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12'
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
  return (str || '').toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getTodayIST() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getYesterdayIST() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Format numbers in standard Indian Rupee notation (e.g. ₹1,14,593 or ₹70,341.61)
function formatINR(val) {
  if (val === null || val === undefined || isNaN(val)) return '₹0';
  const num = Number(val);
  const isNeg = num < 0;
  const absNum = Math.abs(num);
  const parts = absNum.toFixed(2).split('.');
  let intPart = parts[0];
  const decPart = parts[1];

  let lastThree = intPart.substring(intPart.length - 3);
  let otherNumbers = intPart.substring(0, intPart.length - 3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const formatted = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
  return `${isNeg ? '-' : ''}₹${formatted}${decPart === '00' ? '' : '.' + decPart}`;
}

// -------------------------------------------------------------
// 1. Notion API Helper
// -------------------------------------------------------------
function notionReq(pathStr, method, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'api.notion.com',
      path: pathStr,
      method: method,
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
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
    req.on('error', (err) => resolve({ error: err.message }));
    if (data) req.write(data);
    req.end();
  });
}

// -------------------------------------------------------------
// 2. Cloud OCR (OCR.space API)
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
          if (parsed.ParsedResults && parsed.ParsedResults.length > 0) {
            return resolve(parsed.ParsedResults[0].ParsedText || '');
          }
        } catch (e) {}
        resolve('');
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

  const txnMatch = ocrText.match(/(?:PhonePe\s*Transaction\s*ID|Txn\s*ID)\s*([A-Za-z0-9]+)/i);
  const txnId = txnMatch ? txnMatch[1] : null;

  const utrMatch = ocrText.match(/UTR:\s*(\d+)/i);
  const utr = utrMatch ? utrMatch[1] : null;

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

  let account = 'Kotak Mahindra/PhonePe';
  if (lower.includes('state bank') || lower.includes('@sbi') || lower.includes('0320') || lower.includes('1055')) {
    account = 'State Bank Of India/PhonePe';
  } else if (lower.includes('4932') || lower.includes('kotak') || lower.includes('@kotak')) {
    account = 'Kotak Mahindra/PhonePe';
  } else if (lower.includes('cash')) {
    account = 'Cash';
  }

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
    subcategory = '🍳 Breakfast';
  } else if (pLower.includes('chai') || pLower.includes('tea') || pLower.includes('coffee')) {
    category = '🍜 Food Bill';
    subcategory = '☕ Chai';
  } else if (pLower.includes('dinner') || pLower.includes('hotel') || pLower.includes('restaurant')) {
    category = '🍜 Food Bill';
    subcategory = '🍽️ Dinner';
  } else if (pLower.includes('recharge') || pLower.includes('airtel') || pLower.includes('jio')) {
    category = '📱 Mobile Recharge';
    subcategory = '📱 Mobile Recharge';
  } else if (pLower.includes('rent') || pLower.includes('room') || pLower.includes('pg')) {
    category = '🏠 Room Rent (tatwal / 149 PG Ghansoli)';
    subcategory = '🏠 Room Rent (tatwal / 149 PG Ghansoli)';
  }

  return { amount, date, time, paidTo, account, category, subcategory, txnId, utr };
}

// -------------------------------------------------------------
// 5. Autonomous Sync Loop (Quick Capture -> Destination Databases)
// -------------------------------------------------------------
async function runQuickCaptureSync() {
  try {
    const res = await notionReq(`/v1/databases/${DB_CAPTURE}/query`, 'POST', {
      filter: { property: 'Status', select: { equals: '⏳ New' } },
      page_size: 10
    });

    if (!res.results || res.results.length === 0) return;

    for (const page of res.results) {
      const pageId = page.id;
      const text = page.properties['Note / Baat']?.title?.[0]?.plain_text || '';
      const files = page.properties['📸 Photo / Bill']?.files || [];
      const hasImages = files.length > 0;
      let syncedId = page.properties['Synced ID']?.rich_text?.[0]?.plain_text || null;

      let ocrText = '';
      if (hasImages) {
        const rawFileUrl = files[0].file?.url || files[0].external?.url;
        if (rawFileUrl) {
          ocrText = await ocrImageUrl(rawFileUrl);
        }
      }

      const ocrParsed = parseReceiptDetails(text, ocrText, page.created_time);
      const lower = (text + ' ' + ocrText).toLowerCase();

      let handledCategory = '📝 Note / Other';
      let summaryText = `Saved in Quick Capture`;

      const isGym = lower.includes('gym') || lower.includes('workout') || lower.includes('exercise') || lower.includes('attendance');
      const isShift = lower.includes('shift') || lower.includes('roster') || lower.includes('duty');
      const isTask = lower.includes('task') || lower.includes('pending') || lower.includes('reminder') ||
                     lower.includes('karna hai') || lower.includes('call karna') || lower.includes('jana hai') ||
                     lower.includes('apply') || lower.includes('download') || lower.includes('bhejna hai');

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
        if (hasImages && (!ocrParsed?.amount || !ocrParsed?.date)) {
          handledCategory = '📝 Note / Other';
          summaryText = `Receipt photo saved. OCR verification pending or manual check needed (prevented dummy expense).`;
        } else {
          let amount = ocrParsed?.amount;
          if (!amount) {
            const curMatch = text.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)/i) ||
                             text.match(/([\d,]+(?:\.\d+)?)\s*(?:rs|rupaye|rupees|inr)\b/i);
            if (curMatch) {
              amount = parseFloat(curMatch[1].replace(/,/g, ''));
            } else {
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
                  .replace(/\b\d{6,}\b/g, '');
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

            let updated = false;
            if (syncedId) {
              try {
                const patchRes = await notionReq(`/v1/pages/${syncedId}`, 'PATCH', { properties: expProps });
                if (patchRes && !patchRes.error && patchRes.id) updated = true;
              } catch (e) { updated = false; }
            }
            if (!updated) {
              const newExp = await notionReq('/v1/pages', 'POST', { parent: { database_id: DB_EXPENSES }, properties: expProps });
              syncedId = newExp?.id;
            }
            handledCategory = '💰 Daily Expenses';
            summaryText = `Added to Daily Expenses: ${formatINR(amount)} (${cleanName}) on ${targetDate.split('T')[0]} via ${targetAccount.split('/')[0]}`;
          }
        }
      }

      await notionReq(`/v1/pages/${pageId}`, 'PATCH', {
        properties: {
          'Status': { select: { name: '✅ Processed' } },
          'Category / Moved To': { select: { name: handledCategory } },
          'Action Summary': { rich_text: [{ text: { content: summaryText } }] },
          ...(syncedId ? { 'Synced ID': { rich_text: [{ text: { content: syncedId } }] } } : {})
        }
      });
      console.log(`[Cloud Sync] ✅ Processed: "${text.substring(0, 30)}" -> ${handledCategory} (${syncedId})`);
    }
  } catch (err) {
    console.error('[Cloud Sync Loop Error]', err.message);
  }
}

// -------------------------------------------------------------
// 6. Master Knowledge Vault & Ultra-Smart Semantic Engine
// -------------------------------------------------------------
const KNOWLEDGE_VAULT = {
  address: `🏠 *Official House Address (Desanur - Notion Vault):*\n\n` +
           `• *House No:* \`141 A\`\n` +
           `• *Ward:* Ward No 2\n` +
           `• *Landmark:* Near Jamiya Masjeed\n` +
           `• *Village / Town:* Desanur, Siruguppa Taluk\n` +
           `• *District:* Ballari, Karnataka\n` +
           `• *Pincode:* \`583121\`\n\n` +
           `📋 *Family Voter IDs (EPIC Numbers):*\n` +
           `• *Mohammed Awese (Awais):* \`UBB2822708\` (Form 8 Ref: S10092O8C2909261200065)\n` +
           `• *Abba (Mehaboob Basha):* \`UBB1404151\` (Approved & Active)\n` +
           `• *Ammi (Reshma Banu):* \`MZS1351410\` (Part 57, Serial 445)\n` +
           `• *Mahammad Athif (Atif):* \`UBB3353083\` (Mobile 7619574514 linked)\n\n` +
           `💡 *Tip:* Dukan ka address janne ke liye poochhein: "Dukan ka address"`,

  dukanAddress: `🪑 *Dukan (Shop) Official Address — Tuba Furniture:*\n\n` +
                `• *Shop Name:* \`Tuba Furniture\` (Siruguppa)\n` +
                `• *Address:* Boy's Hostel, Near Tipu Sultan Circle, Sindhanur Main Road, Siruguppa, Ballari District, Karnataka - 583121\n` +
                `• *Google Maps:* https://maps.app.goo.gl/iPJiaHeayK4iThj98\n` +
                `• *Shop Wi-Fi:* \`8618504406\` (Password: \`9916022600\`)\n` +
                `• *CCTV App:* \`gCMOB\` (Password: \`admin@1234\`)\n` +
                `• *Contact Numbers:* \`9945161755\` / \`9591395554\``,

  ammiKYC: `🧕 *Ammi (Reshma Banu) Official Golden KYC & Identity:*\n\n` +
           `• *Full Name:* Reshma Banu\n` +
           `• *Voter ID (EPIC):* \`MZS1351410\`\n` +
           `• *Aadhaar No:* \`9461 9458 9503\`\n` +
           `• *PAN Card:* \`GOWPR0751B\` (100% Active & Linked ✅)\n` +
           `• *Mobile Number:* \`6363498692\`\n` +
           `• *Date of Birth:* \`01/01/1975\`\n` +
           `• *Voter Serial / Part:* Part 57, Serial 445\n` +
           `• *Address:* House No 141 A, Near Jamiya Masjeed, Desanur - 583121\n\n` +
           `📋 *Ready to Copy EPIC:* \`MZS1351410\``,

  familyKYC: `📋 *Family Golden KYC & Voter Records:*\n\n` +
             `1️⃣ *Mohammed Awese (Awais):*\n` +
             `• Voter ID (EPIC): \`UBB2822708\` (Form 8 Ref: S10092O8C2909261200065)\n` +
             `• Aadhaar No: \`7694 5296 4584\`\n` +
             `• PAN Card: \`DHWPM9916F\`\n` +
             `• Mobile: \`8123912392\`\n\n` +
             `2️⃣ *Abba (Mehaboob Basha):*\n` +
             `• Voter ID (EPIC): \`UBB1404151\`\n` +
             `• Aadhaar (Last 4): \`5595\`\n` +
             `• Mobile: \`9945161755\` | UPI PIN: \`9945\`\n\n` +
             `3️⃣ *Ammi (Reshma Banu):*\n` +
             `• Voter ID (EPIC): \`MZS1351410\`\n` +
             `• Aadhaar No: \`9461 9458 9503\`\n` +
             `• PAN Card: \`GOWPR0751B\`\n` +
             `• Mobile: \`6363498692\` | DOB: \`01/01/1975\`\n\n` +
             `4️⃣ *Mahammad Athif (Atif):*\n` +
             `• Voter ID (EPIC): \`UBB3353083\`\n` +
             `• Aadhaar: \`6687 0862 2572\`\n` +
             `• PAN Card: \`DYMPA6781D\`\n` +
             `• Mobile: \`7619574514\``,

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

  indianBank: `🏦 *Indian Bank (Siruguppa Branch) — Abba (Mehaboob Basha)*\n\n` +
              `• *Account Holder:* Mehaboob Basha\n` +
              `• *Registered Mobile:* \`9945161755\`\n` +
              `• *UPI PIN:* \`9945\`\n` +
              `• *Branch:* Siruguppa, Ballari\n` +
              `• *ATM Status:* New ATM card lena gaon trip me scheduled hai (20 min work, Abba signature zaroori).`,

  airtelPostpaid: `📱 *Airtel Postpaid SIMs (Abba & Ammi):*\n\n` +
                  `• *Status:* Dono SIM portal me successfully add ho chuke hain aur active hain.\n` +
                  `• *Bill Generation Date:* Har mahine ki *18th* date ko bill aayega.\n` +
                  `• *Auto-Pay Reminder:* Kal sham *5:00 PM (28-Oct-2026)* ka reminder Kaam Tracker me set hai!`,

  allBanks: `🏦 *Family Bank Accounts Vault:*\n\n` +
            `1️⃣ *State Bank of India (SBI Siruguppa) — Awais:*\n` +
            `• A/C: \`62378030320\`\n` +
            `• IFSC: \`SBIN0040119\`\n` +
            `• UPI: \`8123912392@ybl\`\n\n` +
            `2️⃣ *Kotak Mahindra Bank (811) — Awais:*\n` +
            `• A/C: \`5449154932\`\n` +
            `• IFSC: \`KKBK0008296\`\n` +
            `• UPI: \`8123912392@kotak811\`\n\n` +
            `3️⃣ *Indian Bank (Siruguppa) — Abba (Mehaboob Basha):*\n` +
            `• Mobile: \`9945161755\`\n` +
            `• UPI PIN: \`9945\`\n` +
            `• Branch: Siruguppa`,

  passwords: `🔑 *Quick Passcodes, Logins & Wi-Fi Vault:*\n\n` +
             `• *Amazon (mdawaiskhaji469@gmail.com):* \`MDawais123\`\n` +
             `• *Abba Facebook Username:* \`MehaboobBasha24\`\n` +
             `• *Abba Indian Bank UPI PIN:* \`9945\`\n` +
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

  gaon: `🏡 *Hometown / Native Place Trips Record:*\n\n` +
        `📌 *Latest Completed Visit (Trip 5 — 24 to 26 Oct 2026):*\n` +
        `• *Travel:* 24-Oct raat 9:00 PM train Thane se nikle, 25-Oct gaon stay kiya.\n` +
        `• *Works Done:* Abba ko new 5G mobile ("Ai Nova 2 Ultra") handover kiya, Abba aur Ammi ke ported Airtel postpaid SIMs activate kiye, Abba ka Indian Bank UPI PIN 9945 set kiya.\n` +
        `• *Return:* 25-Oct raat ki train se nikle, 26-Oct morning Mumbai pahunch kar directly Bharti Airtel Second Shift duty attend ki (Zero leave taken!).\n\n` +
        `🎯 *Upcoming Next Visit (Trip 6 — 31-Oct to 03-Nov 2026 - 4 Din Chutti):*\n` +
        `• 🎫 *30-Oct Tatkal Booking:* AC @ 10:00 AM | Sleeper @ 11:00 AM (Thane to Adoni)\n` +
        `• 📱 Abba ke mobile me "English to Kannada translate wala app" install karna.\n` +
        `• 🏦 Indian Bank Siruguppa jakar naya ATM card lena (20 min work).\n` +
        `• 🚰 Desanur ghar borewell ka estimation final karna.\n` +
        `• 👥 Doston se milna: Sohail, Vivekananda, Khalandar.`,

  shadi: `💍 *Shaadi (Wedding) Mehman & Invitation Master List:*\n\n` +
         `⭐ *VIP / Special Friends:*\n` +
         `• *Shalu bhai sim wale (Siruguppa)*\n` +
         `  ⚠️ *Important Note:* Engagement me nahi bulaya tha to naraz hue the. Shaadi me 100% zaroor invite karna hai aur card personally dena hai taaki dil saaf ho sake!\n` +
         `• Close Friends: Sohail, Vivekananda, Khalandar\n\n` +
         `✅ Ye record Notion ke "💍 Shaadi Master Plan" page me safely added hai!`
};

function hasKeyword(str, words) {
  return words.some(w => str.includes(w));
}

async function handleSmartAssistant(rawText) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();

  // Clean string for intent detection
  const normalized = lower
    .replace(/[?,.!:;"']/g, ' ')
    .replace(/\s+/g, ' ');

  // =========================================================
  // 1. NOTE TAKING / QUICK DUMP ("Jo mai bolta hu note taking wale kaam")
  // =========================================================
  if (lower.startsWith('add note:') || lower.startsWith('note:') || lower.startsWith('save note:') || lower.startsWith('likho:')) {
    const clean = text.replace(/^(add note:|note:|save note:|likho:)\s*/i, '').trim();
    if (clean) {
      await notionReq('/v1/pages', 'POST', {
        parent: { database_id: DB_CAPTURE },
        properties: {
          'Note / Baat': { title: [{ text: { content: clean } }] },
          'Status': { select: { name: '✅ Processed' } },
          'Category / Moved To': { select: { name: '📝 Note / Other' } },
          'Action Summary': { rich_text: [{ text: { content: `Saved directly via Assistant` } }] }
        }
      });
      return `📝 *Naya Note Save Ho Gaya (Quick Capture):*\n\n"${clean}"\n\n✅ Notion me permanently save ho chuka hai!`;
    }
  }

  if (hasKeyword(normalized, ['recent note', 'recent notes', 'kya note', 'note dikhao', 'notes dikhao', 'brain dump', 'quick dump', 'maine kya bola tha', 'maine kya likha'])) {
    const qRes = await notionReq(`/v1/databases/${DB_CAPTURE}/query`, 'POST', {
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: 6
    });
    const items = (qRes.results || []).map((r, i) => {
      const note = r.properties?.['Note / Baat']?.title?.[0]?.plain_text || 'Untitled Note';
      const cat = r.properties?.['Category / Moved To']?.select?.name || 'Note';
      const dt = (r.created_time || '').split('T')[0];
      return `${i + 1}. *${note}*\n   📂 [${cat}] • 📅 ${dt}`;
    });
    return `📝 *Recent Notes & Brain Dump Entries:*\n\n${items.join('\n\n') || 'Abhi tak koi note add nahi hua hai.'}\n\n💡 *Tip:* Naya note lene ke liye likhein: "Note: [aapki baat]"`;
  }

  // =========================================================
  // 2. TASK CREATION COMMANDS
  // =========================================================
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
      return `✅ *Naya Task Kaam Tracker Me Add Ho Gaya:*\n\n⏳ "${clean}"\n\n📅 Date: ${getTodayIST()} (Status: Pending)`;
    }
  }

  // =========================================================
  // 3. DUKAN (SHOP) / TUBA FURNITURE ADDRESS
  // =========================================================
  if (hasKeyword(normalized, ['dukan', 'shop', 'tuba', 'furniture', 'store'])) {
    return KNOWLEDGE_VAULT.dukanAddress;
  }

  // =========================================================
  // 3.1 AMMI (RESHMA BANU) KYC & VOTER ID (EPIC)
  // =========================================================
  if (hasKeyword(normalized, ['reshma', 'ammi', 'mummy', 'valida', 'ammi voter', 'epic reshma', 'reshma epic', 'reshma voter'])) {
    return KNOWLEDGE_VAULT.ammiKYC;
  }

  // =========================================================
  // 3.2 FAMILY KYC / VOTER EPIC / AADHAAR / PAN
  // =========================================================
  if (hasKeyword(normalized, ['voter', 'epic', 'form 8', 'aadhaar', 'adhar', 'pan card', 'pan no'])) {
    if (hasKeyword(normalized, ['abba', 'baba', 'mehaboob'])) {
      return `🪪 *Abba (Mehaboob Basha) KYC Details:*\n\n• *Voter ID (EPIC):* \`UBB1404151\`\n• *Aadhaar (Last 4):* \`5595\`\n• *Mobile:* \`9945161755\`\n• *UPI PIN:* \`9945\``;
    }
    if (hasKeyword(normalized, ['atif', 'athif'])) {
      return `🪪 *Mahammad Athif (Atif) KYC Details:*\n\n• *Voter ID (EPIC):* \`UBB3353083\`\n• *Aadhaar:* \`6687 0862 2572\`\n• *PAN Card:* \`DYMPA6781D\`\n• *Mobile:* \`7619574514\``;
    }
    if (hasKeyword(normalized, ['awais', 'awese', 'mera voter', 'my voter', 'mera pan', 'mera aadhaar'])) {
      return `🪪 *Mohammed Awese (Awais) Golden KYC:*\n\n• *Voter ID (EPIC):* \`UBB2822708\` (Form 8 Ref: S10092O8C2909261200065)\n• *Aadhaar No:* \`7694 5296 4584\`\n• *PAN Card:* \`DHWPM9916F\`\n• *Mobile:* \`8123912392\``;
    }
    return KNOWLEDGE_VAULT.familyKYC;
  }

  // =========================================================
  // 3.3 GHAR / HOUSE NO / RESIDENCE ADDRESS
  // =========================================================
  if (hasKeyword(normalized, ['house', 'ghar', 'makan', 'room no', 'pata', 'address', 'pincode', 'pin code', 'ward', 'desanur', 'jamiya', 'masjeed'])) {
    return KNOWLEDGE_VAULT.address;
  }

  // =========================================================
  // 4. AIRTEL POSTPAID & BILL GENERATION (18th Rule)
  // =========================================================
  if (hasKeyword(normalized, ['airtel', 'postpaid', 'bill', 'auto pay', 'autopay'])) {
    return KNOWLEDGE_VAULT.airtelPostpaid;
  }

  // =========================================================
  // 5. GAON TRIP & TATKAL TICKET & IRCTC
  // =========================================================
  if (hasKeyword(normalized, ['tatkal', 'train', 'irctc', 'ticket', 'adoni', 'thane', 'return'])) {
    return `🚆 *IRCTC & Tatkal Train Booking Details (31-Oct se 03-Nov Gaon Trip):*\n\n` +
           `1️⃣ *Going Tatkal (Thane to Adoni — 31-Oct Journey):*\n` +
           `• *Booking Date:* *30-Oct-2026*\n` +
           `• *Sleeper Tatkal:* *11:00 AM sharp* (Reminder set for 10:50 AM)\n` +
           `• *AC Tatkal:* 10:00 AM sharp\n\n` +
           `2️⃣ *Return Tatkal (Adoni to Thane — 03-Nov Journey):*\n` +
           `• *Ticket Planning Reminder:* Kal *28-Oct dopahar 12:00 PM*\n` +
           `• *Actual Tatkal Booking Date:* *02-Nov-2026*\n` +
           `• *Sleeper Tatkal:* *11:00 AM sharp* (Reminder set for 02-Nov 10:50 AM)\n\n` +
           `3️⃣ *IRCTC Accounts:*\n` +
           `• Abba: User ID \`MDawais\` (PIN: 5525) / Mobile \`9945161755\`\n` +
           `• Awais: 30-day cooldown active (Reminder: 27-Nov-2026)`;
  }

  if (hasKeyword(normalized, ['gaon', 'goau', 'trip', 'chutti', '4 din'])) {
    return KNOWLEDGE_VAULT.gaon;
  }

  // =========================================================
  // 6. SHALU BHAI CALL, PRIYANKA KURLA & SHAADI LIST
  // =========================================================
  if (hasKeyword(normalized, ['priyanka', 'kurla'])) {
    return `📞 *Priyanka (Kurla Airtel Store) Call Reminder:*\n\n` +
           `• *Time:* Kal Dopahar *1:00 PM* (28-Oct-2026)\n` +
           `• *Context:* Shalu bhai se subah 11:05 AM baat complete hone ke baad, Kurla Airtel store wali ladki Priyanka se baat/follow-up karna hai.\n\n` +
           `⏰ Reminder Kaam Tracker me successfully saved hai!`;
  }

  if (hasKeyword(normalized, ['shalu', 'shaadi', 'wedding', 'mehman', 'invite', 'engagement'])) {
    if (hasKeyword(normalized, ['call', 'sim', 'kal', 'time', 'reminder'])) {
      return `📞 *Shalu Bhai Call Reminder (Kaam Tracker):*\n\n` +
             `• *Time:* Kal Subha *11:05 AM* (28-Oct-2026)\n` +
             `• *Topic:* New SIM regarding follow-up\n` +
             `• *Special Note:* Shaadi me zaroor invite karna hai (Engagement me miss hone par naraz the).\n\n` +
             `⏰ Reminder Kaam Tracker me successfully saved hai!`;
    }
    return KNOWLEDGE_VAULT.shadi;
  }

  // =========================================================
  // 7. PASSWORDS, LOGINS, WI-FI & SECURITY PINS
  // =========================================================
  if (hasKeyword(normalized, ['facebook', 'fb'])) {
    return `👤 *Abba Facebook Account Details:*\n\n` +
           `• *Username:* \`MehaboobBasha24\`\n` +
           `• *Profile Name:* Mehaboob Basha\n` +
           `• *Email / ID:* \`mehaboobbasha469@gmail.com\`\n` +
           `• *Saved in:* Master Vault (Family Connected Apps)`;
  }

  if (hasKeyword(normalized, ['amazon'])) {
    return `📦 *Amazon Account Credentials:*\n\n` +
           `• *Login Email:* \`mdawaiskhaji469@gmail.com\`\n` +
           `• *New Password:* \`MDawais123\`\n` +
           `• *Updated in:* Notion Credentials Vault DB 2`;
  }

  if (hasKeyword(normalized, ['wifi', 'wi-fi', 'password', 'passcode', 'screen lock', 'screenlock', 'locker', 'signal', 'onenote pin', 'device lock'])) {
    return KNOWLEDGE_VAULT.passwords;
  }

  if (hasKeyword(normalized, ['epfo', 'pf', 'uan'])) {
    return KNOWLEDGE_VAULT.epfo;
  }

  // =========================================================
  // 8. BANK DETAILS & MONEY TRANSFERS
  // =========================================================
  if (hasKeyword(normalized, ['indian bank', 'indian', 'abba bank', 'baba bank', 'abba ka bank'])) {
    return KNOWLEDGE_VAULT.indianBank;
  }
  if (hasKeyword(normalized, ['sbi', 'state bank'])) {
    return KNOWLEDGE_VAULT.sbi;
  }
  if (hasKeyword(normalized, ['kotak', '811'])) {
    return KNOWLEDGE_VAULT.kotak;
  }
  if (hasKeyword(normalized, ['bank', 'khata', 'account no', 'ifsc', 'upi pin', 'upi id', 'paisa bhejna'])) {
    return KNOWLEDGE_VAULT.allBanks;
  }

  // =========================================================
  // 9. EXPENSE, INCOME & FINANCIAL ENGINE (SMART DATE & PERIOD PARSER)
  // =========================================================
  if (hasKeyword(normalized, ['kharch', 'kharcha', 'kharche', 'expense', 'expenses', 'spent', 'food bill', 'total kharcha', 'hisab', 'income', 'salary', 'kamai', 'bachat', 'saving', 'savings'])) {

    // Helper to query expenses by date range and categorize Income vs Expense
    async function fetchFinancialSummary(startDate, endDate) {
      const expRes = await notionReq(`/v1/databases/${DB_EXPENSES}/query`, 'POST', {
        filter: {
          and: [
            { property: 'Date', date: { on_or_after: startDate } },
            { property: 'Date', date: { on_or_before: endDate } }
          ]
        },
        sorts: [{ property: 'Date', direction: 'descending' }],
        page_size: 100
      });
      const records = expRes.results || [];
      let totalIncome = 0;
      let totalExpense = 0;
      const expenseCats = {};
      const incomeCats = {};
      const recentItems = [];

      for (const r of records) {
        const amt = r.properties?.['Amount (₹)']?.number || 0;
        const name = r.properties?.Name?.title?.[0]?.plain_text || 'Transaction';
        const cat = r.properties?.Category?.select?.name || 'Other';
        const d = (r.properties?.Date?.date?.start || '').split('T')[0];
        const type = r.properties?.Type?.select?.name || (cat.toLowerCase().includes('salary') ? 'Income' : 'Expense');

        if (type === 'Income' || cat.toLowerCase().includes('salary')) {
          totalIncome += amt;
          incomeCats[cat] = (incomeCats[cat] || 0) + amt;
        } else {
          totalExpense += amt;
          expenseCats[cat] = (expenseCats[cat] || 0) + amt;
          recentItems.push(`• *${formatINR(amt)}* — ${name} (${cat}, ${d})`);
        }
      }

      return {
        records,
        totalIncome,
        totalExpense,
        netSavings: totalIncome - totalExpense,
        expenseCats,
        incomeCats,
        recentItems
      };
    }

    // 9.1 Last 3 Months Aggregation & Comparison
    if (hasKeyword(normalized, ['last 3', 'pichle 3', 'pichle teen', '3 mahine', '3 mahina', '3 months', 'teen mahine', '3 month'])) {
      const aug = await fetchFinancialSummary('2026-08-01', '2026-08-31');
      const sep = await fetchFinancialSummary('2026-09-01', '2026-09-30');
      const oct = await fetchFinancialSummary('2026-10-01', '2026-10-31');

      const grandIncome = aug.totalIncome + sep.totalIncome + oct.totalIncome;
      const grandExpense = aug.totalExpense + sep.totalExpense + oct.totalExpense;
      const grandSavings = grandIncome - grandExpense;

      return `📊 *Pichle 3 Mahino Ka Financial Breakdown (Aug – Oct 2026):*\n\n` +
             `1️⃣ *August 2026:*\n` +
             `   • 🟢 Total Income: *${formatINR(aug.totalIncome)}*\n` +
             `   • 🔴 Total Kharcha: *${formatINR(aug.totalExpense)}*\n` +
             `   • 💰 Net Savings: *${formatINR(aug.netSavings)}*\n\n` +
             `2️⃣ *September 2026:*\n` +
             `   • 🟢 Total Income: *${formatINR(sep.totalIncome)}*\n` +
             `   • 🔴 Total Kharcha: *${formatINR(sep.totalExpense)}*\n` +
             `   • 💰 Net Savings: *${formatINR(sep.netSavings)}*\n\n` +
             `3️⃣ *October 2026 (Current Month):*\n` +
             `   • 🟢 Total Income: *${formatINR(oct.totalIncome)}*\n` +
             `   • 🔴 Total Kharcha: *${formatINR(oct.totalExpense)}*\n` +
             `   • 💰 Net Savings: *${formatINR(oct.netSavings)}*\n\n` +
             `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
             `🏆 *3-Mahine Ka Grand Total Summary:*\n` +
             `• 🟢 *Total Income (Kamai):* *${formatINR(grandIncome)}*\n` +
             `• 🔴 *Total Kharcha:* *${formatINR(grandExpense)}*\n` +
             `• 💎 *Net Total Bachat (Savings):* *${formatINR(grandSavings)}*`;
    }

    // 9.2 Current Month ("Iss month", "this month", "is mahine", "current month", "october")
    if (hasKeyword(normalized, ['iss month', 'this month', 'is mahine', 'current month', 'is month', 'october', 'oct'])) {
      const data = await fetchFinancialSummary('2026-10-01', '2026-10-31');

      const expBreakdown = Object.entries(data.expenseCats)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, sum]) => `  • ${cat}: *${formatINR(sum)}*`)
        .join('\n');

      const incBreakdown = Object.entries(data.incomeCats)
        .map(([cat, sum]) => `  • ${cat}: *${formatINR(sum)}*`)
        .join('\n') || '  • Koi alag source nahi';

      return `📊 *October 2026 (Current Month) Financial Hisab:*\n\n` +
             `🟢 *Total Income (Kamai / Salary):* *${formatINR(data.totalIncome)}*\n` +
             `🔴 *Total Kharcha (Actual Expenses):* *${formatINR(data.totalExpense)}*\n` +
             `💰 *Net Bachat / Savings:* *${formatINR(data.netSavings)}* (${data.records.length} transactions)\n\n` +
             `📂 *Kharcha Category Breakdown:*\n${expBreakdown}\n\n` +
             `💼 *Income Sources:*\n${incBreakdown}\n\n` +
             `📋 *Recent Transactions:*\n${data.recentItems.slice(0, 8).join('\n')}`;
    }

    // 9.3 Previous Month ("Last month", "pichle mahine", "september")
    if (hasKeyword(normalized, ['last month', 'pichle mahine', 'pichla mahina', 'previous month', 'september', 'sep'])) {
      const data = await fetchFinancialSummary('2026-09-01', '2026-09-30');

      const expBreakdown = Object.entries(data.expenseCats)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, sum]) => `  • ${cat}: *${formatINR(sum)}*`)
        .join('\n');

      return `📊 *September 2026 Financial Hisab:*\n\n` +
             `🟢 *Total Income:* *${formatINR(data.totalIncome)}*\n` +
             `🔴 *Total Kharcha:* *${formatINR(data.totalExpense)}*\n` +
             `💰 *Net Bachat / Savings:* *${formatINR(data.netSavings)}*\n\n` +
             `📂 *Kharcha Categories:*\n${expBreakdown}`;
    }

    // 9.4 Specific named month parser (e.g. "August", "November 2026")
    const monthRegex = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
    const mMatch = lower.match(monthRegex);
    if (mMatch) {
      const monthPrefix = mMatch[1].slice(0, 3).toLowerCase();
      const monthNum = MONTH_MAP[monthPrefix] || '10';
      const yearMatch = lower.match(/\b(202[4-9])\b/);
      const targetYear = yearMatch ? yearMatch[1] : '2026';
      const monthName = MONTH_NAMES[monthNum];

      const daysInMonth = new Date(parseInt(targetYear), parseInt(monthNum), 0).getDate();
      const startDate = `${targetYear}-${monthNum}-01`;
      const endDate = `${targetYear}-${monthNum}-${String(daysInMonth).padStart(2, '0')}`;

      const data = await fetchFinancialSummary(startDate, endDate);
      if (data.records.length === 0) {
        return `📊 *${monthName} ${targetYear} Financial Hisab:*\n\n` +
               `Is mahine me abhi tak koi records nahi hain.\n` +
               (monthNum === '11' && targetYear === '2026' ? `*(November start hone me abhi kuch din baaki hain!)*\n\n` : `\n`) +
               `💡 *Tip:* Agar aap October 2026 ka hisab dekhna chahte hain to "October expenses" ya "Iss month ka kharcha" poochhein!`;
      }

      const expBreakdown = Object.entries(data.expenseCats)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, sum]) => `  • ${cat}: *${formatINR(sum)}*`)
        .join('\n');

      return `📊 *${monthName} ${targetYear} Financial Hisab:*\n\n` +
             `🟢 *Total Income:* *${formatINR(data.totalIncome)}*\n` +
             `🔴 *Total Kharcha:* *${formatINR(data.totalExpense)}*\n` +
             `💰 *Net Bachat / Savings:* *${formatINR(data.netSavings)}*\n\n` +
             `📂 *Kharcha Breakdown:*\n${expBreakdown}`;
    }

    // 9.5 General Income vs Expense Question ("income kitna hai aur expenses kitna hai", "bachat kitni hai")
    if (hasKeyword(normalized, ['income kitna', 'income kitni', 'expenses kitna', 'expense kitna', 'income aur', 'kamai'])) {
      const data = await fetchFinancialSummary('2026-10-01', '2026-10-31');

      const expBreakdown = Object.entries(data.expenseCats)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, sum]) => `  • ${cat}: *${formatINR(sum)}*`)
        .join('\n');

      return `💰 *Income vs Expenses Hisab (October 2026 - Current Month):*\n\n` +
             `🟢 *Total Income (Kamai / Salary):* *${formatINR(data.totalIncome)}*\n` +
             `🔴 *Total Kharcha (Actual Expenses):* *${formatINR(data.totalExpense)}*\n` +
             `💎 *Net Bachat (Savings):* *${formatINR(data.netSavings)}*\n\n` +
             `📂 *Kharcha Category Breakdown:*\n${expBreakdown}\n\n` +
             `📈 *Pichle 3 Mahine Ka Summary Dekhne Ke Liye Poochhein:* "Last 3 mahine ka kharcha"`;
    }

    // 9.6 Check Yesterday ("Kal ka kharcha")
    if (hasKeyword(normalized, ['kal', 'yesterday', 'beeta hua kal'])) {
      const yesterday = getYesterdayIST();
      const expRes = await notionReq(`/v1/databases/${DB_EXPENSES}/query`, 'POST', {
        filter: {
          and: [
            { property: 'Date', date: { on_or_after: yesterday } },
            { property: 'Date', date: { before: getTodayIST() } }
          ]
        },
        sorts: [{ property: 'Date', direction: 'descending' }]
      });
      let total = 0;
      const items = (expRes.results || []).map(r => {
        const amt = r.properties?.['Amount (₹)']?.number || 0;
        const name = r.properties?.Name?.title?.[0]?.plain_text || 'Expense';
        const cat = r.properties?.Category?.select?.name || '';
        total += amt;
        return `• *${formatINR(amt)}* — ${name} (${cat})`;
      });
      return `📊 *Kal ka Kharcha (${yesterday}):*\n\n${items.join('\n') || 'Kal koi kharcha record nahi hua tha.'}\n\n💰 *Total Kharcha:* *${formatINR(total)}*`;
    }

    // 9.7 Default / Today's Expenses ("Aaj ka kharcha")
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
      return `• *${formatINR(amt)}* — ${name} (${cat})`;
    });
    return `📊 *Aaj ka Kharcha (${today}):*\n\n${items.join('\n') || 'Aaj abhi tak koi kharcha add nahi hua hai.'}\n\n💰 *Total Kharcha:* *${formatINR(total)}*\n\n💡 *Tip:* Pure mahine ka hisab janne ke liye poochhein: "Iss month ka kharcha"`;
  }

  // =========================================================
  // 10. RECHARGE TRACKER & SIM STATUS
  // =========================================================
  if (hasKeyword(normalized, ['recharge', 'sim status', 'sim validity', 'recharge kab'])) {
    const simRes = await notionReq(`/v1/databases/${DB_SIM}/query`, 'POST', { page_size: 10 });
    const list = (simRes.results || []).map(r => {
      const name = r.properties?.['Connection Name']?.title?.[0]?.plain_text || 'SIM';
      const no = r.properties?.['Mobile Number']?.phone_number || '';
      const op = r.properties?.Operator?.select?.name || '';
      const status = r.properties?.['Recharge Status']?.formula?.string || 'Active';
      const cost = r.properties?.['Plan Cost (₹)']?.number;
      return `• *${name}* (${op} ${no}): *${status}* ${cost ? formatINR(cost) : ''}`;
    });
    return `📱 *Family SIM & Recharge Status:*\n\n${list.join('\n\n') || 'SIM records check karein.'}`;
  }

  // =========================================================
  // 11. TASKS & KAAM TRACKER
  // =========================================================
  if (hasKeyword(normalized, ['kaam', 'task', 'pending', 'todo', 'karna hai', 'reminder', 'reminders'])) {
    if (hasKeyword(normalized, ['kal', 'tomorrow'])) {
      return `📋 *Kal (28-Oct-2026) Ke Scheduled Reminders & Tasks:*\n\n` +
             `1. 📞 *11:05 AM:* Shalu bhai SIM wale ko call karna (SIM & Shaadi invitation discussion)\n` +
             `2. 🚆 *12:00 PM:* Return Train Ticket planning (Adoni to Thane — 03-Nov check)\n` +
             `3. 📞 *01:00 PM:* Priyanka (Kurla Airtel Store) se baat karna\n` +
             `4. 📱 *05:00 PM:* Airtel Thanks App / Portal se Abba & Ammi numbers par Auto-Pay enable karna (18th monthly bill cycle)\n\n` +
             `✅ Chaaron tasks Kaam Tracker me ⏰ Reminder ke sath saved hain!`;
    }

    const res = await notionReq(`/v1/databases/${DB_KAAM}/query`, 'POST', {
      filter: { property: 'Status', select: { equals: '⏳ Pending' } },
      page_size: 12
    });
    const tasks = (res.results || []).map((r, i) => {
      const title = r.properties.Name?.title?.[0]?.plain_text || 'Untitled';
      const dt = r.properties['Today Date']?.date?.start || '';
      const reminder = r.properties['⏰ Reminder / Date']?.date?.start || '';
      return `${i + 1}. ⏳ *${title}* ${reminder ? '⏰ ' + reminder.replace('T', ' ').substring(0, 16) : (dt ? '📅 ' + dt : '')}`;
    });
    return `📋 *Kaam Tracker me Active Pending Tasks:*\n\n${tasks.length ? tasks.join('\n\n') : '🎉 Sabhi kaam complete hain!'}\n\n💡 *Tip:* Naya task add karne ke liye likhein: "Task: [aapka kaam]"`;
  }

  // =========================================================
  // 12. KHATABOOK (UDHAAR & JAMA)
  // =========================================================
  if (hasKeyword(normalized, ['khatabook', 'udhar', 'udhaar', 'jama', 'customer hisab', 'ledger'])) {
    const kbRes = await notionReq(`/v1/databases/${DB_KHATABOOK}/query`, 'POST', { page_size: 8 });
    const list = (kbRes.results || []).map(r => {
      const name = r.properties['Customer Name']?.title?.[0]?.plain_text || 'Customer';
      const gave = r.properties['Total Gave (Sum)']?.rollup?.number || 0;
      const got = r.properties['Total Got (Sum)']?.rollup?.number || 0;
      const bal = r.properties['Net Balance']?.formula?.string || '✅ Settled';
      return `• *${name}* — You Gave: ${formatINR(gave)} | You Got: ${formatINR(got)} (${bal})`;
    });
    return `💸 *Khatabook Customer Balances:*\n\n${list.join('\n') || 'Khatabook ledger clear hai!'}`;
  }

  // =========================================================
  // 13. GYM TRACKER & WORKOUT
  // =========================================================
  if (hasKeyword(normalized, ['gym', 'workout', 'exercise', 'attendance', 'chest', 'biceps'])) {
    const gymRes = await notionReq(`/v1/databases/${DB_GYM}/query`, 'POST', { page_size: 5 });
    return `🏋️‍♂️ *Gym Daily Attendance & Workout Log:*\n\n` +
           `• Total Managed Year: 1 Sep 2026 – 31 Aug 2027\n` +
           `• Aaj ka workout note karne ke liye WhatsApp / Quick Capture me likhein: "Gym: Chest & Triceps"`;
  }

  // =========================================================
  // 14. UNIVERSAL NOTION GLOBAL SEARCH (SAFE FALLBACK)
  // Searches all databases and pages — NEVER drops random expenses!
  // =========================================================
  const cleanSearchQuery = text.replace(/^(kya|kab|kitna|kaha|kaise|tha|ta|hai|huwa|hua|ko|me|se|kar|do|kardo|bhai|yaar|please)\s+/gi, '').trim();
  if (cleanSearchQuery && cleanSearchQuery.length >= 2) {
    const searchRes = await notionReq('search', 'POST', {
      query: cleanSearchQuery,
      page_size: 5
    });

    const results = searchRes.results || [];
    if (results.length > 0) {
      const formatted = results.map(r => {
        const title = r.properties?.title?.title?.[0]?.plain_text ||
                      r.properties?.Name?.title?.[0]?.plain_text ||
                      r.properties?.['Platform / App']?.title?.[0]?.plain_text ||
                      r.properties?.['Note / Baat']?.title?.[0]?.plain_text ||
                      r.properties?.['Connection Name']?.title?.[0]?.plain_text ||
                      r.title?.[0]?.plain_text || 'Untitled Page';
        const type = r.object === 'database' ? '🗄️ Database' : '📄 Page';
        return `• ${type}: *${title}*`;
      });
      return `🔍 *Notion me "${cleanSearchQuery}" se match hone wale records:*\n\n${formatted.join('\n')}\n\n💡 Aap inme se kisi bhi cheez ke baare me direct pooch sakte hain!`;
    }
  }

  // =========================================================
  // 15. DEFAULT FRIENDLY DIRECTORY
  // =========================================================
  return `🤖 *Assalamu Alaikum Awais Bhai! Main aapka Smart Notion Assistant hu.*\n\n` +
         `Aap mujhse kisi bhi waqt sawaal pooch sakte hain ya direct note le sakte hain:\n\n` +
         `• 🏡 *"House no kya hai"* ya *"Ghar ka address"*\n` +
         `• 🚆 *"Tatkal train ticket"* ya *"Gaon plan"*\n` +
         `• 📞 *"Shalu bhai call"* ya *"Shaadi guest list"*\n` +
         `• 📱 *"Airtel postpaid bill"* ya *"Recharges"*\n` +
         `• 🏦 *"SBI account details"*, *"Kotak"* ya *"Indian Bank"*\n` +
         `• 📋 *"Pending kaam"* ya *"Kal ka kaam"*\n` +
         `• 💰 *"Aaj ka kharcha"* ya *"October expenses"*\n` +
         `• 📝 *"Recent notes"* ya *"Note: Meeting kal subah hai"*\n` +
         `• 🔑 *"Wi-Fi password"* ya *"Amazon password"*`;
}

// -------------------------------------------------------------
// 7. Telegram Bot Polling (Crash-Proof with Plain-Text Fallback)
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
              text: `👋 Assalamu Alaikum Awais Bhai! Main aapka 24/7 Smart Notion Assistant hu.\n\nAap mujhse kisi bhi waqt sawaal pooch sakte hain ya direct note le sakte hain:\n🏡 "House no kya hai" ya "Ghar ka address"\n🚆 "Tatkal ticket" ya "Gaon plan"\n📞 "Shalu bhai call" ya "Shaadi guest list"\n📱 "Airtel postpaid bill"\n🏦 "SBI bank details" ya "Indian Bank"\n📋 "Pending kaam" ya "Kal ka kaam"\n💰 "Aaj ka kharcha" ya "October expenses"\n📝 "Recent notes" ya "Note: Koi baat"\n🔑 "Wi-Fi password" ya "Laptop PIN"\n\nAapka laptop band ho to bhi ye cloud me 24/7 chalta rahega!`
            });
          } else if (text) {
            const reply = await handleSmartAssistant(text);
            const sendRes = await telegramApi('sendMessage', {
              chat_id: chatId,
              text: reply,
              parse_mode: 'Markdown'
            });
            if (!sendRes.ok) {
              // Fallback to plain text if Markdown format fails
              await telegramApi('sendMessage', {
                chat_id: chatId,
                text: reply.replace(/[*`_]/g, '')
              });
            }
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
// 8. Responsive Modern Web Dashboard & Mobile Assistant UI
// -------------------------------------------------------------
function getWebUIHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Awais Pocket Brain ⚡ | 24/7 Notion AI Hub</title>
  <meta name="theme-color" content="#0b0f19">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #131b2e;
      --card-border: #1e293b;
      --card-hover: #1e2942;
      --primary: #38bdf8;
      --primary-hover: #0ea5e9;
      --accent: #10b981;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); min-height: 100vh; padding: 16px; padding-bottom: 90px; }
    
    .container { max-width: 840px; margin: 0 auto; }
    
    /* Header */
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--card-border); }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-icon { width: 34px; height: 34px; background: linear-gradient(135deg, #0284c7, #38bdf8); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; box-shadow: 0 4px 12px rgba(56, 189, 248, 0.25); }
    .brand-text { font-size: 19px; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
    .badge-status { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 11px; padding: 4px 10px; border-radius: 20px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
    .badge-dot { width: 6px; height: 6px; background: #34d399; border-radius: 50%; box-shadow: 0 0 8px #34d399; animation: pulse 2s infinite; }
    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }

    /* Search Box */
    .search-container { position: relative; margin-bottom: 16px; }
    .search-input { width: 100%; background: var(--card-bg); border: 1px solid var(--card-border); color: #fff; padding: 15px 52px 15px 18px; border-radius: 14px; font-size: 15px; outline: none; transition: all 0.2s; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
    .search-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15); }
    .search-btn { position: absolute; right: 8px; top: 8px; bottom: 8px; width: 40px; background: linear-gradient(135deg, #0284c7, #38bdf8); border: none; border-radius: 10px; color: #0b0f19; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.1s; }
    .search-btn:active { transform: scale(0.95); }

    /* Quick Chips */
    .quick-chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 12px; margin-bottom: 20px; scrollbar-width: none; }
    .quick-chips::-webkit-scrollbar { display: none; }
    .chip { background: var(--card-bg); border: 1px solid var(--card-border); color: #cbd5e1; padding: 8px 14px; border-radius: 20px; font-size: 13px; white-space: nowrap; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.15s; }
    .chip:hover { border-color: var(--primary); color: #fff; }
    .chip:active { transform: scale(0.96); background: var(--card-hover); }

    /* Result Card */
    .result-card { background: var(--card-bg); border: 1px solid #0284c7; border-radius: 16px; padding: 18px; margin-bottom: 24px; display: none; box-shadow: 0 10px 30px rgba(2, 132, 199, 0.15); animation: fadeIn 0.25s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    .result-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 12px; color: var(--primary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
    .result-close { cursor: pointer; color: #f87171; background: rgba(239, 68, 68, 0.1); padding: 3px 8px; border-radius: 6px; font-size: 11px; }
    .result-body { font-size: 14.5px; line-height: 1.65; color: #f1f5f9; word-break: break-word; }
    .result-body strong, .result-body b { color: #fff; font-weight: 700; }
    .result-body code { background: #1e293b; color: #38bdf8; padding: 2px 7px; border-radius: 6px; font-size: 13.5px; font-family: monospace; border: 1px solid #334155; cursor: pointer; }
    .result-body code:active { background: #38bdf8; color: #0b0f19; }

    /* Navigation Tabs */
    .tabs-nav { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--card-border); padding-bottom: 10px; overflow-x: auto; }
    .tab-btn { background: none; border: none; color: var(--text-muted); font-size: 14px; font-weight: 600; padding: 8px 14px; border-radius: 10px; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
    .tab-btn.active { background: rgba(56, 189, 248, 0.12); color: var(--primary); }

    /* Sections */
    .section-title { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }

    /* Cards Grid */
    .cards-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 15px; cursor: pointer; transition: all 0.2s; position: relative; }
    .card:hover { border-color: #334155; background: var(--card-hover); }
    .card:active { transform: scale(0.98); border-color: var(--primary); }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
    .card-icon { font-size: 22px; }
    .copy-pill { font-size: 10.5px; background: rgba(56, 189, 248, 0.12); color: var(--primary); padding: 3px 8px; border-radius: 6px; font-weight: 600; }
    .card-title { font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 3px; }
    .card-sub { font-size: 12.5px; color: var(--text-muted); line-height: 1.4; }

    /* Note Input Strip */
    .note-box { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 12px; margin-bottom: 24px; display: flex; gap: 8px; }
    .note-input { flex: 1; background: transparent; border: none; color: #fff; font-size: 14px; outline: none; }
    .note-btn { background: var(--primary); border: none; border-radius: 8px; padding: 6px 14px; color: #0b0f19; font-weight: 700; font-size: 13px; cursor: pointer; }

    /* Toast Notification */
    .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #10b981; color: #fff; padding: 10px 22px; border-radius: 30px; font-size: 13.5px; font-weight: 600; box-shadow: 0 10px 25px rgba(0,0,0,0.6); display: none; z-index: 999; animation: toastIn 0.2s ease; }
    @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">
        <div class="brand-icon">⚡</div>
        <div>
          <div class="brand-text">Awais Pocket Brain</div>
          <div style="font-size:11px; color:#64748b;">Autonomous Notion AI Engine</div>
        </div>
      </div>
      <div class="badge-status">
        <span class="badge-dot"></span>
        <span>ONLINE 24/7</span>
      </div>
    </div>

    <!-- Smart Search Bar -->
    <div class="search-container">
      <input type="text" id="queryInput" class="search-input" placeholder="Poochho: House no, Nov expenses, Gaon plan, SBI, Wi-Fi..." />
      <button class="search-btn" onclick="sendQuery()">➔</button>
    </div>

    <!-- Quick Chips -->
    <div class="quick-chips">
      <div class="chip" onclick="askQuick('Epic reshma')">🧕 Epic Reshma (Ammi)</div>
      <div class="chip" onclick="askQuick('Dukan ka address')">🪑 Dukan (Tuba Furniture)</div>
      <div class="chip" onclick="askQuick('Iss month ka kharcha')">📊 Is Mahine Ka Kharcha</div>
      <div class="chip" onclick="askQuick('Last 3 mahine ka kharcha')">📈 Last 3 Mahine Ka Hisab</div>
      <div class="chip" onclick="askQuick('income kitna hai aur expenses kitna hai')">💰 Income & Expense Hisab</div>
      <div class="chip" onclick="askQuick('house no kya hai')">🏠 House No (141 A)</div>
      <div class="chip" onclick="askQuick('aaj ka kharcha kitna hua')">💸 Aaj ka Kharcha</div>
      <div class="chip" onclick="askQuick('pending kaam dikhao')">📋 Pending Kaam</div>
      <div class="chip" onclick="askQuick('kal ka kaam kya hai')">⏰ Kal Ke Reminders</div>
      <div class="chip" onclick="askQuick('gaon plan')">🏡 Gaon Plan (31-Oct)</div>
      <div class="chip" onclick="askQuick('tatkal ticket booking')">🚆 Tatkal Booking</div>
      <div class="chip" onclick="askQuick('shalu bhai call reminder')">📞 Shalu Call (11:05 AM)</div>
      <div class="chip" onclick="askQuick('airtel postpaid bill kab aata hai')">📱 Airtel Postpaid (18th)</div>
      <div class="chip" onclick="askQuick('mere sbi bank ka sara details dedo')">🏦 SBI Account</div>
      <div class="chip" onclick="askQuick('abba ka indian bank details')">🏦 Abba Indian Bank</div>
      <div class="chip" onclick="askQuick('recent notes dikhao')">📝 Recent Notes</div>
      <div class="chip" onclick="askQuick('wifi password kya hai')">🔑 Wi-Fi & PINs</div>
      <div class="chip" onclick="askQuick('khatabook udhar hisab')">🤝 Khatabook Ledger</div>
    </div>

    <!-- AI Response Card -->
    <div class="result-card" id="resultCard">
      <div class="result-header">
        <span>🤖 AI ASSISTANT JAWAB:</span>
        <span class="result-close" onclick="closeResult()">✕ Close</span>
      </div>
      <div class="result-body" id="resultBody"></div>
    </div>

    <!-- 1-Tap Quick Note Adder -->
    <div class="section-title">
      <span>📝 Quick Note / Brain Dump (Instant Save to Notion)</span>
    </div>
    <div class="note-box">
      <input type="text" id="noteInput" class="note-input" placeholder="Koi bhi note ya baat likhein jo Notion me save karni ho..." />
      <button class="note-btn" onclick="saveDirectNote()">Save</button>
    </div>

    <!-- 1-Tap Copy Vault Cards -->
    <div class="section-title">
      <span>⚡ Instant Copy Vault (1-Tap Copy for Mobile & Laptop)</span>
    </div>
    <div class="cards-grid">
      <!-- Ammi Voter ID (EPIC) -->
      <div class="card" onclick="copyText('MZS1351410', 'Ammi Voter ID: MZS1351410')">
        <div class="card-top">
          <div class="card-icon">🧕</div>
          <div class="copy-pill">Copy EPIC</div>
        </div>
        <div class="card-title">Ammi Voter ID (EPIC)</div>
        <div class="card-sub">Reshma Banu • MZS1351410 (Part 57, Serial 445)</div>
      </div>

      <!-- Tuba Furniture (Dukan) -->
      <div class="card" onclick="copyText('Tuba Furniture, Boy\'s Hostel, Near Tipu Sultan Circle, Sindhanur Main Road, Siruguppa, Karnataka - 583121', 'Address: Tuba Furniture')">
        <div class="card-top">
          <div class="card-icon">🪑</div>
          <div class="copy-pill">Copy Dukan Address</div>
        </div>
        <div class="card-title">Tuba Furniture (Dukan)</div>
        <div class="card-sub">Near Tipu Sultan Circle, Siruguppa - 583121</div>
      </div>

      <!-- House Address -->
      <div class="card" onclick="copyText('141 A, Near Jamiya Masjeed, Ward No 2, Desanur, Siruguppa, Ballari - 583121', 'Address: 141 A Desanur')">
        <div class="card-top">
          <div class="card-icon">🏠</div>
          <div class="copy-pill">Copy Address</div>
        </div>
        <div class="card-title">House No: 141 A</div>
        <div class="card-sub">Near Jamiya Masjeed, Ward 2, Desanur - 583121</div>
      </div>

      <!-- SBI Siruguppa -->
      <div class="card" onclick="copyText('62378030320', 'SBI A/C: 62378030320')">
        <div class="card-top">
          <div class="card-icon">🔵</div>
          <div class="copy-pill">Copy A/C</div>
        </div>
        <div class="card-title">SBI Siruguppa</div>
        <div class="card-sub">A/C: 62378030320 • IFSC: SBIN0040119</div>
      </div>

      <!-- Kotak 811 -->
      <div class="card" onclick="copyText('5449154932', 'Kotak A/C: 5449154932')">
        <div class="card-top">
          <div class="card-icon">🔴</div>
          <div class="copy-pill">Copy A/C</div>
        </div>
        <div class="card-title">Kotak 811</div>
        <div class="card-sub">A/C: 5449154932 • IFSC: KKBK0008296</div>
      </div>

      <!-- Abba Indian Bank -->
      <div class="card" onclick="copyText('9945', 'Abba UPI PIN: 9945')">
        <div class="card-top">
          <div class="card-icon">🟢</div>
          <div class="copy-pill">Copy PIN: 9945</div>
        </div>
        <div class="card-title">Abba Indian Bank</div>
        <div class="card-sub">Mobile: 9945161755 • UPI PIN: 9945</div>
      </div>

      <!-- PhonePe UPI -->
      <div class="card" onclick="copyText('8123912392@ybl', 'UPI: 8123912392@ybl')">
        <div class="card-top">
          <div class="card-icon">📱</div>
          <div class="copy-pill">Copy UPI</div>
        </div>
        <div class="card-title">PhonePe / UPI</div>
        <div class="card-sub">8123912392@ybl (SBI Linked)</div>
      </div>

      <!-- Laptop & Locker PIN -->
      <div class="card" onclick="copyText('552552', 'Passcode: 552552')">
        <div class="card-top">
          <div class="card-icon">🔑</div>
          <div class="copy-pill">Copy PIN</div>
        </div>
        <div class="card-title">Passcode: 552552</div>
        <div class="card-sub">Laptop Lock / OneNote / Locker / Signal</div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast">Copied to clipboard!</div>

  <script>
    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 2200);
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

    function renderMarkdownToHtml(md) {
      if (!md) return '';
      let html = md
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Bold
        .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\*(.*?)\\*/g, '<strong>$1</strong>')
        // Code pills with click-to-copy
        .replace(/\`([^\`]+)\`/g, '<code onclick="copyText(\\'$1\\', \\'Copied: $1\\')">$1</code>')
        // Bullet points
        .replace(/^[•\\-]\\s+(.*)$/gm, '<li style="margin-left: 20px; margin-bottom: 4px;">$1</li>')
        // Numbered lists
        .replace(/^(\\d+)\\.\\s+(.*)$/gm, '<div style="margin-bottom: 6px;"><strong>$1.</strong> $2</div>')
        // Line breaks
        .replace(/\\n/g, '<br>');
      return html;
    }

    async function sendQuery() {
      const q = document.getElementById('queryInput').value.trim();
      if (!q) return;
      const card = document.getElementById('resultCard');
      const body = document.getElementById('resultBody');
      card.style.display = 'block';
      body.innerHTML = '<span style="color:#38bdf8;">🧠 Searching Notion databases & Knowledge Vault... ⏳</span>';
      try {
        const res = await fetch('/api/ask?q=' + encodeURIComponent(q));
        const json = await res.json();
        body.innerHTML = renderMarkdownToHtml(json.answer || 'Koi jawab nahi mila.');
      } catch (e) {
        body.innerHTML = '<span style="color:#ef4444;">Error connecting to assistant: ' + e.message + '</span>';
      }
    }

    async function saveDirectNote() {
      const note = document.getElementById('noteInput').value.trim();
      if (!note) return;
      showToast('Saving note to Notion... ⏳');
      try {
        const res = await fetch('/api/ask?q=' + encodeURIComponent('Note: ' + note));
        const json = await res.json();
        document.getElementById('noteInput').value = '';
        showToast('✅ Note permanently saved in Notion!');
        document.getElementById('resultCard').style.display = 'block';
        document.getElementById('resultBody').innerHTML = renderMarkdownToHtml(json.answer);
      } catch (e) {
        showToast('Error saving note');
      }
    }

    document.getElementById('queryInput').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') sendQuery();
    });
    document.getElementById('noteInput').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') saveDirectNote();
    });
  </script>
</body>
</html>`;
}

// -------------------------------------------------------------
// 9. HTTP Web Server & API Dispatcher
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

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
    return res.end(JSON.stringify({ ok: true, query: q, answer: answer }));
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'healthy',
      time: new Date().toISOString(),
      service: 'Awais Notion Cloud Agent 24/7'
    }));
  }

  // Web UI
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(getWebUIHtml());
});

module.exports = {
  handleSmartAssistant,
  formatINR,
  KNOWLEDGE_VAULT
};

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🚀 [Cloud Worker] Online on port ${PORT}. 24/7 Autonomous Sync & Smart Assistant Active!`);
    
    // 20-second Quick Capture Sync loop
    setInterval(runQuickCaptureSync, 20000);
    runQuickCaptureSync();

    // Telegram polling
    pollTelegram();

    // Keep-alive self-ping
    setInterval(() => {
      https.get('https://awais-notion-cloud-agent.onrender.com/health', (res) => {
        console.log(`[Keep-Alive] Pinged self. Status: ${res.statusCode}`);
      }).on('error', (err) => {
        console.log(`[Keep-Alive] Ping error: ${err.message}`);
      });
    }, 10 * 60 * 1000);
  });
}
