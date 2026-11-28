import type {
  AspectRatioPreset,
  ClipEditingSettings,
  CropFitMode,
  ExportQualityPreset,
  VideoColorPreset,
  VideoRotationDeg,
  VirtualClip,
} from '../types';

export const COLOR_PRESET_VALUES: Record<
  VideoColorPreset,
  { label: string; brightness: number; contrast: number; saturation: number }
> = {
  normal: { label: 'Normal', brightness: 0, contrast: 1, saturation: 1 },
  sinematik: { label: 'Sinematik', brightness: -0.04, contrast: 1.18, saturation: 0.85 },
  vibrant: { label: 'Vibrant', brightness: 0.04, contrast: 1.12, saturation: 1.4 },
  hangat: { label: 'Hangat', brightness: 0.05, contrast: 1.06, saturation: 1.25 },
  sejuk: { label: 'Sejuk', brightness: 0, contrast: 1.08, saturation: 0.78 },
  bw: { label: 'Hitam-Putih', brightness: 0, contrast: 1.15, saturation: 0 },
};

export function getDefaultClipEditing(): ClipEditingSettings {
  return {
    rotation: 0,
    flipH: false,
    flipV: false,
    cropMode: 'fill',
    fokusY: 50,
    zoom: 1,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    speed: 1,
    colorPreset: 'normal',
    brightness: 0,
    contrast: 1,
    saturation: 1,
    fadeInSec: 0,
    fadeOutSec: 0,
    clipVolume: 100,
    muteOriginal: false,
    exportQuality: '1080p',
    burnSubtitles: true,
    includeVoiceOver: true,
  };
}

export function normalizeClipEditing(
  editing?: Partial<ClipEditingSettings>
): ClipEditingSettings {
  const def = getDefaultClipEditing();
  if (!editing) return def;
  const rot = editing.rotation;
  const validRot: VideoRotationDeg =
    rot === 90 || rot === 180 || rot === 270 ? rot : 0;

  return {
    rotation: validRot,
    flipH: Boolean(editing.flipH),
    flipV: Boolean(editing.flipV),
    cropMode: editing.cropMode === 'fit' ? 'fit' : 'fill',
    fokusY: clampNum(editing.fokusY ?? def.fokusY, 0, 100),
    zoom: clampNum(editing.zoom ?? def.zoom, 1, 2.5),
    marginTop: clampNum(editing.marginTop ?? def.marginTop, 0, 30),
    marginBottom: clampNum(editing.marginBottom ?? def.marginBottom, 0, 30),
    marginLeft: clampNum(editing.marginLeft ?? def.marginLeft, 0, 30),
    marginRight: clampNum(editing.marginRight ?? def.marginRight, 0, 30),
    speed: clampNum(editing.speed ?? def.speed, 0.5, 2),
    colorPreset: editing.colorPreset ?? def.colorPreset,
    brightness: clampNum(editing.brightness ?? def.brightness, -0.3, 0.3),
    contrast: clampNum(editing.contrast ?? def.contrast, 0.5, 1.8),
    saturation: clampNum(editing.saturation ?? def.saturation, 0, 2),
    fadeInSec: clampNum(editing.fadeInSec ?? def.fadeInSec, 0, 2),
    fadeOutSec: clampNum(editing.fadeOutSec ?? def.fadeOutSec, 0, 2),
    clipVolume: clampNum(editing.clipVolume ?? def.clipVolume, 0, 150),
    muteOriginal: Boolean(editing.muteOriginal),
    exportQuality: editing.exportQuality === '720p' ? '720p' : '1080p',
    burnSubtitles: editing.burnSubtitles ?? true,
    includeVoiceOver: editing.includeVoiceOver ?? true,
  };
}

