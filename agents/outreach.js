/**
 * RollCallAfrica Outreach Agent
 * ──────────────────────────────
 * Finds journalists, newsletter writers, and podcast hosts
 * covering African entertainment, then drafts personalised
 * pitches to earn citations, features, and collaborations.
 *
 * All output is staged for human review. Nothing auto-sends.
 *
 * Prerequisites:
 *  - ANTHROPIC_API_KEY
 *  - SERPER_API_KEY (journalist discovery)
 *  - GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN (to queue drafts)
 *  - REVIEW_EMAIL + SMTP (for pitch digest email)
 */

import Anthropic from "@anthropic-ai/sdk";
import nodemailer from "nodemailer";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── 1. DISCOVER PROSPECTS VIA SERPER ────────────────────────────────────────

async function discoverProspects(article) {
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    console.warn("⚠️  SERPER_API_KEY not set — Outreach Agent requires Serper");
    return [];
  }

  const keywords = article.title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter(w => w.length > 3)
    .slice(0, 4)
    .join(" ");

  const queries = [
    `journalist "${keywords}" nollywood site:twitter.com OR site:linkedin.com`,
    `nollywood african cinema journalist writer byline`,
    `africa entertainment newsletter ${keywords}`,
    `nollywood podcast host african film`,
  ];

  const allResults = [];

  for (const q of queries) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q, num: 5, gl: "ng" }),
      });
      const data = await res.json();
      allResults.push(...(data.organic || []));
      await new Promise(r => setTimeout(r, 250));
    } catch (e) {
      console.warn(`   ⚠️  Search failed: ${q}`);
    }
  }

  return allResults;
}

// ─── 2. PROFILE AND SCORE PROSPECTS ──────────────────────────────────────────

async function profileProspects(article, rawResults) {
  if (!rawResults.length) return [];

  const resultsText = rawResults
    .slice(0, 15)
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet}`)
    .join("\n\n");

  const prompt = `You are evaluating outreach prospects for RollCallAfrica, a pan-African entertainment intelligence publication.

ARTICLE: "${article.title}"
ARTICLE URL: ${article.link}
ARTICLE TOPIC: ${article.content?.replace(/<[^>]+>/g, "").slice(0, 500)}

SEARCH RESULTS:
${resultsText}

Identify real journalists, newsletter writers, or podcast hosts who cover African entertainment, Nollywood, or related topics. For each valid prospect, return:
[{
  "name": "Full name if identifiable",
  "title": "Job title",
  "outlet": "Publication or outlet",
  "outreachType": "citation or newsletter or podcast or collaboration",
  "warmth": "HOT or WARM or COLD",
  "whyRelevant": "Why they'd care about this article",
  "recentWork": "Their relevant recent piece/episode",
  "recentWorkUrl": "URL",
  "email": "if public",
  "twitter": "@handle if found",
  "linkedin": "profile name if found"
}]

Only include people with clear relevance (score 7+). Return ONLY valid JSON array.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content.find(b => b.type === "text")?.text || "[]";
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean.match(/\[[\s\S]*\]/)?.[0] || "[]");
  } catch { return []; }
}

// ─── 3. DRAFT PERSONALISED PITCHES ───────────────────────────────────────────

async function draftPitch(article, prospect) {
  const siteName = process.env.SITE_NAME || "RollCallAfrica";
  const siteUrl = process.env.SITE_URL || "https://rollcallafrica.com";

  const typeContext = {
    citation: "You want them to cite this article as a source in a future piece they write.",
    newsletter: "You want them to feature or reference this article in their next newsletter issue.",
    podcast: "You want them to discuss this topic, potentially inviting a RollCallAfrica voice as a guest.",
    collaboration: "You're proposing a content partnership, cross-publication, or co-authored piece.",
  };

  const prompt = `Draft a professional outreach pitch email for this media contact.

FROM: ${siteName} (${siteUrl})
TO: ${prospect.name} — ${prospect.title} at ${prospect.outlet}
THEIR RECENT WORK: ${prospect.recentWork}
OUTREACH GOAL: ${typeContext[prospect.outreachType] || typeContext.citation}

ARTICLE TO PITCH:
Title: "${article.title}"
URL: ${article.link}
Key argument: ${article.content?.replace(/<[^>]+>/g, "").slice(0, 400)}

Rules:
- Open with a specific reference to their recent work (NOT generic praise)
- Connect their work to why this article is relevant to their audience
- Make the ask clear, specific, and low-friction
- 150-180 words maximum
- Sound like a peer reaching out, not a PR pitch
- No "I hope this email finds you well"
- No "please find attached"
- Sign off as: [Your name] / ${siteName} / ${siteUrl}

Also write a subject line (max 8 words, specific, no click-bait).

Return JSON: { "subject": "...", "body": "..." }`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content.find(b => b.type === "text")?.text || "{}";
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean.match(/\{[\s\S]*\}/)?.[0] || "{}");
  } catch { return { subject: "", body: "" }; }
}

