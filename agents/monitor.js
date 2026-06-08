/**
 * RollCallAfrica Monitor Agent
 * ─────────────────────────────
 * Runs weekly. Pulls traffic, backlink, and mention data,
 * asks Claude to synthesise into an intelligence digest,
 * emails the report, and feeds opportunity signals back to the Orchestrator.
 *
 * Prerequisites:
 *  - ANTHROPIC_API_KEY
 *  - GA4_PROPERTY_ID + GOOGLE_SERVICE_ACCOUNT_JSON (Analytics Data API)
 *  - AHREFS_API_KEY or SEMRUSH_API_KEY (optional, for backlinks)
 *  - REVIEW_EMAIL + SMTP config (for digest email)
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleAuth } from "google-auth-library";
import nodemailer from "nodemailer";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── 1. FETCH GA4 DATA ────────────────────────────────────────────────────────

async function fetchGA4Data() {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!propertyId || !serviceAccountJson) {
    console.warn("⚠️  GA4 not configured — returning empty data");
    return [];
  }

  try {
    const credentials = JSON.parse(serviceAccountJson);
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    const authClient = await auth.getClient();
    const token = await authClient.getAccessToken();

    const endDate = new Date();
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().split("T")[0];

    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }],
          dimensions: [{ name: "pageTitle" }, { name: "pagePath" }],
          metrics: [
            { name: "sessions" },
            { name: "activeUsers" },
            { name: "screenPageViews" },
            { name: "averageSessionDuration" },
            { name: "bounceRate" },
          ],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 20,
        }),
      }
    );

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message);

    return (data.rows || []).map((row) => ({
      title: row.dimensionValues[0].value,
      path: row.dimensionValues[1].value,
      sessions: parseInt(row.metricValues[0].value),
      users: parseInt(row.metricValues[1].value),
      pageviews: parseInt(row.metricValues[2].value),
      avgDuration: Math.round(parseFloat(row.metricValues[3].value)),
      bounceRate: (parseFloat(row.metricValues[4].value) * 100).toFixed(1) + "%",
    }));
  } catch (e) {
    console.warn("⚠️  GA4 fetch failed:", e.message);
    return [];
  }
}

// ─── 2. FETCH BACKLINK DATA (Ahrefs) ──────────────────────────────────────────

async function fetchBacklinkData() {
  const apiKey = process.env.AHREFS_API_KEY;
  const siteUrl = process.env.SITE_URL;

  if (!apiKey || !siteUrl) {
    console.warn("⚠️  Ahrefs not configured — skipping backlink data");
    return [];
  }

  try {
    // Ahrefs v3 API — new backlinks in last 7 days
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const res = await fetch(
      `https://api.ahrefs.com/v3/site-explorer/new-backlinks?` +
        new URLSearchParams({
          target: siteUrl,
          date_from: since,
          mode: "domain",
          limit: 20,
          select: "url_from,url_to,domain_rating_source,anchor",
        }),
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    if (!res.ok) throw new Error(`Ahrefs API ${res.status}`);
    const data = await res.json();
    return data.backlinks || [];
  } catch (e) {
    console.warn("⚠️  Ahrefs fetch failed:", e.message);
    return [];
  }
}

// ─── 3. FETCH BRAND MENTIONS (via Serper) ─────────────────────────────────────

async function fetchBrandMentions() {
  const siteName = process.env.SITE_NAME || "RollCallAfrica";
  const serperKey = process.env.SERPER_API_KEY;

  if (!serperKey) {
    console.warn("⚠️  Serper not configured — skipping brand mentions");
    return [];
  }

  try {
    const res = await fetch("https://google.serper.dev/news", {
      method: "POST",
      headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: siteName, num: 10, tbs: "qdr:w" }), // last week
    });

    const data = await res.json();
    return (data.news || []).map((n) => ({
      title: n.title,
      source: n.source,
      date: n.date,
      snippet: n.snippet,
      link: n.link,
    }));
  } catch (e) {
    console.warn("⚠️  Brand mentions fetch failed:", e.message);
    return [];
  }
}

// ─── 4. GENERATE INTELLIGENCE DIGEST ─────────────────────────────────────────

async function generateDigest(ga4Data, backlinkData, mentionData) {
  const siteName = process.env.SITE_NAME || "RollCallAfrica";

  const ga4Text = ga4Data.length
    ? ga4Data.map((r) => `${r.title} — ${r.sessions} sessions, ${r.users} users, bounce ${r.bounceRate}`).join("\n")
    : "No GA4 data available.";

  const backlinkText = backlinkData.length
    ? backlinkData.map((b) => `${b.url_from} → ${b.url_to} (DR: ${b.domain_rating_source}, anchor: "${b.anchor}")`).join("\n")
    : "No new backlinks this week.";

  const mentionText = mentionData.length
    ? mentionData.map((m) => `${m.source}: ${m.title} — ${m.snippet}`).join("\n")
    : "No brand mentions found.";

  const prompt = `You are the Monitor Agent for ${siteName}. Produce a weekly performance intelligence digest.

GA4 DATA (last 7 days):
${ga4Text}

NEW BACKLINKS:
${backlinkText}

BRAND MENTIONS:
${mentionText}

Return JSON:
{
  "summary": "Executive summary — 3 sentences. Biggest win, biggest concern, key trend.",
  "topArticle": "Title of best performing article",
  "totalSessions": <number>,
  "totalUsers": <number>,
  "newBacklinks": <count>,
  "brandMentions": <count>,
  "winners": [{ "title": "article", "insight": "what made it perform", "metric": "sessions/backlinks/mentions", "value": "number" }],
  "concerns": [{ "issue": "problem", "evidence": "data", "severity": "HIGH|MEDIUM|LOW" }],
  "opportunities": [
    { "title": "short name", "urgency": "HIGH|MEDIUM|LOW", "insight": "what data shows", "action": "specific thing to do this week" }
  ],
  "contentRecommendations": ["Specific article idea grounded in what's working"],
  "agentInstructions": {
    "socialAgent": "What to amplify on social this week",
    "seoAgent": "Which articles to optimise",
    "communityAgent": "Which topics are trending in your niche",
    "outreachAgent": "Which articles have backlink momentum to pitch"
  }
}

Return ONLY JSON. No markdown.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content.find((b) => b.type === "text")?.text || "{}";
  const clean = raw.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(clean.match(/\{[\s\S]*\}/)?.[0] || "{}");
  } catch {
    return null;
  }
}

// ─── 5. EMAIL DIGEST ──────────────────────────────────────────────────────────

async function emailDigest(digest) {
  const reviewEmail = process.env.REVIEW_EMAIL;
  const smtpHost = process.env.SMTP_HOST;

  if (!smtpHost || !reviewEmail) {
    console.log("\n   ─── WEEKLY DIGEST (console output — configure SMTP for email) ───");
    console.log(`   Summary: ${digest.summary}`);
    console.log(`   Top Article: ${digest.topArticle}`);
    console.log(`   Sessions: ${digest.totalSessions} | Users: ${digest.totalUsers}`);
    console.log(`   Backlinks: ${digest.newBacklinks} | Mentions: ${digest.brandMentions}`);
    console.log(`\n   Top Opportunity: ${digest.opportunities?.[0]?.title}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const urgencyColor = { HIGH: "#E8734A", MEDIUM: "#C8A96E", LOW: "#888888" };

  const html = `
<div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;background:#0f0f0f;color:#e8e0d0;padding:32px">
  <div style="font-size:10px;letter-spacing:3px;color:#666;font-family:monospace;margin-bottom:8px">ROLLCALLAFRICA — WEEKLY INTELLIGENCE DIGEST</div>
  <h1 style="font-size:22px;color:#C8A96E;font-weight:400;margin:0 0 20px">Monitor Report</h1>

  <div style="background:#1a1a1a;padding:16px;border-radius:4px;margin-bottom:24px">
    <p style="margin:0;font-size:14px;line-height:1.7;color:#bbb">${digest.summary}</p>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:24px">
    ${[
      ["SESSIONS", digest.totalSessions?.toLocaleString(), "#C8A96E"],
      ["USERS", digest.totalUsers?.toLocaleString(), "#5B9BD5"],
      ["BACKLINKS", digest.newBacklinks, "#7BC67E"],
      ["MENTIONS", digest.brandMentions, "#E8734A"],
    ].map(([l, v, c]) => `<div style="background:#1a1a1a;padding:12px;text-align:center;border-radius:4px">
      <div style="font-size:9px;letter-spacing:2px;color:#555;font-family:monospace;margin-bottom:6px">${l}</div>
      <div style="font-size:22px;color:${c};font-family:monospace">${v || 0}</div>
    </div>`).join("")}
  </div>

  <h3 style="font-size:10px;letter-spacing:3px;color:#C8A96E;font-family:monospace;margin:0 0 12px">TOP OPPORTUNITIES</h3>
  ${digest.opportunities?.map(o => `
  <div style="background:#1a1a1a;border-left:3px solid ${urgencyColor[o.urgency]};padding:14px 16px;margin-bottom:10px;border-radius:0 4px 4px 0">
    <div style="display:flex;justify-content:space-between;margin-bottom:6px">
      <span style="font-size:13px;color:#e8e0d0">${o.title}</span>
      <span style="font-size:9px;letter-spacing:2px;color:${urgencyColor[o.urgency]};font-family:monospace">${o.urgency}</span>
    </div>
    <div style="font-size:12px;color:#777;margin-bottom:6px">${o.insight}</div>
    <div style="font-size:11px;color:#555;font-family:monospace">→ ${o.action}</div>
  </div>`).join("") || ""}

  <h3 style="font-size:10px;letter-spacing:3px;color:#C8A96E;font-family:monospace;margin:20px 0 12px">CONTENT IDEAS</h3>
  ${digest.contentRecommendations?.map((r, i) => `<div style="font-size:12px;color:#888;padding:6px 0;border-bottom:1px solid #1a1a1a">${i + 1}. ${r}</div>`).join("") || ""}

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #1a1a1a;font-size:10px;color:#333;font-family:monospace;text-align:center">
    ROLLCALLAFRICA MONITOR AGENT — AUTO-GENERATED WEEKLY DIGEST
  </div>
</div>`;

  const now = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: reviewEmail,
    subject: `[RollCallAfrica] Weekly Digest — ${now} | ${digest.totalSessions?.toLocaleString()} sessions`,
    html,
  });

  console.log(`✓ Weekly digest emailed to ${reviewEmail}`);
}

// ─── 6. FULL PIPELINE ─────────────────────────────────────────────────────────

export async function runMonitorPipeline() {
  console.log("\n📊 Monitor Agent: Running weekly analysis...");

  const [ga4Data, backlinkData, mentionData] = await Promise.all([
    fetchGA4Data(),
    fetchBacklinkData(),
    fetchBrandMentions(),
  ]);

  console.log(`   GA4: ${ga4Data.length} pages | Backlinks: ${backlinkData.length} | Mentions: ${mentionData.length}`);

  if (!ga4Data.length && !backlinkData.length && !mentionData.length) {
    console.warn("   ⚠️  No data sources configured. Skipping digest.");
    return null;
  }

  console.log("   Generating intelligence digest via Claude...");
  const digest = await generateDigest(ga4Data, backlinkData, mentionData);

  if (!digest) {
    console.error("   ❌ Failed to generate digest");
    return null;
  }

  await emailDigest(digest);
  return digest;
}
