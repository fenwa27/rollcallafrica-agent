
/**
 * RollCallAfrica Traffic Agent — Orchestrator v1.5 (COMPLETE)
 * ─────────────────────────────────────────────────────────────
 * Daily (9am):      Social + SEO + Community + Outreach per new article
 * Weekly (Mon 7am): Content Intelligence — editorial brief for the week
 * Weekly (Mon 8am): Monitor — performance digest + agent instructions
 *
 * Cron:
 *   0 9 * * *    cd /path && node index.js
 *   0 7 * * 1    cd /path && node index.js --content-intel
 *   0 8 * * 1    cd /path && node index.js --monitor
 */

import "dotenv/config";
import Parser from "rss-parser";
import { generateSocialContent } from "./agents/social.js";
import { getProfileIds, queueAllPlatforms } from "./agents/buffer.js";
import { runSEOPipeline } from "./agents/seo.js";
import { runCommunityPipeline } from "./agents/community.js";
import { runOutreachPipeline, runInterviewPipeline } from "./agents/outreach.js";
import { runMonitorPipeline } from "./agents/monitor.js";
import { runContentIntelPipeline } from "./agents/content-intel.js";

const rssParser = new Parser();
const RSS_URL = process.env.RSS_FEED_URL || "https://rollcallafrica.com/feed";
const LOOKBACK_HOURS = 720;
const IS_MONITOR = process.argv.includes("--monitor");
const IS_CONTENT_INTEL = process.argv.includes("--content-intel");

async function getNewArticles() {
  console.log(`\n📡 Fetching RSS: ${RSS_URL}`);
  const feed = await rssParser.parseURL(RSS_URL);
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const fresh = feed.items.filter(item => new Date(item.pubDate) > cutoff);
  console.log(`   ${fresh.length} new article(s) in last ${LOOKBACK_HOURS}h`);
  return fresh;
}

async function processArticle(article, bufferProfiles) {
  console.log(`\n${"═".repeat(56)}\n📝 "${article.title}"\n${"═".repeat(56)}`);
  const results = {};

  try { console.log("\n[1/4] SOCIAL"); const posts = await generateSocialContent({ title: article.title, content: article.content || article.contentSnippet || "", link: article.link }); if (bufferProfiles.length) await queueAllPlatforms(posts, bufferProfiles); results.social = posts; } catch (e) { console.error("   ❌", e.message); }
  try { console.log("\n[2/4] SEO"); results.seo = await runSEOPipeline({ title: article.title, content: article.content || "", link: article.link, postId: article.id }); } catch (e) { console.error("   ❌", e.message); }
  try { console.log("\n[3/4] COMMUNITY"); results.community = await runCommunityPipeline({ title: article.title, content: article.content || "", link: article.link }); } catch (e) { console.error("   ❌", e.message); }
  try { console.log("\n[4/4] OUTREACH + INTERVIEW"); await runOutreachPipeline({ title: article.title, content: article.content || "", link: article.link }); await runInterviewPipeline({ title: article.title, content: article.content || "", link: article.link }); } catch (e) { console.error("   ❌", e.message); }

  return results;
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║  ROLLCALLAFRICA TRAFFIC AGENT — COMPLETE v1.5     ║");
  console.log("║  Social · SEO · Community · Outreach · Monitor    ║");
  console.log("║  + Content Intelligence                            ║");
  console.log("╚════════════════════════════════════════════════════╝");

  if (!process.env.ANTHROPIC_API_KEY) { console.error("❌ ANTHROPIC_API_KEY missing"); process.exit(1); }

  if (IS_CONTENT_INTEL) { await runContentIntelPipeline(); return; }
  if (IS_MONITOR) { await runMonitorPipeline(); return; }

  let bufferProfiles = [];
  if (process.env.BUFFER_ACCESS_TOKEN) {
    try { bufferProfiles = await getProfileIds(); console.log(`\n🔗 Buffer: ${bufferProfiles.length} profile(s)`); }
    catch (e) { console.warn("⚠️  Buffer:", e.message); }
  }

  const articles = await getNewArticles();
  if (!articles.length) { console.log("\n✅ No new articles. Done.\n"); return; }

  const results = [];
  for (const article of articles) {
    try { results.push({ title: article.title, status: "success", ...(await processArticle(article, bufferProfiles)) }); }
    catch (e) { console.error(`\n❌ "${article.title}":`, e.message); results.push({ title: article.title, status: "error" }); }
  }

  const ok = results.filter(r => r.status === "success").length;
  console.log(`\n${"═".repeat(56)}\n✅ DONE — ${ok}/${results.length} processed\n${"═".repeat(56)}\n`);
}

main().catch(console.error);
