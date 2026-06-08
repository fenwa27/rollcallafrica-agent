/**
 * RollCallAfrica Content Intelligence Agent
 * ──────────────────────────────────────────
 * Runs weekly (Monday, before the monitor digest).
 * Scans trending topics, coverage gaps, and breaking signals
 * in African entertainment, then delivers a ranked editorial
 * brief to your inbox — stories to write BEFORE competitors do.
 *
 * Prerequisites:
 *  - ANTHROPIC_API_KEY
 *  - SERPER_API_KEY (web intelligence)
 *  - REVIEW_EMAIL + SMTP (for weekly brief email)
 */

import Anthropic from "@anthropic-ai/sdk";
import nodemailer from "nodemailer";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FOCUS_AREAS = [
  "Nollywood cinema releases and box office",
  "African streaming deals (Netflix, Prime, Showmax)",
  "African film industry economics and distribution",
  "Filmmaker and talent news",
  "African film festivals and awards",
  "African diaspora cinema",
];

// ─── 1. GATHER SIGNALS VIA SERPER ────────────────────────────────────────────

async function gatherSignals() {
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    console.warn("⚠️  SERPER_API_KEY not set — using Claude knowledge only");
    return [];
  }

  const queries = [
    "nollywood news this week",
    "african cinema streaming deal 2025",
    "nollywood box office controversy",
    "nigerian film producer director announcement",
    "african film festival award 2025",
    "nollywood netflix amazon deal",
  ];

  const allResults = [];
  for (const q of queries) {
    try {
      const res = await fetch("https://google.serper.dev/news", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q, num: 5, tbs: "qdr:w", gl: "ng" }),
      });
      const data = await res.json();
      allResults.push(...(data.news || []).map(n => ({
        signal: n.title,
        source: n.source,
        url: n.link,
        snippet: n.snippet,
        date: n.date,
      })));
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn(`   ⚠️  Signal search failed: ${q}`);
    }
  }

  // Deduplicate by title similarity
  const seen = new Set();
  return allResults.filter(r => {
    const key = r.signal.slice(0, 40).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── 2. GENERATE EDITORIAL BRIEFS ────────────────────────────────────────────

async function generateBriefs(signals, existingTitles = []) {
  const siteName = process.env.SITE_NAME || "RollCallAfrica";

  const signalText = signals.length
    ? signals.slice(0, 15).map((s, i) =>
        `${i + 1}. ${s.signal}\n   Source: ${s.source} (${s.date || "recent"})\n   ${s.snippet}`
      ).join("\n\n")
    : "No external signals — generate briefs from current Nollywood industry knowledge.";

  const existingText = existingTitles.length
    ? `\nAVOID DUPLICATING THESE RECENT ARTICLES:\n${existingTitles.slice(0, 20).join("\n")}`
    : "";

  const prompt = `You are the editorial director of ${siteName}, a pan-African entertainment intelligence publication.

STORY SIGNALS FROM THIS WEEK:
${signalText}
${existingText}

Develop the 8 strongest editorial opportunities into full briefs for the ${siteName} editorial team.

Return JSON array. Each brief — keep each field concise:
[{
  "headline": "Publication-ready headline. Sharp, specific, editorial. Not clickbait.",
  "type": "trending | gaps | evergreen | exclusive",
  "urgency": "URGENT | HIGH | MEDIUM | LOW",
  "format": "Analysis | Interview | Investigation | Feature | News | Opinion | Profile",
  "angle": "The specific editorial argument or take (2 sentences max)",
  "whyNow": "Why publish THIS week, not next month (2 sentences)",
  "signalSource": "Where this was spotted",
  "keyQuestions": ["Question 1", "Question 2", "Question 3"],
  "sourcesToContact": ["Source 1 — why", "Source 2 — why"],
  "seoKeyword": "Primary 2-4 word keyword",
  "competitorGap": "What others have missed on this (1 sentence)",
  "trafficPotential": "500–2K | 2K–10K | 10K–50K | 50K+",
  "headlineVariants": ["Variant 1", "Variant 2"]
}]

Sort by urgency. Be specific to real Nigerian/African film industry dynamics. Return ONLY JSON array.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content.find(b => b.type === "text")?.text || "[]";
  const clean = raw.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch {
    const m = clean.match(/\[[\s\S]*/);
    if (m) {
      const last = m[0].lastIndexOf("},");
      if (last > 0) {
        try { return JSON.parse(m[0].slice(0, last + 1) + "]"); } catch {}
      }
    }
    return [];
  }
}

// ─── 3. EMAIL EDITORIAL BRIEF ─────────────────────────────────────────────────

async function emailBrief(briefs) {
  const reviewEmail = process.env.REVIEW_EMAIL;
  const smtpHost = process.env.SMTP_HOST;
  const siteName = process.env.SITE_NAME || "RollCallAfrica";

  if (!smtpHost || !reviewEmail) {
    console.log("\n   ─── WEEKLY EDITORIAL BRIEF ───");
    briefs.forEach((b, i) => {
      console.log(`\n   [${i + 1}] ${b.urgency} — ${b.headline}`);
      console.log(`   Angle: ${b.angle}`);
      console.log(`   Why now: ${b.whyNow}`);
      console.log(`   SEO: ${b.seoKeyword} | Traffic: ${b.trafficPotential}`);
    });
    return;
  }

  const urgencyColor = { URGENT: "#E8734A", HIGH: "#C8A96E", MEDIUM: "#5B9BD5", LOW: "#555" };
  const typeLabel = { trending: "TRENDING NOW", gaps: "COVERAGE GAP", evergreen: "EVERGREEN", exclusive: "EXCLUSIVE" };

  const transporter = nodemailer.createTransport({
    host: smtpHost, port: Number(process.env.SMTP_PORT) || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const now = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  const html = `
<div style="font-family:Georgia,serif;max-width:680px;margin:0 auto;background:#0f0f0f;color:#e8e0d0;padding:32px">
  <div style="font-size:9px;letter-spacing:3px;color:#555;font-family:monospace;margin-bottom:6px">
    ${siteName.toUpperCase()} — WEEKLY EDITORIAL BRIEF
  </div>
  <h1 style="font-size:22px;color:#C8A96E;font-weight:400;margin:0 0 4px">Editorial Intelligence</h1>
  <div style="font-size:12px;color:#555;margin-bottom:28px">${now} · ${briefs.length} story opportunities</div>

  ${briefs.map((b, i) => `
  <div style="background:#1a1a1a;border-left:3px solid ${urgencyColor[b.urgency] || "#555"};padding:18px;margin-bottom:14px;border-radius:0 4px 4px 0">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:12px">
      <div>
        <div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-size:9px;letter-spacing:2px;color:${urgencyColor[b.urgency]};font-family:monospace">${b.urgency}</span>
          <span style="font-size:9px;letter-spacing:2px;color:#555;font-family:monospace">${typeLabel[b.type] || b.type}</span>
          <span style="font-size:9px;letter-spacing:2px;color:#444;font-family:monospace">${b.format}</span>
        </div>
        <div style="font-size:15px;color:#e8e0d0;line-height:1.3;margin-bottom:4px">${b.headline}</div>
        <div style="font-size:12px;color:#777">${b.angle}</div>
      </div>
      <div style="font-size:10px;font-family:monospace;color:#C8A96E;background:#1a1208;padding:4px 8px;border-radius:2px;white-space:nowrap">${b.trafficPotential}</div>
    </div>

    <div style="background:#111;padding:10px 12px;border-radius:3px;margin-bottom:10px">
      <div style="font-size:9px;letter-spacing:2px;color:#444;font-family:monospace;margin-bottom:4px">WHY NOW</div>
      <div style="font-size:12px;color:#888;line-height:1.5">${b.whyNow}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div style="background:#111;padding:10px 12px;border-radius:3px">
        <div style="font-size:9px;letter-spacing:2px;color:#444;font-family:monospace;margin-bottom:6px">KEY QUESTIONS</div>
        ${(b.keyQuestions || []).map(q => `<div style="font-size:11px;color:#777;padding:2px 0;border-bottom:1px solid #1a1a1a">• ${q}</div>`).join("")}
      </div>
      <div style="background:#111;padding:10px 12px;border-radius:3px">
        <div style="font-size:9px;letter-spacing:2px;color:#444;font-family:monospace;margin-bottom:6px">SOURCES TO CONTACT</div>
        ${(b.sourcesToContact || []).map(s => `<div style="font-size:11px;color:#777;padding:2px 0;border-bottom:1px solid #1a1a1a">→ ${s}</div>`).join("")}
      </div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <span style="font-size:10px;font-family:monospace;color:#555;background:#111;padding:3px 8px;border-radius:2px">SEO: ${b.seoKeyword}</span>
      <span style="font-size:10px;font-family:monospace;color:#555;background:#111;padding:3px 8px;border-radius:2px">GAP: ${b.competitorGap}</span>
    </div>
  </div>`).join("")}

  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #1a1a1a;font-size:10px;color:#333;font-family:monospace;text-align:center">
    ${siteName.toUpperCase()} CONTENT INTELLIGENCE AGENT — AUTO-GENERATED WEEKLY BRIEF
  </div>
</div>`;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: reviewEmail,
    subject: `[${siteName}] Editorial Brief — ${now} | ${briefs.filter(b => b.urgency === "URGENT").length} urgent stories`,
    html,
  });

  console.log(`✓ Editorial brief emailed to ${reviewEmail}`);
}

// ─── 4. FULL PIPELINE ─────────────────────────────────────────────────────────

export async function runContentIntelPipeline(existingTitles = []) {
  console.log("\n📰 Content Intelligence Agent: Scanning editorial landscape...");

  const signals = await gatherSignals();
  console.log(`   ${signals.length} story signals gathered`);

  const briefs = await generateBriefs(signals, existingTitles);
  console.log(`   ${briefs.length} editorial briefs generated`);

  briefs.forEach((b, i) => {
    console.log(`\n   [${i + 1}] ${b.urgency} — ${b.headline}`);
    console.log(`   Type: ${b.type} | Format: ${b.format} | Traffic: ${b.trafficPotential}`);
  });

  await emailBrief(briefs);
  return briefs;
}
