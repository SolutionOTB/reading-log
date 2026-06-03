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
    "Exact shape: { \"title\": string|null, \"author\": string|null, \"series\": string|null, \"series_number\": number|null, \"genres\": string[], \"confidence\": \"high\"|\"medium\"|\"low\" }. " +
    "Genres should be 1-3 short labels like \"Animal\", \"Fantasy\", \"Comic\", \"Mystery\", \"Sci-fi\", \"Adventure\", \"Friendship\", \"Magic\", \"Historical\", \"Realistic\", \"Sports\", \"Humor\". Use your knowledge of the book to pick them. " +
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

    // Enrich with cover art + page count — Open Library first (free, no quota), Google Books fallback
    let cover_url = null;
    let pages = null;
    let google_books_id = null;
    if (book.title) {
      // === Try Open Library ===
      try {
        const q = encodeURIComponent(book.title + (book.author ? ' ' + book.author : ''));
        const olResp = await fetch('https://openlibrary.org/search.json?q=' + q + '&limit=5');
        if (olResp.ok) {
          const ol = await olResp.json();
          const docs = (ol && ol.docs) || [];
          // Prefer a doc with a cover_i
          const match = docs.find(d => d.cover_i) || docs[0];
          if (match) {
            if (match.cover_i) cover_url = 'https://covers.openlibrary.org/b/id/' + match.cover_i + '-L.jpg';
            if (!pages && match.number_of_pages_median) pages = match.number_of_pages_median;
          }
        }
      } catch (e) { /* non-fatal */ }

      // === Fallback to Google Books only if we still don't have a cover ===
      if (!cover_url) {
        try {
          const q = encodeURIComponent('intitle:' + book.title + (book.author ? ' inauthor:' + book.author : ''));
          const gbResp = await fetch('https://www.googleapis.com/books/v1/volumes?q=' + q + '&maxResults=3&printType=books');
          if (gbResp.ok) {
            const gb = await gbResp.json();
            const items = (gb && gb.items) || [];
            const match = items.find(it => it && it.volumeInfo && it.volumeInfo.imageLinks && it.volumeInfo.imageLinks.thumbnail) || items[0];
            if (match && match.volumeInfo) {
              const v = match.volumeInfo;
              google_books_id = match.id || null;
              if (!pages) pages = v.pageCount || null;
              if (v.imageLinks) {
                const link = v.imageLinks.extraLarge || v.imageLinks.large || v.imageLinks.medium || v.imageLinks.small || v.imageLinks.thumbnail || v.imageLinks.smallThumbnail;
                if (link) cover_url = link.replace(/^http:\/\//, 'https://').replace(/&edge=curl/g, '');
              }
            }
          }
        } catch (e) { /* non-fatal */ }
      }
    }

    return res.status(200).json({
      title: book.title || null,
      author: book.author || null,
      series: book.series || null,
      series_number: book.series_number != null ? book.series_number : null,
      genres: Array.isArray(book.genres) ? book.genres.slice(0, 3) : [],
      confidence: book.confidence || 'low',
      cover_url,
      pages,
      google_books_id
    });
  } catch (e) {
    return res.status(500).json({ error: 'Identification failed: ' + (e && e.message ? e.message : String(e)) });
  }
};