// ─── 4. SAVE DRAFTS TO GMAIL ──────────────────────────────────────────────────

/**
 * Creates Gmail drafts (not sends) so you can review in your inbox.
 * Requires OAuth2 credentials. Setup:
 *  1. Enable Gmail API in Google Cloud Console
 *  2. Create OAuth2 credentials
 *  3. Get refresh token via oauth2 flow
 *  4. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in .env
 */
async function saveToGmailDrafts(prospect, pitch) {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !prospect.email) return null;

  try {
    // Refresh access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GMAIL_CLIENT_ID,
        client_secret: GMAIL_CLIENT_SECRET,
        refresh_token: GMAIL_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });
    const { access_token } = await tokenRes.json();

    // Compose RFC 2822 message
    const message = [
      `To: ${prospect.email}`,
      `Subject: ${pitch.subject}`,
      `Content-Type: text/plain; charset=utf-8`,
      "",
      pitch.body,
    ].join("\n");

    const encoded = Buffer.from(message).toString("base64url");

    // Create draft
    const draftRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: { raw: encoded } }),
    });

    if (draftRes.ok) {
      console.log(`   ✓ Gmail draft created: ${prospect.name} <${prospect.email}>`);
      return await draftRes.json();
    }
  } catch (e) {
    console.warn(`   ⚠️  Gmail draft failed for ${prospect.name}:`, e.message);
  }
  return null;
}

// ─── 5. EMAIL DIGEST FOR REVIEW ───────────────────────────────────────────────

async function emailDigest(article, pitches) {
  const reviewEmail = process.env.REVIEW_EMAIL;
  const smtpHost = process.env.SMTP_HOST;

  if (!smtpHost || !reviewEmail) {
    console.log("\n   ─── OUTREACH DIGEST (configure SMTP to receive by email) ───");
    pitches.forEach((p, i) => {
      console.log(`\n   [${i + 1}] ${p.name} — ${p.outlet} (${p.warmth})`);
      console.log(`   Subject: ${p.pitch?.subject}`);
      console.log(`   Preview: ${p.pitch?.body?.slice(0, 80)}...`);
    });
    return;
  }

  const warmthColor = { HOT: "#E8734A", WARM: "#C8A96E", COLD: "#5B9BD5" };

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const html = `
<div style="font-family:Georgia,serif;max-width:680px;margin:0 auto;background:#0f0f0f;color:#e8e0d0;padding:32px">
  <div style="font-size:9px;letter-spacing:3px;color:#555;font-family:monospace;margin-bottom:8px">ROLLCALLAFRICA — OUTREACH AGENT DIGEST</div>
  <h1 style="font-size:20px;color:#B57BCC;font-weight:400;margin:0 0 8px">Press & Outreach Report</h1>
  <p style="font-size:13px;color:#777;margin:0 0 24px">Article: <em>${article.title}</em></p>

  ${pitches.map((p, i) => `
  <div style="background:#1a1a1a;border-left:3px solid ${warmthColor[p.warmth] || "#555"};padding:16px;margin-bottom:16px;border-radius:0 4px 4px 0">
    <div style="display:flex;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:14px;color:#e8e0d0">${p.name}</span>
      <span style="font-size:9px;letter-spacing:2px;color:${warmthColor[p.warmth]};font-family:monospace">${p.warmth}</span>
    </div>
    <div style="font-size:11px;color:#666;margin-bottom:12px">${p.title} · ${p.outlet}</div>
    <div style="background:#111;padding:10px 12px;border-radius:3px;margin-bottom:10px">
      <div style="font-size:10px;color:#444;font-family:monospace;margin-bottom:4px">SUBJECT</div>
      <div style="font-size:12px;color:#bbb">${p.pitch?.subject || "—"}</div>
    </div>
    <div style="background:#111;padding:10px 12px;border-radius:3px;margin-bottom:10px">
      <div style="font-size:10px;color:#444;font-family:monospace;margin-bottom:6px">DRAFT PITCH</div>
      <div style="font-size:12px;color:#999;line-height:1.7;white-space:pre-wrap">${p.pitch?.body || "—"}</div>
    </div>
    ${p.email ? `<div style="font-size:11px;color:#555;font-family:monospace">✉ ${p.email}</div>` : ""}
    ${p.twitter ? `<div style="font-size:11px;color:#555;font-family:monospace">𝕏 ${p.twitter}</div>` : ""}
  </div>`).join("")}

  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #1a1a1a;font-size:10px;color:#333;font-family:monospace;text-align:center">
    ALWAYS PERSONALISE BEFORE SENDING — ROLLCALLAFRICA OUTREACH AGENT
  </div>
</div>`;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: reviewEmail,
    subject: `[RollCallAfrica] ${pitches.length} outreach pitches ready — "${article.title}"`,
    html,
  });

  console.log(`✓ Outreach digest emailed to ${reviewEmail}`);
}

