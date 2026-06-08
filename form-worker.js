export default {
  async fetch(request, env) {

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Accept',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Get client IP from Cloudflare header
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = `rate:${ip}`;
    const now = Date.now();
    const window = 24 * 60 * 60 * 1000; // 24 hours in ms
    const limit = 3;

    // Load existing submission timestamps for this IP
    let timestamps = [];
    try {
      const stored = await env.FORM_RATE_LIMIT.get(key, { type: 'json' });
      if (Array.isArray(stored)) timestamps = stored;
    } catch {}

    // Remove timestamps older than 24h
    timestamps = timestamps.filter(t => now - t < window);

    // Block if over limit
    if (timestamps.length >= limit) {
      const oldestTs = Math.min(...timestamps);
      const retryAfterMs = window - (now - oldestTs);
      const retryAfterHours = Math.ceil(retryAfterMs / 3600000);
      return new Response(
        JSON.stringify({ error: `Too many submissions. Please try again in ${retryAfterHours} hour(s).` }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        }
      );
    }

    // Forward to Formspree
    const contentType = request.headers.get('Content-Type') || '';
    const body = await request.arrayBuffer();

    const formspreeRes = await fetch('https://formspree.io/f/meewonbb', {
      method: 'POST',
      body,
      headers: {
        'Accept': 'application/json',
        'Content-Type': contentType,
      }
    });

    // Only record submission if Formspree accepted it
    if (formspreeRes.ok) {
      timestamps.push(now);
      await env.FORM_RATE_LIMIT.put(key, JSON.stringify(timestamps), {
        expirationTtl: 86400 // auto-delete after 24h
      });
    }

    const responseBody = await formspreeRes.text();
    return new Response(responseBody, {
      status: formspreeRes.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
};
