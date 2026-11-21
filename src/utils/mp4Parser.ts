import fs from 'fs';

export interface ParsedMp4Metadata {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

function readUInt64BE(buf: Buffer, offset: number): number {
  const high = buf.readUInt32BE(offset);
  const low = buf.readUInt32BE(offset + 4);
  return high * 4294967296 + low;
}

interface ParsedBoxHeader {
  type: string;
  size: number;
  headerSize: number;
}

function parseBoxHeaderFromBuffer(buf: Buffer, offset: number, limit: number): ParsedBoxHeader | null {
  if (offset + 8 > limit) return null;
  const rawSize = buf.readUInt32BE(offset);
  const type = buf.toString('ascii', offset + 4, offset + 8);
  if (rawSize === 1) {
    if (offset + 16 > limit) return null;
    const extSize = readUInt64BE(buf, offset + 8);
    if (extSize < 16) return null;
    return { type, size: extSize, headerSize: 16 };
  }
  if (rawSize === 0) {
    return { type, size: limit - offset, headerSize: 8 };
  }
  if (rawSize < 8) return null;
  return { type, size: rawSize, headerSize: 8 };
}

function parseMoovBuffer(moovPayload: Buffer): ParsedMp4Metadata {
  let durationSec = 0;
  let width = 0;
  let height = 0;
  let hasAudio = false;
  let hasVideo = false;

  let pos = 0;
  const limit = moovPayload.length;

  while (pos + 8 <= limit) {
    const box = parseBoxHeaderFromBuffer(moovPayload, pos, limit);
    if (!box) break;
    const payloadStart = pos + box.headerSize;
    const boxEnd = Math.min(limit, pos + box.size);

    if (box.type === 'mvhd' && payloadStart + 20 <= boxEnd) {
      const version = moovPayload[payloadStart];
      if (version === 0 && payloadStart + 20 <= boxEnd) {
        const timescale = moovPayload.readUInt32BE(payloadStart + 12);
        const duration = moovPayload.readUInt32BE(payloadStart + 16);
        if (timescale > 0 && duration > 0) {
          durationSec = Math.max(durationSec, Math.round(duration / timescale));
        }
      } else if (version === 1 && payloadStart + 32 <= boxEnd) {
        const timescale = moovPayload.readUInt32BE(payloadStart + 20);
        const duration = readUInt64BE(moovPayload, payloadStart + 24);
        if (timescale > 0 && duration > 0) {
          durationSec = Math.max(durationSec, Math.round(duration / timescale));
        }
      }
    } else if (box.type === 'trak') {
      let tkWidth = 0;
      let tkHeight = 0;
      let handlerType = '';

      let tPos = payloadStart;
      while (tPos + 8 <= boxEnd) {
        const tBox = parseBoxHeaderFromBuffer(moovPayload, tPos, boxEnd);
        if (!tBox) break;
        const tPayloadStart = tPos + tBox.headerSize;
        const tBoxEnd = Math.min(boxEnd, tPos + tBox.size);

        if (tBox.type === 'tkhd' && tPayloadStart + 84 <= tBoxEnd) {
          const version = moovPayload[tPayloadStart];
          const dimOffset = version === 1 ? tPayloadStart + 88 : tPayloadStart + 76;
          if (dimOffset + 8 <= tBoxEnd) {
            tkWidth = moovPayload.readUInt32BE(dimOffset) >>> 16;
            tkHeight = moovPayload.readUInt32BE(dimOffset + 4) >>> 16;
          }
        } else if (tBox.type === 'mdia') {
          let mPos = tPayloadStart;
          while (mPos + 8 <= tBoxEnd) {
            const mBox = parseBoxHeaderFromBuffer(moovPayload, mPos, tBoxEnd);
            if (!mBox) break;
            const mPayloadStart = mPos + mBox.headerSize;
            const mBoxEnd = Math.min(tBoxEnd, mPos + mBox.size);

            if (mBox.type === 'hdlr' && mPayloadStart + 12 <= mBoxEnd) {
              handlerType = moovPayload.toString('ascii', mPayloadStart + 8, mPayloadStart + 12);
            }
            mPos = mBoxEnd;
          }
        }

        tPos = tBoxEnd;
      }

      if (handlerType === 'vide') {
        hasVideo = true;
        if (tkWidth > 0 && tkHeight > 0) {
          width = tkWidth;
          height = tkHeight;
        }
      } else if (handlerType === 'soun') {
        hasAudio = true;
      } else if (!handlerType && tkWidth > 0 && tkHeight > 0) {
        hasVideo = true;
        width = tkWidth;
        height = tkHeight;
      }
    }

    pos = boxEnd;
  }

  return {
    durationSec: Math.max(1, durationSec || 1),
    width: width || 1280,
    height: height || 720,
    hasAudio,
    hasVideo,
  };
}

/**
 * Parses MP4/ISO-BMFF box headers sparsely without loading mdat into RAM.
 * Safe for 100MB–300MB+ MP4 files even when ffprobe is unavailable.
 */
export async function probeMp4BoxesFromFile(filePath: string): Promise<ParsedMp4Metadata> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const fileSize = stat.size;
    if (fileSize < 16) {
      throw new Error('File MP4 terlalu kecil atau rusak.');
    }

    const headerBuf = Buffer.alloc(16);
    let offset = 0;
    let hasFtyp = false;
    let moovMeta: ParsedMp4Metadata | null = null;

    while (offset + 8 <= fileSize) {
      const toRead = Math.min(16, fileSize - offset);
      const { bytesRead } = await handle.read(headerBuf, 0, toRead, offset);
      if (bytesRead < 8) break;

      const rawSize = headerBuf.readUInt32BE(0);
      const boxType = headerBuf.toString('ascii', 4, 8);
      let boxSize = rawSize;
      let headerSize = 8;

      if (rawSize === 1) {
        if (bytesRead < 16) break;
        boxSize = readUInt64BE(headerBuf, 8);
        headerSize = 16;
      } else if (rawSize === 0) {
        boxSize = fileSize - offset;
      }

      if (boxSize < headerSize || offset + boxSize > fileSize + 8) {
        break;
      }

      if (boxType === 'ftyp') {
        hasFtyp = true;
      } else if (boxType === 'moov') {
        const payloadSize = Math.min(boxSize - headerSize, 32 * 1024 * 1024);
        const moovBuf = Buffer.alloc(payloadSize);
        let totalRead = 0;
        while (totalRead < payloadSize) {
          const r = await handle.read(
            moovBuf,
            totalRead,
            payloadSize - totalRead,
            offset + headerSize + totalRead
          );
          if (r.bytesRead <= 0) break;
          totalRead += r.bytesRead;
        }
        moovMeta = parseMoovBuffer(moovBuf.subarray(0, totalRead));
        break;
      }

      offset += boxSize;
    }

    if (moovMeta) {
      if (!moovMeta.hasVideo) {
        throw new Error('File MP4 tidak memiliki stream video yang valid.');
      }
      return moovMeta;
    }

    if (!hasFtyp) {
      throw new Error('File yang diunggah bukan format kontainer MP4 yang valid.');
    }

    // Fallback when ftyp is valid MP4 but moov atom is fragmented/unreadable
    return {
      durationSec: 1,
      width: 1280,
      height: 720,
      hasAudio: true,
      hasVideo: true,
    };
  } finally {
    await handle.close();
  }
}
