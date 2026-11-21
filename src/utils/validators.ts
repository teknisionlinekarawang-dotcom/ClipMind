export function safeParseGeminiJson<T>(rawText: string): T {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Attempt extracting the outermost JSON object or array if Gemini wrapped prose around it
    const firstObj = cleaned.indexOf('{');
    const firstArr = cleaned.indexOf('[');
    let start = -1;
    let end = -1;

    if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
      start = firstArr;
      end = cleaned.lastIndexOf(']');
    } else if (firstObj !== -1) {
      start = firstObj;
      end = cleaned.lastIndexOf('}');
    }

    if (start !== -1 && end > start) {
      const slice = cleaned.slice(start, end + 1);
      return JSON.parse(slice) as T;
    }

    throw new Error('Respons JSON dari Gemini tidak valid atau terpotong.');
  }
}

export function clampSingleTimestamp(sec: number, maxDuration: number): number {
  const safeMax = Number.isFinite(maxDuration) && maxDuration > 0 ? Math.floor(maxDuration) : 86400;
  if (!Number.isFinite(sec)) return 0;
  return Math.max(0, Math.min(safeMax, Math.floor(sec)));
}

export function clampTimestamps<T extends { mulai: number; selesai: number }>(
  items: T[],
  maxDuration: number
): T[] {
  const safeMax = Number.isFinite(maxDuration) && maxDuration > 0 ? Math.floor(maxDuration) : 86400;
  return items.map((item) => {
    let start = clampSingleTimestamp(item.mulai, safeMax);
    let end = clampSingleTimestamp(item.selesai, safeMax);
    if (start > end) {
      [start, end] = [end, start];
    }
    if (start === end && safeMax >= 1) {
      if (end < safeMax) {
        end = Math.min(safeMax, start + 1);
      } else {
        start = Math.max(0, end - 1);
      }
    }
    return { ...item, mulai: start, selesai: end };
  });
}

export function validateClipRange(
  mulai: number,
  selesai: number,
  maxDuration: number
): { valid: boolean; error?: string } {
  if (!Number.isFinite(mulai) || !Number.isFinite(selesai)) {
    return { valid: false, error: 'Format waktu mulai atau selesai tidak valid.' };
  }
  if (mulai < 0) {
    return { valid: false, error: 'Waktu mulai tidak boleh negatif.' };
  }
  if (maxDuration > 0 && selesai > maxDuration) {
    return { valid: false, error: 'Waktu selesai melebihi total durasi video.' };
  }
  if (mulai >= selesai) {
    return { valid: false, error: 'Waktu mulai harus lebih kecil daripada waktu selesai.' };
  }
  return { valid: true };
}
