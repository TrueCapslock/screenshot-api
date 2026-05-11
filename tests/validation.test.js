import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const screenshotSchema = z.object({
  url: z.string().url().max(2048),
  width: z.number().int().min(1).max(7680).optional(),
  height: z.number().int().min(1).max(7680).optional(),
  format: z.enum(['png', 'jpeg', 'webp']).optional(),
  quality: z.number().int().min(1).max(100).optional(),
  fullPage: z.boolean().optional(),
  delay: z.number().int().min(0).max(60_000).optional(),
  selector: z.string().max(512).optional(),
  blockAds: z.boolean().optional(),
  darkMode: z.boolean().optional(),
  mobile: z.boolean().optional(),
  timeout: z.number().int().min(1).max(120).optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  waitForSelector: z.string().max(512).optional(),
  scrollToBottom: z.boolean().optional(),
  acceptCookies: z.union([z.boolean(), z.string().max(512)]).optional(),
  scale: z.number().int().min(1).max(3).optional(),
  cache: z.boolean().optional(),
});

const htmlSchema = z.object({
  html: z.string().min(1).max(1_000_000),
  width: z.number().int().min(1).max(7680).optional(),
  height: z.number().int().min(1).max(7680).optional(),
  format: z.enum(['png', 'jpeg', 'webp']).optional(),
  quality: z.number().int().min(1).max(100).optional(),
  fullPage: z.boolean().optional(),
  delay: z.number().int().min(0).max(60_000).optional(),
});

describe('screenshotSchema', () => {
  it('accepts a valid URL with defaults', () => {
    const result = screenshotSchema.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(true);
  });

  it('rejects missing URL', () => {
    const result = screenshotSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid URL', () => {
    const result = screenshotSchema.safeParse({ url: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects URL over 2048 chars', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com/' + 'a'.repeat(2040) });
    expect(result.success).toBe(false);
  });

  it('accepts optional format values', () => {
    expect(screenshotSchema.safeParse({ url: 'https://x.com', format: 'png' }).success).toBe(true);
    expect(screenshotSchema.safeParse({ url: 'https://x.com', format: 'jpeg' }).success).toBe(true);
    expect(screenshotSchema.safeParse({ url: 'https://x.com', format: 'webp' }).success).toBe(true);
  });

  it('rejects invalid format', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com', format: 'gif' });
    expect(result.success).toBe(false);
  });

  it('accepts valid width and height', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com', width: 1024, height: 768 });
    expect(result.success).toBe(true);
  });

  it('rejects width below 1', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com', width: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects width above 7680', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com', width: 8000 });
    expect(result.success).toBe(false);
  });

  it('accepts quality 1-100', () => {
    expect(screenshotSchema.safeParse({ url: 'https://x.com', quality: 1 }).success).toBe(true);
    expect(screenshotSchema.safeParse({ url: 'https://x.com', quality: 100 }).success).toBe(true);
  });

  it('rejects quality above 100', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com', quality: 101 });
    expect(result.success).toBe(false);
  });

  it('accepts waitUntil values', () => {
    expect(screenshotSchema.safeParse({ url: 'https://x.com', waitUntil: 'load' }).success).toBe(true);
    expect(screenshotSchema.safeParse({ url: 'https://x.com', waitUntil: 'domcontentloaded' }).success).toBe(true);
    expect(screenshotSchema.safeParse({ url: 'https://x.com', waitUntil: 'networkidle' }).success).toBe(true);
  });

  it('rejects invalid waitUntil', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com', waitUntil: 'complete' });
    expect(result.success).toBe(false);
  });

  it('accepts acceptCookies as boolean', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com', acceptCookies: true });
    expect(result.success).toBe(true);
  });

  it('accepts acceptCookies as string', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com', acceptCookies: '#accept' });
    expect(result.success).toBe(true);
  });

  it('rejects acceptCookies over 512 chars', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com', acceptCookies: 'x'.repeat(513) });
    expect(result.success).toBe(false);
  });

  it('accepts all optional booleans', () => {
    const result = screenshotSchema.safeParse({
      url: 'https://x.com',
      fullPage: true,
      blockAds: false,
      darkMode: true,
      mobile: false,
      scrollToBottom: true,
      cache: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts timeout 1-120', () => {
    expect(screenshotSchema.safeParse({ url: 'https://x.com', timeout: 1 }).success).toBe(true);
    expect(screenshotSchema.safeParse({ url: 'https://x.com', timeout: 120 }).success).toBe(true);
  });

  it('rejects timeout 0', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com', timeout: 0 });
    expect(result.success).toBe(false);
  });

  it('accepts scale 1-3', () => {
    expect(screenshotSchema.safeParse({ url: 'https://x.com', scale: 1 }).success).toBe(true);
    expect(screenshotSchema.safeParse({ url: 'https://x.com', scale: 2 }).success).toBe(true);
    expect(screenshotSchema.safeParse({ url: 'https://x.com', scale: 3 }).success).toBe(true);
  });

  it('rejects scale above 3', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com', scale: 4 });
    expect(result.success).toBe(false);
  });

  it('rejects unknown properties gracefully', () => {
    const result = screenshotSchema.safeParse({ url: 'https://x.com', unknownField: 'value' });
    expect(result.success).toBe(true);
  });
});

describe('htmlSchema', () => {
  it('accepts valid HTML with defaults', () => {
    const result = htmlSchema.safeParse({ html: '<h1>Hello</h1>' });
    expect(result.success).toBe(true);
  });

  it('rejects empty HTML', () => {
    const result = htmlSchema.safeParse({ html: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing HTML', () => {
    const result = htmlSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects HTML over 1MB', () => {
    const result = htmlSchema.safeParse({ html: 'x'.repeat(1_000_001) });
    expect(result.success).toBe(false);
  });

  it('accepts all optional fields', () => {
    const result = htmlSchema.safeParse({
      html: '<h1>Test</h1>',
      width: 800,
      height: 600,
      format: 'webp',
      quality: 80,
      fullPage: false,
      delay: 1000,
    });
    expect(result.success).toBe(true);
  });
});