function clampNum(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function makeEven(n: number, min = 2): number {
  return Math.max(min, Math.floor(n / 2) * 2);
}

export function computeEffectiveDimensions(
  srcW: number,
  srcH: number,
  rotation: VideoRotationDeg
): { width: number; height: number } {
  const safeW = makeEven(srcW);
  const safeH = makeEven(srcH);
  if (rotation === 90 || rotation === 270) {
    return { width: safeH, height: safeW };
  }
  return { width: safeW, height: safeH };
}

export interface CropPlan {
  outW: number;
  outH: number;
  cropW: number;
  cropH: number;
  cropX: number;
  cropY: number;
  scaledW: number;
  scaledH: number;
  padX: number;
  padY: number;
  cropMode: CropFitMode;
}

export function computeCropPlan(
  srcW: number,
  srcH: number,
  ratio: AspectRatioPreset,
  fokusX: number,
  fokusY = 50,
  zoom = 1,
  cropMode: CropFitMode = 'fill',
  exportQuality?: ExportQualityPreset
): CropPlan {
  const safeSrcW = makeEven(srcW);
  const safeSrcH = makeEven(srcH);
  const clampedFocusX = clampNum(fokusX, 0, 100);
  const clampedFocusY = clampNum(fokusY, 0, 100);
  const clampedZoom = clampNum(zoom, 1, 2.5);

  const is720p = exportQuality === '720p';
  let targetAspect = 16 / 9;
  let outW = is720p ? 1280 : 1920;
  let outH = is720p ? 720 : 1080;

  if (ratio === '9:16') {
    targetAspect = 9 / 16;
    outW = is720p ? 720 : 1080;
    outH = is720p ? 1280 : 1920;
  } else if (ratio === '1:1') {
    targetAspect = 1;
    outW = is720p ? 720 : 1080;
    outH = is720p ? 720 : 1080;
  } else if (ratio === '4:5') {
    targetAspect = 4 / 5;
    outW = is720p ? 720 : 1080;
    outH = is720p ? 900 : 1350;
  } else {
    targetAspect = 16 / 9;
    if (exportQuality === '1080p') {
      outW = 1920;
      outH = 1080;
    } else if (exportQuality === '720p') {
      outW = 1280;
      outH = 720;
    } else if (safeSrcW >= 1920 && safeSrcH >= 1080) {
      outW = 1920;
      outH = 1080;
    } else {
      outW = 1280;
      outH = 720;
    }
  }

  if (cropMode === 'fit') {
    const cropW = makeEven(Math.min(safeSrcW, Math.max(16, safeSrcW / clampedZoom)), 16);
    const cropH = makeEven(Math.min(safeSrcH, Math.max(16, safeSrcH / clampedZoom)), 16);
    const cropX = Math.max(
      0,
      Math.min(safeSrcW - cropW, Math.round(((safeSrcW - cropW) * clampedFocusX) / 100))
    );
    const cropY = Math.max(
      0,
      Math.min(safeSrcH - cropH, Math.round(((safeSrcH - cropH) * clampedFocusY) / 100))
    );

    const fitScale = Math.min(outW / cropW, outH / cropH);
    const scaledW = Math.min(outW, makeEven(cropW * fitScale));
    const scaledH = Math.min(outH, makeEven(cropH * fitScale));
    const padX = Math.max(0, Math.floor((outW - scaledW) / 2));
    const padY = Math.max(0, Math.floor((outH - scaledH) / 2));

    return {
      outW,
      outH,
      cropW,
      cropH,
      cropX,
      cropY,
      scaledW,
      scaledH,
      padX,
      padY,
      cropMode,
    };
  }

  // 'fill' mode: aspect crop + zoom
  const srcAspect = safeSrcW / safeSrcH;
  let baseCropW = safeSrcW;
  let baseCropH = safeSrcH;

  if (srcAspect > targetAspect + 0.005) {
    baseCropH = safeSrcH;
    baseCropW = Math.min(safeSrcW, makeEven(safeSrcH * targetAspect));
  } else if (srcAspect < targetAspect - 0.005) {
    baseCropW = safeSrcW;
    baseCropH = Math.min(safeSrcH, makeEven(safeSrcW / targetAspect));
  }

  const cropW = Math.min(safeSrcW, makeEven(baseCropW / clampedZoom, 16));
  const cropH = Math.min(safeSrcH, makeEven(baseCropH / clampedZoom, 16));

  const cropX = Math.max(
    0,
    Math.min(safeSrcW - cropW, Math.round(((safeSrcW - cropW) * clampedFocusX) / 100))
  );
  const cropY = Math.max(
    0,
    Math.min(safeSrcH - cropH, Math.round(((safeSrcH - cropH) * clampedFocusY) / 100))
  );

  return {
    outW,
    outH,
    cropW,
    cropH,
    cropX,
    cropY,
    scaledW: outW,
    scaledH: outH,
    padX: 0,
    padY: 0,
    cropMode,
  };
}

export function buildAtempoFilters(speed: number): string[] {
  const safeSpeed = clampNum(speed, 0.5, 2);
  if (Math.abs(safeSpeed - 1) < 0.005) return [];
  const filters: string[] = [];
  let remaining = safeSpeed;
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(3)}`);
  return filters;
}

export function buildVideoFilterChain(params: {
  srcW: number;
  srcH: number;
  clip: VirtualClip;
  clipDurationSec: number;
  assSubtitlePath?: string;
}): {
  vfFilters: string[];
  outW: number;
  outH: number;
  outputDurationSec: number;
} {
  const { srcW, srcH, clip, clipDurationSec, assSubtitlePath } = params;
  const ed = normalizeClipEditing(clip.editing);
  const vfFilters: string[] = [];

  // 1. Orientation (rotation + flips) BEFORE crop
  if (ed.rotation === 90) {
    vfFilters.push('transpose=1');
  } else if (ed.rotation === 180) {
    vfFilters.push('hflip', 'vflip');
  } else if (ed.rotation === 270) {
    vfFilters.push('transpose=2');
  }
  if (ed.flipH) vfFilters.push('hflip');
  if (ed.flipV) vfFilters.push('vflip');

  const eff = computeEffectiveDimensions(srcW, srcH, ed.rotation);
  let workW = eff.width;
  let workH = eff.height;

  // 2. Custom edge margin crop
  const hasMargins =
    ed.marginTop > 0 || ed.marginBottom > 0 || ed.marginLeft > 0 || ed.marginRight > 0;
  if (hasMargins) {
    const mW = Math.min(
      workW,
      makeEven(workW * (1 - (ed.marginLeft + ed.marginRight) / 100), 16)
    );
    const mH = Math.min(
      workH,
      makeEven(workH * (1 - (ed.marginTop + ed.marginBottom) / 100), 16)
    );
    const mX = Math.max(0, Math.min(workW - mW, makeEven(workW * (ed.marginLeft / 100), 0)));
    const mY = Math.max(0, Math.min(workH - mH, makeEven(workH * (ed.marginTop / 100), 0)));
    if (mW < workW || mH < workH || mX > 0 || mY > 0) {
      vfFilters.push(`crop=${mW}:${mH}:${mX}:${mY}`);
      workW = mW;
      workH = mH;
    }
  }

  // 3. Aspect ratio crop / fit + zoom
  const crop = computeCropPlan(
    workW,
    workH,
    clip.rasio.rasio,
    clip.rasio.fokusX,
    ed.fokusY,
    ed.zoom,
    ed.cropMode,
    ed.exportQuality
  );

  if (crop.cropW !== workW || crop.cropH !== workH || crop.cropX !== 0 || crop.cropY !== 0) {
    vfFilters.push(`crop=${crop.cropW}:${crop.cropH}:${crop.cropX}:${crop.cropY}`);
  }

  if (ed.cropMode === 'fit' && (crop.scaledW !== crop.outW || crop.scaledH !== crop.outH)) {
    vfFilters.push(`scale=${crop.scaledW}:${crop.scaledH}:flags=lanczos`);
    vfFilters.push(`pad=${crop.outW}:${crop.outH}:${crop.padX}:${crop.padY}:color=black`);
  } else {
    vfFilters.push(`scale=${crop.outW}:${crop.outH}:flags=lanczos`);
  }
  vfFilters.push('setsar=1');

  // 4. Color correction (eq)
  const hasColorChange =
    Math.abs(ed.brightness) > 0.005 ||
    Math.abs(ed.contrast - 1) > 0.005 ||
    Math.abs(ed.saturation - 1) > 0.005;
  if (hasColorChange) {
    vfFilters.push(
      `eq=brightness=${ed.brightness.toFixed(2)}:contrast=${ed.contrast.toFixed(2)}:saturation=${ed.saturation.toFixed(2)}`
    );
  }

  // 5. Burn ASS subtitles at original clip PTS BEFORE speed scaling
  if (assSubtitlePath) {
    // ffmpeg filtergraph memperlakukan '\' sbg escape dan ':' sbg pemisah opsi.
    // Ubah backslash -> forward slash, lalu escape ':' (mis. C:/tmp -> C\:/tmp)
    // agar path Windows tidak hancur saat dibaca libass.
    const assEsc = assSubtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:');
    vfFilters.push(`ass=${assEsc}`);
  }

  // 6. Playback speed
  const safeDuration = Math.max(0.5, clipDurationSec);
  const outputDurationSec = safeDuration / ed.speed;
  if (Math.abs(ed.speed - 1) > 0.005) {
    const ptsMult = (1 / ed.speed).toFixed(4);
    vfFilters.push(`setpts=${ptsMult}*PTS`);
  }

  // 7. Fade In & Fade Out in final output timeline
  const safeFadeIn = Math.min(ed.fadeInSec, outputDurationSec / 2);
  const safeFadeOut = Math.min(ed.fadeOutSec, outputDurationSec / 2);
  if (safeFadeIn > 0.05) {
    vfFilters.push(`fade=t=in:st=0:d=${safeFadeIn.toFixed(2)}`);
  }
  if (safeFadeOut > 0.05) {
    const fadeOutStart = Math.max(0, outputDurationSec - safeFadeOut);
    vfFilters.push(`fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${safeFadeOut.toFixed(2)}`);
  }

  return {
    vfFilters,
    outW: crop.outW,
    outH: crop.outH,
    outputDurationSec,
  };
}

export function buildAudioFadeFilters(
  outputDurationSec: number,
  fadeInSec: number,
  fadeOutSec: number
): string[] {
  const filters: string[] = [];
  const safeFadeIn = Math.min(fadeInSec, outputDurationSec / 2);
  const safeFadeOut = Math.min(fadeOutSec, outputDurationSec / 2);
  if (safeFadeIn > 0.05) {
    filters.push(`afade=t=in:st=0:d=${safeFadeIn.toFixed(2)}`);
  }
  if (safeFadeOut > 0.05) {
    const fadeOutStart = Math.max(0, outputDurationSec - safeFadeOut);
    filters.push(`afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${safeFadeOut.toFixed(2)}`);
  }
  return filters;
}

export function getVideoCssPreviewStyle(clip: VirtualClip | null): {
  filter?: string;
  transform?: string;
  objectPosition: string;
  objectFit: 'cover' | 'contain';
  clipPath?: string;
} {
  if (!clip) {
    return {
      objectPosition: 'center center',
      objectFit: 'contain',
    };
  }
  const ed = normalizeClipEditing(clip.editing);

  const filterParts: string[] = [];
  if (Math.abs(ed.brightness) > 0.005) {
    filterParts.push(`brightness(${(1 + ed.brightness).toFixed(2)})`);
  }
  if (Math.abs(ed.contrast - 1) > 0.005) {
    filterParts.push(`contrast(${ed.contrast.toFixed(2)})`);
  }
  if (Math.abs(ed.saturation - 1) > 0.005) {
    filterParts.push(`saturate(${ed.saturation.toFixed(2)})`);
  }

  const transforms: string[] = [];
  if (ed.rotation !== 0) {
    transforms.push(`rotate(${ed.rotation}deg)`);
  }
  if (ed.flipH || ed.flipV) {
    transforms.push(`scale(${ed.flipH ? -1 : 1}, ${ed.flipV ? -1 : 1})`);
  }
  if (ed.zoom > 1.005) {
    transforms.push(`scale(${ed.zoom.toFixed(2)})`);
  }

  const hasMargins =
    ed.marginTop > 0 || ed.marginBottom > 0 || ed.marginLeft > 0 || ed.marginRight > 0;

  return {
    filter: filterParts.length > 0 ? filterParts.join(' ') : undefined,
    transform: transforms.length > 0 ? transforms.join(' ') : undefined,
    objectPosition: `${clip.rasio.fokusX}% ${ed.fokusY}%`,
    objectFit: ed.cropMode === 'fit' ? 'contain' : clip.rasio.rasio !== '16:9' || ed.zoom > 1 ? 'cover' : 'contain',
    clipPath: hasMargins
      ? `inset(${ed.marginTop}% ${ed.marginRight}% ${ed.marginBottom}% ${ed.marginLeft}%)`
      : undefined,
  };
}

export function summarizeClipEdits(clip: VirtualClip): string[] {
  const ed = normalizeClipEditing(clip.editing);
  const tags: string[] = [clip.rasio.rasio];
  if (ed.cropMode === 'fit') tags.push('Pas Utuh');
  if (ed.rotation !== 0) tags.push(`Putar ${ed.rotation}°`);
  if (ed.flipH) tags.push('Mirror H');
  if (ed.flipV) tags.push('Balik V');
  if (ed.zoom > 1.01) tags.push(`Zoom ${ed.zoom.toFixed(1)}x`);
  if (Math.abs(ed.speed - 1) > 0.01) tags.push(`${ed.speed}x`);
  if (ed.colorPreset !== 'normal') tags.push(COLOR_PRESET_VALUES[ed.colorPreset].label);
  if (ed.fadeInSec > 0 || ed.fadeOutSec > 0) tags.push('Fade');
  if (ed.muteOriginal) tags.push('Bisu');
  tags.push(ed.exportQuality);
  return tags;
}

export function hexToAssColor(hex: string, alphaHex = '00'): string {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `&H${alphaHex}FFFFFF`;
  }
  const r = clean.slice(0, 2).toUpperCase();
  const g = clean.slice(2, 4).toUpperCase();
  const b = clean.slice(4, 6).toUpperCase();
  return `&H${alphaHex}${b}${g}${r}`;
}

function formatAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  const whole = Math.floor(rem);
  const cs = Math.min(99, Math.floor((rem - whole) * 100));
  return `${h}:${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\r?\n/g, '\\N').replace(/\{/g, '(').replace(/\}/g, ')');
}