// ─── 6. FULL PIPELINE ─────────────────────────────────────────────────────────

export async function runOutreachPipeline(article) {
  console.log(`\n📬 Outreach Agent: "${article.title}"`);

  // Step 1: Discover
  console.log("   Discovering prospects...");
  const rawResults = await discoverProspects(article);
  console.log(`   ${rawResults.length} raw results`);

  // Step 2: Profile
  console.log("   Profiling and scoring prospects...");
  const prospects = await profileProspects(article, rawResults);
  console.log(`   ${prospects.length} qualified prospects`);

  if (!prospects.length) {
    console.log("   No strong prospects found for this article.");
    return [];
  }

  // Step 3: Draft pitches
  const pitches = [];
  for (const prospect of prospects.slice(0, 6)) {
    try {
      console.log(`   Drafting pitch for ${prospect.name} (${prospect.outlet})...`);
      const pitch = await draftPitch(article, prospect);
      const entry = { ...prospect, pitch };
      pitches.push(entry);

      // Step 4: Save to Gmail (if email + creds available)
      if (prospect.email) {
        await saveToGmailDrafts(prospect, pitch);
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn(`   ⚠️  Pitch failed for ${prospect.name}:`, e.message);
    }
  }

  console.log(`\n   ─── OUTREACH SUMMARY ───`);
  console.log(`   HOT: ${pitches.filter(p => p.warmth === "HOT").length}`);
  console.log(`   WARM: ${pitches.filter(p => p.warmth === "WARM").length}`);
  console.log(`   Total pitches drafted: ${pitches.length}`);

  // Step 5: Email digest
  await emailDigest(article, pitches);

  return pitches;
}

// ─── 7. INTERVIEW REQUEST PIPELINE ───────────────────────────────────────────

/**
 * Identifies key figures in an article and drafts exclusive interview requests.
 * Routes via publicist when direct contact is unavailable.
 */
export async function runInterviewPipeline(article, formats = ["written", "exclusive"]) {
  console.log(`\n🎬 Interview Agent: "${article.title}"`);

  const siteName = process.env.SITE_NAME || "RollCallAfrica";
  const siteUrl = process.env.SITE_URL || "https://rollcallafrica.com";
  const serperKey = process.env.SERPER_API_KEY;

  const formatLabels = {
    written: "Written Q&A (email-based)",
    video: "Video interview (recorded)",
    phone: "Phone/voice call",
    exclusive: "Exclusive profile feature",
  };

  const preferredFormats = formats.map(f => formatLabels[f] || f).join(", ");

  // Step 1: Extract subjects and find contacts via web search
  const rawResults = [];

  if (serperKey) {
    const excerpt = article.content?.replace(/<[^>]+>/g, "").slice(0, 600) || "";
    const searchQueries = [
      `${article.title} filmmaker director contact`,
      `${article.title} publicist Nigeria film`,
      `nollywood director producer publicist contact`,
    ];

    for (const q of searchQueries.slice(0, 2)) {
      try {
        const res = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q, num: 5, gl: "ng" }),
        });
        const data = await res.json();
        rawResults.push(...(data.organic || []));
        await new Promise(r => setTimeout(r, 250));
      } catch (e) {
        console.warn(`   ⚠️  Search failed: ${q}`);
      }
    }
  }

  const searchContext = rawResults.length
    ? rawResults.slice(0, 8).map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet}`).join("\n\n")
    : "No search results available — use article text only.";

  // Step 2: Generate interview packages via Claude
  console.log("   Building interview request packages...");

  const prompt = `You are the Interview Request Agent for ${siteName}, a pan-African entertainment intelligence publication — the African equivalent of Variety.

