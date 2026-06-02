// Vercel serverless function: book recommender chat.
// Receives: { kidContext, messages } where messages is the conversation [{role:'user'|'assistant', content:string}, ...]
// Returns: { message: string }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server not configured' });

  const ctx = (body && body.kidContext) || {};
  const messages = (body && Array.isArray(body.messages)) ? body.messages : [];
  if (messages.length === 0) return res.status(400).json({ error: 'No messages' });
  // Clamp message history length (last 12)
  const trimmed = messages.slice(-12).map(m => ({
    role: (m.role === 'assistant' ? 'assistant' : 'user'),
    content: String(m.content || '').slice(0, 2000)
  }));

  const ageText = ctx.age ? ` They are ${ctx.age} years old.` : '';
  const loved = (ctx.loved || []).slice(0, 8).map(b => `${b.title}${b.author ? ' by ' + b.author : ''}`).join('; ');
  const liked = (ctx.liked || []).slice(0, 8).map(b => `${b.title}`).join('; ');
  const reading = (ctx.reading || []).slice(0, 5).map(b => `${b.title}`).join('; ');
  const want = (ctx.want || []).slice(0, 5).map(b => `${b.title}`).join('; ');
  const genres = (ctx.topGenres || []).join(', ');

  const systemPrompt = [
    `You are "Book Buddy", a warm, friendly book recommender for ${ctx.name || 'a kid'}.${ageText}`,
    `Keep responses short, kid-friendly, and natural — like a librarian friend, not a brochure.`,
    `Books they LOVED (5 stars): ${loved || '(none yet)'}.`,
    `Books they liked (4 stars): ${liked || '(none yet)'}.`,
    `Currently reading: ${reading || '(none)'}.`,
    `Want to read: ${want || '(none)'}.`,
    `Favorite genres so far: ${genres || '(unknown — ask if curious)'}.`,
    `When recommending a book, give title, author, and a 1-sentence pitch. Mention approximate length if you know it. If you're unsure about a book, say so.`,
    `Never recommend anything not age-appropriate.`,
    `Reply in 1-3 short paragraphs maximum.`
  ].join('\n');

  try {
    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: systemPrompt,
        messages: trimmed
      })
    });
    const data = await apiResp.json();
    if (!apiResp.ok) return res.status(502).json({ error: (data && data.error && data.error.message) || 'Anthropic API error' });
    const text = (data && data.content && data.content[0] && data.content[0].text) || '';
    return res.status(200).json({ message: text });
  } catch (e) {
    return res.status(500).json({ error: 'Chat failed: ' + (e && e.message ? e.message : String(e)) });
  }
};
