// Vercel serverless function: identifies a book from a photo of its cover.
// Receives: { image: "data:image/jpeg;base64,..." } via POST
// Returns:  { title, author, series, series_number, confidence } or { error }
//
// The API key lives in the ANTHROPIC_API_KEY env var (set in Vercel dashboard).
// Never embed it in client code.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const image = body && body.image;
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Missing image' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server not configured (ANTHROPIC_API_KEY missing)' });
  }

  const dataUrlMatch = image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!dataUrlMatch) {
    return res.status(400).json({ error: 'Image must be a data URL' });
  }
  const mediaType = dataUrlMatch[1];
  const base64 = dataUrlMatch[2];

  const prompt =
    "You are identifying a children's or middle-grade book from a photo of its cover. " +
    "Look at the visible title and author text on the cover. " +
    "Respond with JSON only, no preamble, no markdown. " +
    "Exact shape: { \"title\": string|null, \"author\": string|null, \"series\": string|null, \"series_number\": number|null, \"confidence\": \"high\"|\"medium\"|\"low\" }. " +
    "If you cannot read the cover clearly, set confidence to \"low\" and title/author to your best guess (or null if no guess possible). " +
    "Do not invent a book that isn't on the cover.";

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
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await apiResp.json();
    if (!apiResp.ok) {
      return res.status(502).json({ error: (data && data.error && data.error.message) || ('Anthropic API ' + apiResp.status) });
    }

    const text = (data && data.content && data.content[0] && data.content[0].text) || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(502).json({ error: 'Model returned no JSON', raw: text.slice(0, 300) });
    }

    let book;
    try { book = JSON.parse(jsonMatch[0]); }
    catch (e) { return res.status(502).json({ error: 'Bad JSON from model', raw: jsonMatch[0].slice(0, 300) }); }

    return res.status(200).json({
      title: book.title || null,
      author: book.author || null,
      series: book.series || null,
      series_number: book.series_number != null ? book.series_number : null,
      confidence: book.confidence || 'low'
    });
  } catch (e) {
    return res.status(500).json({ error: 'Identification failed: ' + (e && e.message ? e.message : String(e)) });
  }
};
