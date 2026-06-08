/**
 * RollCallAfrica SEO Agent
 * ────────────────────────
 * For each new article:
 *  1. Generates SEO title, meta description, focus keyword, slug, schema type
 *  2. Suggests internal links from existing content
 *  3. Identifies content gaps
 *  4. Pings Google Indexing API to request fast crawl
 *
 * Prerequisites:
 *  - ANTHROPIC_API_KEY in .env
 *  - GOOGLE_SERVICE_ACCOUNT_JSON in .env (for Indexing API)
 *  - WORDPRESS_API_URL in .env (to fetch existing articles for internal linking)
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleAuth } from "google-auth-library";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── 1. FETCH EXISTING ARTICLE TITLES (for internal link context) ────────────

export async function fetchExistingTitles(limit = 50) {
  const wpUrl = process.env.WORDPRESS_API_URL;
  if (!wpUrl) {
    console.warn("⚠️  WORDPRESS_API_URL not set — skipping internal link context");
    return [];
  }

  try {
    const res = await fetch(
      `${wpUrl}/wp-json/wp/v2/posts?per_page=${limit}&_fields=title,link`
    );
    const posts = await res.json();
    return posts.map((p) => ({
      title: p.title.rendered.replace(/&#8217;/g, "'").replace(/&amp;/g, "&"),
      url: p.link,
    }));
  } catch (e) {
    console.warn("⚠️  Could not fetch existing articles:", e.message);
    return [];
  }
}

// ─── 2. GENERATE SEO DATA VIA CLAUDE ─────────────────────────────────────────

export async function generateSEOData(article, existingArticles = []) {
  const { title, content, link } = article;
  const excerpt = content?.replace(/<[^>]+>/g, "").slice(0, 1200) || "";
  const siteName = process.env.SITE_NAME || "RollCallAfrica";

  const existingList = existingArticles.length
    ? existingArticles
        .slice(0, 30)
        .map((a, i) => `${i + 1}. ${a.title} — ${a.url}`)
        .join("\n")
    : "No existing articles available.";

  const prompt = `You are an SEO strategist for ${siteName}, a pan-African entertainment intelligence publication.

Analyse this article and return a JSON SEO report.

ARTICLE TITLE: ${title}
ARTICLE URL: ${link}
ARTICLE EXCERPT:
${excerpt}

EXISTING SITE ARTICLES (for internal linking):
${existingList}

Return ONLY valid JSON with this structure:
{
  "seoTitle": "Optimised page title, 50-60 chars",
  "metaDescription": "Compelling meta description, 140-155 chars, includes keyword and CTA",
  "focusKeyword": "Primary 2-4 word keyword phrase",
  "secondaryKeywords": ["keyword2", "keyword3", "keyword4"],
  "slug": "url-friendly-slug",
  "schemaType": "Article or NewsArticle or Review",
  "openGraphTitle": "OG title for social sharing",
  "internalLinks": [
    {
      "anchorText": "text to hyperlink in article",
      "targetUrl": "URL from existing articles list",
      "targetTitle": "Title of target article",
      "insertionSuggestion": "Brief note on where to insert in the article"
    }
  ],
  "contentGaps": ["Gap 1", "Gap 2"],
  "seoScore": <0-100>,
  "readabilityScore": <0-100>,
  "indexingPriority": "HIGH or MEDIUM or LOW",
  "indexingReason": "One sentence explanation"
}

Return ONLY the JSON. No markdown. No preamble.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content.find((b) => b.type === "text")?.text || "{}";
  const clean = raw.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

// ─── 3. PING GOOGLE INDEXING API ─────────────────────────────────────────────

/**
 * Requests Google to crawl a URL via the Indexing API.
 * Requires a Google Service Account with "Owner" permission on GSC property.
 *
 * Setup:
 *  1. Enable "Indexing API" in Google Cloud Console
 *  2. Create a Service Account → download JSON key
 *  3. Add the service account email as an Owner in Google Search Console
 *  4. Set GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...} in .env
 */