export function buildAssSubtitleContent(
  clip: VirtualClip,
  outW: number,
  outH: number
): string {
  const app = clip.subtitleAppearance;
  const scaledFontSize = Math.max(
    24,
    Math.round((app.fontSize || 22) * (outW / 520))
  );
  const primaryColor = hexToAssColor(app.color || '#FFFFFF', '00');
  const secondaryColor = hexToAssColor('#FCD34D', '00'); // Amber highlight for karaoke
  const alignment =
    app.position === 'top' ? 8 : app.position === 'middle' ? 5 : 2;
  const marginV = Math.round(outH * 0.06);

  const isBox = app.preset === 'kotak';
  const isBold = app.preset === 'bold' || app.preset === 'karaoke' ? -1 : 0;
  const borderStyle = isBox ? 3 : 1;
  const outline = isBox ? 8 : app.preset === 'bold' ? 4 : 2;
  const shadow = isBox ? 0 : 2;
  const backColor = isBox ? '&H66000000' : '&H80000000';

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${outW}`,
    `PlayResY: ${outH}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,DejaVu Sans,${scaledFontSize},${primaryColor},${secondaryColor},&H00000000,${backColor},${isBold},0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},36,36,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = clip.subtitle.map((line) => {
    const startStr = formatAssTime(line.mulai);
    const endStr = formatAssTime(Math.max(line.mulai + 0.15, line.selesai));
    let textPayload =
      app.preset === 'bold'
        ? escapeAssText(line.teks.toUpperCase())
        : escapeAssText(line.teks);

    if (app.preset === 'karaoke' && line.kata && line.kata.length > 0) {
      textPayload = line.kata
        .map((w) => {
          const cs = Math.max(5, Math.round((w.selesai - w.mulai) * 100));
          return `{\\kf${cs}}${escapeAssText(w.kata)}`;
        })
        .join(' ');
    }

    return `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${textPayload}`;
  });

  return [...header, ...events, ''].join('\n');
}