ARTICLE TITLE: "${article.title}"
ARTICLE URL: ${article.link}
ARTICLE TEXT: ${article.content?.replace(/<[^>]+>/g, "").slice(0, 800)}

WEB SEARCH CONTEXT:
${searchContext}

PREFERRED INTERVIEW FORMATS: ${preferredFormats}

Identify every named filmmaker, director, producer, actor, or industry figure in the article. For each, build an interview request package.

Return JSON array, sorted HOT first:
[{
  "name": "Full name",
  "role": "Director / Producer / Actor / Executive",
  "knownFor": "Signature work",
  "warmth": "HOT (named + contactable) | WARM (mentioned, findable) | COLD (referenced only)",
  "routeViaRep": true or false,
  "whyNow": "Why interviewing them right now matters editorially",
  "interviewFormat": "${formats[0] || "written"}",
  "interviewAngles": [
    "Specific angle 1 rooted in article",
    "Tension or contradiction to press",
    "Industry question only they can answer"
  ],
  "email": "if found",
  "twitter": "@handle if found",
  "instagram": "@handle if found",
  "repName": "Publicist name if found",
  "repEmail": "Rep email if found",
  "repNote": "How to approach the rep",
  "emailSubject": "Interview Request: [Name] for ${siteName}",
  "emailBody": "Full request pitch. 190-220 words. Address rep or subject appropriately. Establish ${siteName}'s editorial credibility in 2 sentences. State why their perspective is essential now. Clear ask with format and time commitment. One specific angle. Peer-level tone — editorial authority, not fan mail. Sign off as Editor, ${siteName}, ${siteUrl}.",
  "sendingNote": "Best channel + timing"
}]

Return ONLY the JSON array. No markdown.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content.find(b => b.type === "text")?.text || "[]";
  const clean = raw.replace(/```json|```/g, "").trim();

  let subjects = [];
  try {
    subjects = JSON.parse(clean.match(/\[[\s\S]*\]/)?.[0] || "[]");
  } catch { subjects = []; }

  console.log(`   ${subjects.length} interview targets identified`);
  subjects.forEach((s, i) => {
    console.log(`   [${i + 1}] ${s.name} (${s.role}) — ${s.warmth}${s.routeViaRep ? " via rep" : ""}`);
  });

  // Step 3: Save Gmail drafts for HOT targets
  for (const subject of subjects.filter(s => s.warmth === "HOT")) {
    const contactEmail = subject.routeViaRep ? subject.repEmail : subject.email;
    if (contactEmail) {
      await saveToGmailDrafts(
        { name: subject.routeViaRep ? subject.repName : subject.name, email: contactEmail },
        { subject: subject.emailSubject, body: subject.emailBody }
      );
    }
  }

  // Step 4: Email digest
  await emailDigest(article, subjects.map(s => ({
    ...s,
    outreachType: "interview",
    pitch: { subject: s.emailSubject, body: s.emailBody },
  })));

  return subjects;
}