export async function pingGoogleIndexing(url) {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    console.warn("⚠️  GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping indexing ping");
    return null;
  }

  try {
    const credentials = JSON.parse(serviceAccountJson);
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/indexing"],
    });

    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const res = await fetch(
      "https://indexing.googleapis.com/v3/urlNotifications:publish",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.token}`,
        },
        body: JSON.stringify({
          url,
          type: "URL_UPDATED",
        }),
      }
    );

    const result = await res.json();

    if (res.ok) {
      console.log(`✓ Google Indexing pinged: ${url}`);
    } else {
      console.warn(`⚠️  Indexing API error:`, result.error?.message);
    }

    return result;
  } catch (e) {
    console.warn("⚠️  Google Indexing ping failed:", e.message);
    return null;
  }
}

// ─── 4. APPLY META TAGS TO WORDPRESS POST (via WP REST API) ──────────────────

/**
 * Updates Yoast SEO meta fields on a WordPress post.
 * Requires WP Application Password set in .env.
 *
 * WP_APP_PASSWORD format: "username:application_password"
 */
export async function applyMetaToWordPress(postId, seoData) {
  const wpUrl = process.env.WORDPRESS_API_URL;
  const wpAuth = process.env.WP_APP_PASSWORD;

  if (!wpUrl || !wpAuth) {
    console.warn("⚠️  WP credentials not set — skipping meta apply");
    return null;
  }

  try {
    const [username, password] = wpAuth.split(":");
    const credentials = Buffer.from(`${username}:${password}`).toString("base64");

    // Update Yoast SEO fields (works if Yoast is installed)
    const res = await fetch(`${wpUrl}/wp-json/wp/v2/posts/${postId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({
        meta: {
          _yoast_wpseo_title: seoData.seoTitle,
          _yoast_wpseo_metadesc: seoData.metaDescription,
          _yoast_wpseo_focuskw: seoData.focusKeyword,
          _yoast_wpseo_opengraph_title: seoData.openGraphTitle,
        },
      }),
    });

    if (res.ok) {
      console.log(`✓ Meta tags applied to WP post ${postId}`);
    } else {
      const err = await res.json();
      console.warn(`⚠️  WP meta update failed:`, err.message);
    }

    return res.ok;
  } catch (e) {
    console.warn("⚠️  WP meta apply failed:", e.message);
    return null;
  }
}

// ─── 5. FULL PIPELINE ─────────────────────────────────────────────────────────

export async function runSEOPipeline(article) {
  console.log(`\n🔍 SEO Agent: "${article.title}"`);

  // Step 1: Get existing articles for internal link context
  const existingArticles = await fetchExistingTitles(50);
  console.log(`   Found ${existingArticles.length} existing articles for internal link analysis`);

  // Step 2: Generate SEO data
  console.log("   Generating SEO data via Claude...");
  const seoData = await generateSEOData(article, existingArticles);

  if (!seoData) {
    console.error("   ❌ Failed to parse SEO data");
    return null;
  }

  // Log summary
  console.log(`\n   ─── SEO RESULTS ───`);
  console.log(`   SEO Title:    ${seoData.seoTitle} (${seoData.seoTitle?.length}c)`);
  console.log(`   Meta Desc:    ${seoData.metaDescription?.slice(0, 80)}... (${seoData.metaDescription?.length}c)`);
  console.log(`   Focus KW:     ${seoData.focusKeyword}`);
  console.log(`   SEO Score:    ${seoData.seoScore}/100`);
  console.log(`   Index:        ${seoData.indexingPriority}`);
  console.log(`   Internal Links: ${seoData.internalLinks?.length || 0} suggested`);

  // Step 3: Ping Google Indexing API
  if (article.link && seoData.indexingPriority !== "LOW") {
    await pingGoogleIndexing(article.link);
  }

  // Step 4: Apply to WordPress (if post ID available)
  if (article.postId) {
    await applyMetaToWordPress(article.postId, seoData);
  }

  return seoData;
}
