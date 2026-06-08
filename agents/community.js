/**
 * RollCallAfrica Community Agent
 * ───────────────────────────────
 * Finds active Reddit, Quora, and Facebook Group discussions
 * where a new article would genuinely add value.
 * Drafts authentic, human-sounding replies for human review.
 *
 * NEVER auto-posts. All output is staged for human approval.
 *
 * Prerequisites:
 *  - ANTHROPIC_API_KEY in .env
 *  - SERPER_API_KEY in .env (Google Search API — serper.dev)
 *  - REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT (optional, for deeper Reddit search)
 */

import Anthropic from "@anthropic-ai/sdk";
import nodemailer from "nodemailer";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── 1. SEARCH FOR RELEVANT THREADS ──────────────────────────────────────────

/**
 * Uses Serper (Google Search API) to find live community threads.
 * Much cheaper than Reddit API at scale. Returns raw search results.
 */
async function searchThreads(query, platform) {
  const platformQuery = {
    reddit: `site:reddit.com ${query}`,
    quora: `site:quora.com ${query}`,
    facebook: `site:facebook.com/groups ${query}`,
    twitter: `site:twitter.com OR site:x.com ${query}`,
  };

  const searchQuery = platformQuery[platform] || query;

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": process.env.SERPER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: searchQuery,
      num: 5,
      gl: "ng", // Nigeria-first results
    }),
  });

  if (!res.ok) throw new Error(`Serper API error: ${res.status}`);
  const data = await res.json();
  return data.organic || [];
}

// ─── 2. SCORE AND FILTER RESULTS ─────────────────────────────────────────────

/**
 * Asks Claude to score and filter raw search results for relevance.
 */
async function scoreAndFilter(article, rawResults) {
  if (!rawResults.length) return [];

  const resultsText = rawResults
    .map((r, i) => `${i + 1}. [${r.title}]\n   URL: ${r.link}\n   Snippet: ${r.snippet}`)
    .join("\n\n");

  const prompt = `You are evaluating community threads to find where this article would genuinely help people.

ARTICLE: "${article.title}"
ARTICLE URL: ${article.link}
ARTICLE TOPIC: ${article.content?.replace(/<[^>]+>/g, "").slice(0, 400)}

SEARCH RESULTS:
${resultsText}

For each result, decide if posting this article there would:
1. Actually answer a question people have
2. Add real value to an ongoing discussion
3. Not feel like spam

Return a JSON array of ONLY the relevant ones:
[{
  "index": <original number>,
  "url": "thread URL",
  "title": "thread title",
  "platform": "reddit|quora|facebook|twitter",
  "relevanceScore": <1-10>,
  "relevanceReason": "Why this belongs in this thread"
}]

Exclude anything with score below 6. Return ONLY JSON.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content.find(b => b.type === "text")?.text || "[]";
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(clean.match(/\[[\s\S]*\]/)?.[0] || "[]");
  } catch {
    return [];
  }
}

// ─── 3. DRAFT AUTHENTIC REPLIES ───────────────────────────────────────────────

/**
 * Drafts a genuine, helpful reply for a specific thread.
 * Tone: industry professional, not marketer.
 */
async function draftReply(article, thread) {
  const platformTone = {
    reddit: "conversational, direct, no corporate speak. Reddit culture means being genuinely helpful or getting downvoted. Reference the subreddit context.",
    quora: "expert but accessible. Quora readers want real insight, not a pitch. Answer the question fully first, then mention the source.",
    facebook: "warm but professional. Facebook Group members know each other. Sound like a peer sharing a find, not a brand promoting content.",
    twitter: "sharp, short, punchy. Twitter/X replies need to add a take, not just share a link. One strong sentence + link.",
  };

  const prompt = `Draft a reply for this community thread. You are a Nollywood/African entertainment industry professional sharing genuinely useful information.

THREAD: "${thread.title}"
THREAD URL: ${thread.url}
PLATFORM: ${thread.platform}
TONE GUIDE: ${platformTone[thread.platform] || "professional and helpful"}

ARTICLE TO REFERENCE: "${article.title}"
ARTICLE URL: ${article.link}
ARTICLE SUMMARY: ${article.content?.replace(/<[^>]+>/g, "").slice(0, 500)}

Write a reply that:
- Adds real value to the discussion FIRST
- Sounds like a human who actually knows this space
- Mentions the article link ONCE and only if natural — not as the main point
- NEVER starts with "Great question!" or "I found this article..."
- Is specific to the thread topic, not generic
- Respects platform tone

Return ONLY the reply text. Nothing else.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content.find(b => b.type === "text")?.text?.trim() || "";
}

