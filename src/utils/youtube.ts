export function extractYouTubeVideoId(rawUrl: string): string | null {
  const input = rawUrl.trim();
  if (!input) return null;

  // Allow direct 11-char YouTube video ID as convenience only if it strictly matches ID syntax
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }

  let parsed: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const validHosts = new Set([
    'youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'youtube-nocookie.com',
  ]);

  if (!validHosts.has(host)) {
    return null;
  }

  if (host === 'youtu.be') {
    const seg = parsed.pathname.split('/').filter(Boolean)[0];
    return seg && /^[a-zA-Z0-9_-]{11}$/.test(seg) ? seg : null;
  }

  const vParam = parsed.searchParams.get('v');
  if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
    return vParam;
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && ['shorts', 'live', 'embed', 'v'].includes(parts[0])) {
    const candidate = parts[1];
    return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
  }

  return null;
}

export function normalizeYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function formatTimestamp(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '00:00';
  }
  const rounded = Math.floor(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function parseTimestamp(input: string): number | null {
  const clean = input.trim();
  if (!clean) return null;

  if (/^\d+(\.\d+)?$/.test(clean)) {
    const sec = Math.floor(Number(clean));
    return sec >= 0 ? sec : null;
  }

  const parts = clean.split(':').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;

  if (parts.some((p) => !/^\d+$/.test(p))) return null;

  const nums = parts.map(Number);
  if (parts.length === 2) {
    const [m, s] = nums;
    if (s >= 60) return null;
    return m * 60 + s;
  }

  const [h, m, s] = nums;
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}
