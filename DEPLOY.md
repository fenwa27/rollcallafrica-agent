# Deployment Guide

## Option A — GitHub Actions (Free, Recommended)

### Step 1: Create a GitHub repo

```bash
cd social-agent
git init
git add .
git commit -m "Initial commit"
```

Go to github.com → New repository → name it `rollcallafrica-agent` → push:

```bash
git remote add origin https://github.com/YOUR_USERNAME/rollcallafrica-agent.git
git branch -M main
git push -u origin main
```

### Step 2: Add your secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add each of these (only ANTHROPIC_API_KEY is required to start):

| Secret name | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `RSS_FEED_URL` | https://rollcallafrica.com/feed |
| `SITE_NAME` | RollCallAfrica |
| `SITE_URL` | https://rollcallafrica.com |
| `REVIEW_EMAIL` | your personal email |
| `SMTP_HOST` | smtp.gmail.com |
| `SMTP_PORT` | 587 |
| `SMTP_USER` | your Gmail address |
| `SMTP_PASS` | Gmail App Password (not your login password — generate at myaccount.google.com/apppasswords) |
| `BUFFER_ACCESS_TOKEN` | buffer.com/developers (optional) |
| `SERPER_API_KEY` | serper.dev (optional — 2,500 free searches/month) |
| `WORDPRESS_API_URL` | https://rollcallafrica.com (optional) |
| `WP_APP_PASSWORD` | WordPress → Users → Application Passwords (optional) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Cloud Console (optional — for GA4 + Indexing API) |

### Step 3: Test it immediately

Don't wait until 9am. Go to your repo:
**Actions** tab → **Daily Agent Run** → **Run workflow** → **Run workflow**

Watch the logs in real time. If it runs clean, you're deployed.

### Step 4: You're done

The three workflows now run automatically:
- Every day at 9am (WAT) — processes new articles
- Every Monday at 7am — content intelligence brief
- Every Monday at 8am — performance digest

### Monitoring
- **Actions tab** on GitHub shows every run, its logs, and whether it succeeded or failed
- GitHub emails you automatically if a workflow fails
- All agent outputs are sent to `REVIEW_EMAIL`

---

## Option B — Railway ($5/month)

Railway runs Node.js services with built-in cron support.

### Step 1: Install Railway CLI

```bash
npm install -g @railway/cli
railway login
```

### Step 2: Create a Railway project

```bash
cd social-agent
railway init
railway up
```

### Step 3: Add environment variables

```bash
railway vars set ANTHROPIC_API_KEY=sk-ant-...
railway vars set RSS_FEED_URL=https://rollcallafrica.com/feed
railway vars set REVIEW_EMAIL=you@gmail.com
# ... add the rest
```

### Step 4: Add cron jobs

In Railway dashboard → your service → **Settings** → **Cron Jobs**:

```
0 8 * * *   node index.js
0 6 * * 1   node index.js --content-intel
0 7 * * 1   node index.js --monitor
```

---

## Option C — DigitalOcean VPS ($6/month)

### Step 1: Create a droplet

DigitalOcean → Create Droplet → Ubuntu 24.04 → Basic → $6/month (1GB RAM) → Create

### Step 2: Connect and set up

```bash
ssh root@YOUR_DROPLET_IP

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# Clone your repo
git clone https://github.com/YOUR_USERNAME/rollcallafrica-agent.git
cd rollcallafrica-agent
npm install

# Create .env file
nano .env
# (paste all your keys, save with Ctrl+X)
```

### Step 3: Set up cron

```bash
crontab -e
```

Add these lines:
```
0 8 * * *   cd /root/rollcallafrica-agent && node index.js >> logs/daily.log 2>&1
0 6 * * 1   cd /root/rollcallafrica-agent && node index.js --content-intel >> logs/intel.log 2>&1
0 7 * * 1   cd /root/rollcallafrica-agent && node index.js --monitor >> logs/monitor.log 2>&1
```

### Step 4: Create logs folder and test

```bash
mkdir -p logs
node index.js  # test run
```

### Updating your code (VPS)

```bash
cd /root/rollcallafrica-agent
git pull
npm install
```

---

## Minimum viable start

You only need **two things** to be live:
1. `ANTHROPIC_API_KEY`
2. `RSS_FEED_URL`

Everything else enhances the agents but isn't required. Start with these two, confirm it runs, then add keys one at a time.
