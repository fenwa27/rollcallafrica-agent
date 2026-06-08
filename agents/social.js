import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generates platform-native social content for a given article.
 * @param {Object} article - { title, content, link, pubDate }
 * @returns {Object} - { twitter, linkedin, threads }
 */
export async function generateSocialContent(article) {
  const { title, content, link } = article;
  const siteName = process.env.SITE_NAME || "RollCallAfrica";

  // Trim content to ~800 chars to stay within token budget
  const excerpt = content?.replace(/<[^>]+>/g, "").slice(0, 800) || "";

  const systemPrompt = `You are a sharp editorial writer for ${siteName}, a pan-African entertainment intelligence publication — the African equivalent of Variety and The Hollywood Reporter. Your writing is culturally specific, industry-informed, and never generic. You write for professionals in the African film, TV, and music industries.`;

  const userPrompt = `Generate social media posts for this article across three platforms.

ARTICLE TITLE: ${title}
ARTICLE EXCERPT: ${excerpt}
ARTICLE URL: ${link}

Return a valid JSON object with exactly these keys:
{
  "twitter": "Full tweet thread. Format: '1/ [hook]\\n\\n2/ [insight]\\n\\n3/ [insight]\\n\\n4/ [CTA + URL]'. Each tweet max 280 chars.",
  "linkedin": "LinkedIn post. Bold industry observation as opener. 2-3 short paragraphs. Close with a question for professionals. No hashtags. No 'I am excited to share' language.",
  "threads": "Threads post. Casual but sharp. One strong take. End with: ${link}. Max 250 words."
}

Return ONLY the JSON. No markdown fences. No preamble.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = response.content.find((b) => b.type === "text")?.text || "{}";

  try {
    return JSON.parse(raw);
  } catch {
    // Fallback: extract JSON from response if wrapped
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { twitter: "", linkedin: "", threads: "" };
  }
}
