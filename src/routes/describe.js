import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import db from '../db/knex.js';
import { readFile } from '../services/storage.js';
import config from '../config.js';

const router = Router();

router.get('/screenshot/:id/describe', auth, async (req, res) => {
  if (!config.geminiApiKey) {
    return res.status(400).json({ error: 'GEMINI_API_KEY not configured. Get a free key at https://aistudio.google.com/apikey' });
  }

  try {
    const screenshot = await db('screenshots')
      .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
      .where({ 'screenshots.id': req.params.id, 'api_keys.user_id': req.apiKey.userId })
      .select('screenshots.url', 'screenshots.storage_path', 'screenshots.baseline_id', 'screenshots.format')
      .first();

    if (!screenshot) {
      return res.status(404).json({ error: 'not_found' });
    }

    if (!screenshot.baseline_id) {
      return res.status(400).json({ error: 'no_baseline', message: 'Screenshot has no baseline to compare against' });
    }

    const baseline = await db('screenshots')
      .where({ id: screenshot.baseline_id })
      .select('storage_path', 'format')
      .first();

    if (!baseline) {
      return res.status(404).json({ error: 'baseline_not_found' });
    }

    const [currentBuf, baselineBuf] = await Promise.all([
      readFile(screenshot.storage_path),
      readFile(baseline.storage_path),
    ]);

    const currentB64 = currentBuf.toString('base64');
    const baselineB64 = baselineBuf.toString('base64');
    const mime = screenshot.format === 'jpeg' ? 'image/jpeg' : 'image/png';

    const body = {
      contents: [{
        parts: [
          { text: 'You are a UI testing tool. Compare these two screenshots (baseline = left/before, current = right/after). Describe ONLY the visual differences in 1-3 concise bullet points. Focus on layout shifts, color changes, new/hidden elements, text changes, and position changes. Be specific about locations (header, footer, sidebar, main content, etc.). If they are identical, say "No visual differences detected."' },
          { inline_data: { mime_type: mime, data: baselineB64 } },
          { inline_data: { mime_type: mime, data: currentB64 } },
        ],
      }],
    };

    let lastErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        const delay = [2000, 4000, 6000, 8000][attempt - 1];
        await new Promise(r => setTimeout(r, delay));
      }
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (geminiRes.ok) {
        const geminiData = await geminiRes.json();
        const description = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || 'No description returned.';
        return res.json({ description });
      }
      lastErr = geminiRes.status;
      const errText = await geminiRes.text();
      if (geminiRes.status !== 429) {
        console.error('Gemini API error:', geminiRes.status, errText);
        break;
      }
      console.error('Gemini API rate limited (429), retrying...');
    }

    console.error('Gemini API error:', lastErr);
    return res.status(502).json({ error: 'ai_service_error', message: `Gemini API returned ${lastErr}` });
  } catch (err) {
    console.error('Describe error:', err);
    res.status(502).json({ error: 'describe_failed', message: err.message });
  }
});

export default router;