// ─── 4. COMPILE REPORT AND EMAIL FOR REVIEW ───────────────────────────────────

/**
 * Sends a digest email with all draft replies for human review.
 * Requires SMTP config in .env.
 */
async function emailDigest(article, opportunities) {
  const smtpHost = process.env.SMTP_HOST;
  const reviewEmail = process.env.REVIEW_EMAIL;

  if (!smtpHost || !reviewEmail) {
    console.warn("⚠️  SMTP not configured — printing to console only");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const html = `
<h2>Community Agent Report</h2>
<p><strong>Article:</strong> ${article.title}</p>
<p><strong>URL:</strong> <a href="${article.link}">${article.link}</a></p>
<p><strong>Opportunities found:</strong> ${opportunities.length}</p>
<hr>
${opportunities.map((o, i) => `
<h3>#${i + 1} — ${o.platform.toUpperCase()} (${o.relevanceScore}/10)</h3>
<p><strong>Thread:</strong> <a href="${o.url}">${o.title}</a></p>
<p><strong>Why:</strong> ${o.relevanceReason}</p>
<p><strong>Draft Reply:</strong></p>
<blockquote style="background:#f5f5f5;padding:12px;border-left:3px solid #ccc">
${o.draftReply?.replace(/\n/g, "<br>")}
</blockquote>
<p style="color:#888;font-size:12px">⚠️ Review and personalise before posting.</p>
<hr>
`).join("")}
`;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: reviewEmail,
    subject: `[RollCallAfrica] ${opportunities.length} community opportunities — "${article.title}"`,
    html,
  });

  console.log(`✓ Digest emailed to ${reviewEmail}`);
}

// ─── 5. FULL PIPELINE ─────────────────────────────────────────────────────────

export async function runCommunityPipeline(article) {
  console.log(`\n🌐 Community Agent: "${article.title}"`);

  const platforms = ["reddit", "quora", "facebook"];
  const allResults = [];

  // Generate search queries from article
  const queryWords = article.title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")
    .filter(w => w.length > 3)
    .slice(0, 5)
    .join(" ");

  const queries = [queryWords, "nollywood distribution cinema Nigeria", "african film industry streaming"];

  if (!process.env.SERPER_API_KEY) {
    console.warn("⚠️  SERPER_API_KEY not set — Community Agent requires Serper (serper.dev)");
    return [];
  }

  // Search all platforms
  for (const platform of platforms) {
    for (const query of queries.slice(0, 2)) {
      try {
        console.log(`   Searching ${platform}: "${query}"`);
        const results = await searchThreads(query, platform);
        allResults.push(...results.map(r => ({ ...r, _platform: platform })));
        await new Promise(r => setTimeout(r, 300)); // Rate limit
      } catch (e) {
        console.warn(`   ⚠️  ${platform} search failed:`, e.message);
      }
    }
  }

  console.log(`   ${allResults.length} raw results found`);

  // Score and filter
  const relevant = await scoreAndFilter(article, allResults);
  console.log(`   ${relevant.length} relevant threads after scoring`);

  if (!relevant.length) {
    console.log("   No high-relevance threads found for this article.");
    return [];
  }

  // Draft replies
  const opportunities = [];
  for (const thread of relevant.slice(0, 6)) {
    try {
      console.log(`   Drafting reply for: "${thread.title?.slice(0, 50)}..."`);
      const draftReply = await draftReply(article, thread);
      opportunities.push({ ...thread, draftReply });
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.warn(`   ⚠️  Draft failed for thread:`, e.message);
    }
  }

  // Log results
  console.log(`\n   ─── COMMUNITY OPPORTUNITIES ───`);
  opportunities.forEach((o, i) => {
    console.log(`\n   [${i + 1}] ${o.platform.toUpperCase()} — Score: ${o.relevanceScore}/10`);
    console.log(`   Thread: ${o.title}`);
    console.log(`   URL: ${o.url}`);
    console.log(`   Draft: ${o.draftReply?.slice(0, 100)}...`);
  });

  // Email digest for review
  await emailDigest(article, opportunities);

  return opportunities;
}
