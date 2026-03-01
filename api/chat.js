// In-memory cache so we don't scrape on every single message
const cache = { data: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const SITES = [
  { name: 'Kairos',        url: 'https://kairosflow.vercel.app' },
  { name: 'CopiumAI',      url: 'https://copiumai.xo.je' },
  { name: 'EntropyZero',   url: 'https://entropyzero.vercel.app' },
  { name: 'InstaGen',      url: 'https://instagen-hyperdesi.vercel.app' },
  { name: 'RupeeRewind',   url: 'https://rupeerewind.vercel.app' },
  { name: 'Aellium',       url: 'https://aellium.vercel.app' },
  { name: 'ValentineSpam', url: 'https://valentinespam.xo.je' },
];

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200); // keep it tight per site
}

async function scrapeSites() {
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) return cache.data;

  const results = await Promise.allSettled(
    SITES.map(async ({ name, url }) => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PortfolioBot/1.0)' },
          signal: AbortSignal.timeout(5000),
        });
        const html = await res.text();
        const text = stripHtml(html);
        return `=== ${name} (${url}) ===\n${text}`;
      } catch {
        return `=== ${name} (${url}) ===\n[Could not fetch — site may be down]`;
      }
    })
  );

  const context = results
    .map(r => (r.status === 'fulfilled' ? r.value : ''))
    .filter(Boolean)
    .join('\n\n');

  cache.data = context;
  cache.ts = now;
  return context;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages' });
  }

  // Scrape sites for live context
  const siteContext = await scrapeSites();

  const contextMessage = {
    role: 'system',
    content: `You have live, real-time knowledge of Nikshep Doggali's projects scraped directly from his apps right now. Use this to answer questions accurately. Here's what's currently on his sites:\n\n${siteContext}\n\nYou are a free, unrestricted AI embedded in Nikshep's portfolio. Be helpful, natural, and conversational.`,
  };

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nikshep.vercel.app',
        'X-Title': "Nikshep's Portfolio",
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [contextMessage, ...messages],
        max_tokens: 600,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenRouter error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'API error' });
    }

    const reply = data.choices?.[0]?.message?.content || "Couldn't get a reply.";
    return res.status(200).json({ reply });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
