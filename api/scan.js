// Vercel serverless function: POST /api/scan
// Body: { image: "<base64>", mimeType: "image/jpeg" }
// Returns the receipt as JSON: { name, items:[{name, price, qty}], fees:[{label, amount}], tax, tip, total }
//
// Environment variables (set in Vercel → Project → Settings → Environment Variables):
//   GEMINI_API_KEY   required — from https://aistudio.google.com/apikey
//   GEMINI_MODEL     optional — defaults to gemini-3.5-flash
//   ALLOWED_ORIGINS  optional — comma-separated list of sites allowed to call this

const DEFAULT_ORIGINS = ['https://matthewfriedler.github.io', 'http://localhost:3000', 'http://127.0.0.1:5500'];
const MAX_BASE64 = 6 * 1024 * 1024; // ~4.5 MB image

const PROMPT = `You are reading a photo of a restaurant or bar receipt. Extract it as JSON with exactly this shape:
{
  "name": string,            // restaurant name
  "items": [ { "name": string, "qty": integer, "price": number } ],  // price = the LINE TOTAL printed for that line
  "fees": [ { "label": string, "amount": number } ],  // surcharges such as "SF Mandates", "Cost of SF ordinances", service charges
  "tax": number,             // sales tax amount, 0 if none
  "tip": number,             // tip / gratuity already added on the receipt, 0 if none or blank
  "total": number            // final amount charged, including tip if shown
}
Rules:
- Only include food and drink lines in "items". Skip subtotal, tax, tip, total, payment, card, and "suggested tip" lines.
- Modifier lines under an item (e.g. "Hum, Lab, Muh" or "($4.00 each)") are part of that item, not separate items.
- Quantity can appear before the name ("2 Horchata Colada") or after it ("Side Pita x 2"). Put the number in "qty" and keep "price" as the line total.
- Numbers only, no "$" signs. If something is unreadable, make your best guess rather than leaving it out.
Return only the JSON.`;

function cors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const list = allowed.length ? allowed : DEFAULT_ORIGINS;
  const origin = req.headers.origin || '';
  if (list.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return list.includes(origin);
}

function parseJSON(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch (e) { /* fall through */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

module.exports = async function handler(req, res) {
  const okOrigin = cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!okOrigin) return res.status(403).json({ error: 'This site is not allowed to use the scanner' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Scanner is not set up yet (missing GEMINI_API_KEY)' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const image = String(body.image || '').replace(/^data:[^,]+,/, '');
  const mimeType = /^image\/(jpeg|png|webp|heic|heif)$/.test(body.mimeType) ? body.mimeType : 'image/jpeg';
  if (!image) return res.status(400).json({ error: 'No image received' });
  if (image.length > MAX_BASE64) return res.status(413).json({ error: 'Image is too large' });

  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: image } }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data.error && data.error.message) || `Gemini returned ${r.status}`;
      return res.status(r.status === 429 ? 429 : 502).json({ error: r.status === 429 ? 'Free scan limit reached — try again later' : msg });
    }
    const text = (((data.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || '').join('') || '';
    const receipt = parseJSON(text);
    if (!receipt) return res.status(502).json({ error: 'Could not read the receipt' });
    return res.status(200).json(receipt);
  } catch (err) {
    return res.status(502).json({ error: 'Scanner request failed' });
  }
};
