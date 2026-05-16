import { Router } from 'express';
import sharp from 'sharp';
import { auth } from '../middleware/auth.js';
import db from '../db/knex.js';
import { readFile } from '../services/storage.js';
import config from '../config.js';

const router = Router();

async function describeGemini(baselineB64, currentB64, mime) {
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
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.geminiApiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    if (res.ok) {
      const data = await res.json();
      return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No description returned.';
    }
    lastErr = res.status;
    const errText = await res.text();
    if (res.status !== 429) {
      console.error('Gemini API error:', res.status, errText);
      break;
    }
    console.error('Gemini API rate limited (429), retrying...');
  }
  throw new Error(`Gemini API returned ${lastErr}`);
}

async function describeHuggingFace(baselineBuf, currentBuf) {
  const [left, right] = await Promise.all([
    sharp(baselineBuf).resize({ width: 800, fit: 'inside' }).toBuffer(),
    sharp(currentBuf).resize({ width: 800, fit: 'inside' }).toBuffer(),
  ]);

  const [leftMeta, rightMeta] = await Promise.all([
    sharp(left).metadata(),
    sharp(right).metadata(),
  ]);

  const compositeHeight = Math.max(leftMeta.height, rightMeta.height);
  const compositeWidth = leftMeta.width + rightMeta.width;

  const composite = await sharp({
    create: {
      width: compositeWidth,
      height: compositeHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([
      { input: left, top: 0, left: 0 },
      { input: right, top: 0, left: leftMeta.width },
    ])
    .png()
    .toBuffer();

  const dataUrl = `data:image/png;base64,${composite.toString('base64')}`;

  const prompt = 'The image shows two screenshots side by side (left = baseline/before, right = current/after). Describe ONLY the visual differences between them in 1-3 concise bullet points. Focus on layout shifts, color changes, new/hidden elements, text changes, and position changes. If they look the same, say "No visual differences detected."';

  const baseUrl = 'https://api-inference.huggingface.co/models/llava-hf/llava-v1.6-mistral-7b-hf';

  let lastErr = null;

  for (const path of ['/v1/chat/completions', '']) {
    try {
      const url = baseUrl + path;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.hfApiToken}`,
        },
        body: JSON.stringify({
          ...(path && { model: 'llava-hf/llava-v1.6-mistral-7b-hf' }),
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: prompt },
            ],
          }],
          max_tokens: 300,
          ...(!path && { options: { wait_for_model: true } }),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text =
          data?.choices?.[0]?.message?.content ||
          (Array.isArray(data) && data[0]?.generated_text) ||
          data?.generated_text;
        if (text) return text;
        return JSON.stringify(data);
      }

      lastErr = { status: res.status, body: await res.text(), path };
    } catch (e) {
      lastErr = { error: e.message, path };
    }
  }

  console.error('HF API error:', lastErr);
  throw new Error(`Hugging Face API returned ${lastErr.status} (tried chat + octet-stream formats)`);
}

function describeSimple(diffPercentage) {
  if (diffPercentage < 0.5) {
    return 'No visual differences detected.';
  }
  return `Visual differences detected — ${diffPercentage}% of pixels differ between the two screenshots.`;
}

router.get('/screenshot/:id/describe', auth, async (req, res) => {
  const provider = config.aiProvider;

  try {
    const screenshot = await db('screenshots')
      .join('api_keys', 'screenshots.api_key_id', 'api_keys.id')
      .where({ 'screenshots.id': req.params.id, 'api_keys.user_id': req.apiKey.userId })
      .select('screenshots.url', 'screenshots.storage_path', 'screenshots.baseline_id', 'screenshots.format', 'screenshots.diff_percentage')
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

    if (provider === 'gemini' && !config.geminiApiKey) {
      return res.status(400).json({
        error: 'GEMINI_API_KEY not configured',
        hint: 'Set GEMINI_API_KEY in .env. Get a free key at https://aistudio.google.com/apikey',
      });
    }
    if (provider === 'huggingface' && !config.hfApiToken) {
      return res.status(400).json({
        error: 'HF_API_TOKEN not configured',
        hint: 'Set HF_API_TOKEN in .env. Get a free token at https://huggingface.co/settings/tokens',
      });
    }

    const [currentBuf, baselineBuf] = await Promise.all([
      readFile(screenshot.storage_path),
      readFile(baseline.storage_path),
    ]);

    let description;

    if (provider === 'huggingface') {
      description = await describeHuggingFace(baselineBuf, currentBuf);
    } else if (provider === 'simple') {
      description = describeSimple(screenshot.diff_percentage || 0);
    } else {
      const mime = screenshot.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      description = await describeGemini(
        baselineBuf.toString('base64'),
        currentBuf.toString('base64'),
        mime,
      );
    }

    res.json({ description, provider });
  } catch (err) {
    console.error('Describe error:', err);
    res.status(502).json({ error: 'describe_failed', message: err.message });
  }
});

export default router;
