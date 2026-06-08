/**
 * Queues a post to Buffer for human review + scheduled publish.
 * Buffer API docs: https://buffer.com/developers/api
 */

const BUFFER_API = "https://api.bufferapp.com/1";

/**
 * Fetches your Buffer profile IDs (needed to queue posts)
 */
export async function getProfileIds() {
  const res = await fetch(
    `${BUFFER_API}/profiles.json?access_token=${process.env.BUFFER_ACCESS_TOKEN}`
  );
 const profiles = await res.json();
  if (!Array.isArray(profiles)) {
    console.warn('⚠️  Buffer API unexpected response:', JSON.stringify(profiles));
    return [];
  }
  return profiles.map((p) => ({
    service: p.service, // "twitter", "linkedin", "instagram", etc.
    handle: p.service_username,
  }));
}

/**
 * Queues a single post to Buffer.
 * @param {string} profileId - Buffer profile ID
 * @param {string} text - Post content
 * @param {boolean} top - Queue at top (true) or bottom (false)
 */
export async function queuePost(profileId, text, top = false) {
  const body = new URLSearchParams({
    access_token: process.env.BUFFER_ACCESS_TOKEN,
    profile_ids: profileId,
    text,
    top: top ? "1" : "0",
    now: "0", // Queue for scheduled time, not immediate
  });

  const res = await fetch(`${BUFFER_API}/updates/create.json`, {
    method: "POST",
    body,
  });

  return res.json();
}

/**
 * Queues all platform posts to their respective Buffer profiles.
 * @param {Object} posts - { twitter, linkedin, threads }
 * @param {Array} profiles - From getProfileIds()
 */
export async function queueAllPlatforms(posts, profiles) {
  const results = [];

  const serviceMap = {
    twitter: posts.twitter,
    linkedin: posts.linkedin,
    threads: posts.threads,
  };

  for (const [service, content] of Object.entries(serviceMap)) {
    if (!content) continue;
    const profile = profiles.find((p) => p.service === service);
    if (!profile) {
      console.warn(`⚠️  No Buffer profile found for ${service}`);
      continue;
    }
    const result = await queuePost(profile.id, content);
    results.push({ service, status: result.success ? "queued" : "failed", result });
    console.log(`✓ ${service}: ${result.success ? "queued to Buffer" : "FAILED"}`);
  }

  return results;
}
