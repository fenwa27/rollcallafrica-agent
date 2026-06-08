# RollCallAfrica — Traffic Intelligence Agent v1.4

A complete, production-ready multi-agent system that drives traffic to RollCallAfrica automatically.

## Agents

| Agent | What it does | Trigger |
|---|---|---|
| **Social Agent** | Generates X thread, LinkedIn post, Threads caption → queues to Buffer | Every new article |
| **SEO Agent** | Generates meta tags, internal links, pings Google Indexing API, applies to WordPress | Every new article |
| **Community Agent** | Finds Reddit/Quora/FB threads, drafts authentic replies → emails for review | Every new article |
| **Outreach Agent** | Finds journalists/newsletters, drafts personalised pitches → Gmail drafts | Every new article |
| **Monitor Agent** | Pulls GA4 + Ahrefs data, generates weekly performance digest + agent briefs | Weekly (Monday) |

## Setup

```bash
npm install
cp .env.example .env
# Fill in your keys
node index.js
```

## Cron schedule

```bash
# Daily at 9am Lagos time — process new articles (all 4 agents)
0 9 * * * cd /path/to/agent && node index.js >> logs/daily.log 2>&1

# Every Monday at 8am — weekly performance digest
0 8 * * 1 cd /path/to/agent && node index.js --monitor >> logs/monitor.log 2>&1
```

## Minimum viable start

You only need `ANTHROPIC_API_KEY` to get value. Each optional key unlocks more:

- `BUFFER_ACCESS_TOKEN` → Social posts auto-queue for review
- `SERPER_API_KEY` → Community + Outreach agents work (serper.dev — 2,500 free/month)
- `WORDPRESS_API_URL` + `WP_APP_PASSWORD` → SEO meta auto-applied to Yoast
- `GOOGLE_SERVICE_ACCOUNT_JSON` → Google Indexing API + GA4 data
- `AHREFS_API_KEY` → Backlink tracking in Monitor
- `GMAIL_*` → Outreach drafts appear directly in your Gmail
- `SMTP_*` + `REVIEW_EMAIL` → All agents email you digests for review

## Philosophy

The agent handles *discovery and drafting*. You handle *approval and relationship*. Nothing posts, sends, or publishes without your eyes on it first.
