# 🚀 Awais 24/7 Notion Cloud Agent

This worker runs 100% autonomously in the cloud 24/7/365.
**No laptop required!** Even if your laptop is shut down, battery dead, or left at the office, this agent keeps your Notion in real-time sync.

---

## 🌟 What This Cloud Agent Does:
1. **⚡ Quick Capture Auto-Sync:**
   - Every 20 seconds, checks your Notion `⚡ Quick Capture (Brain Dump)`.
   - Runs Cloud OCR on payment screenshots & bills.
   - Hosts snaps permanently on high-res CDN.
   - Moves entries to `💰 Daily Expenses`, `📋 Kaam Tracker`, or `🏋️‍♂️ Gym Tracker`.
   - Marks Quick Capture as `✅ Processed`.

2. **🤖 Telegram Assistant Integration:**
   - Directly chat with your agent on Telegram from your phone!
   - Send receipts -> Automatically saved to Notion Daily Expenses.
   - Type or speak -> Automatically recorded.
   - Ask "Aaj ka kharcha" -> Instant live calculation.

---

## ⚡ 1-Click Free Deployment Options:

### Option 1: Render.com (Recommended - 100% Free)
1. Go to [Render.com](https://render.com/) and Sign Up (Free).
2. Click **New +** ➔ **Web Service**.
3. Choose **Build and deploy from a Git repository** (or public repo).
4. Runtime: **Node**.
5. Build Command: leave empty.
6. Start Command: `node server.js`
7. Click **Deploy Web Service**!
8. Done! It runs 24/7 forever for free.

### Option 2: Koyeb (100% Free Always-On)
1. Go to [Koyeb.com](https://koyeb.com/) and Sign Up with GitHub.
2. Click **Create Service** ➔ **GitHub**.
3. Select this repo and click **Deploy**.

---

## 🔑 Environment Variables (Already configured in server.js):
- `NOTION_TOKEN`: Notion Bot Integration Key
- `TELEGRAM_TOKEN`: Telegram Bot Token
- `FREEIMAGE_API_KEY`: 6d207e02198a847aa98d0a2a901485a5
- `OCR_API_KEY`: helloworld (or custom from ocr.space)
- `PORT`: 3000 (or cloud default)
