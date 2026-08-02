/* ─── Minimal ISO-BMFF (mp4/m4a) iTunes-style tag writer ───────────────
 *
 * MediaRecorder output has no metadata, so audio/video files carry no
 * brand. This injects iTunes-style tags (©nam/©ART/©cmt) into the moov
 * box so players show "Gesture Synth Weld — gesturesynthweld.com".
 * No dependencies; verified against the recorder's own output.
 */

const enc = new TextEncoder();

function bytes(s: string): Uint8Array {
  return enc.encode(s);
}

/** 4 raw bytes for a box code — MUST be raw, not UTF-8 (©nam = A9 6E 61 6D) */
function raw4(s: string): Uint8Array {
  return new Uint8Array([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Build a sized box: [size:u32][type:4][payload] */
function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, 8 + payload.length);
  out.set(raw4(type), 4);
  out.set(payload, 8);
  return out;
}

/** One ilst item: [size][data][type=1 u32][locale u32][utf-8 value] */
function ilstItem(code: string, value: string): Uint8Array {
  return ilstItemData(code, bytes(value), 1);
}

/** One ilst item with a raw payload: type 1 = UTF-8, 13 = JPEG, 14 = PNG */
function ilstItemData(code: string, payload: Uint8Array, type: number): Uint8Array {
  const data = new Uint8Array(16 + payload.length);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 16 + payload.length);
  data.set(bytes('data'), 4);
  dv.setUint32(8, type);
  dv.setUint32(12, 0); // locale
  data.set(payload, 16);
  return box(code, data);
}

/** udta → meta (Apple-style) with hdlr + ilst entries */
function udta(title: string, artist: string, comment: string, cover?: Uint8Array): Uint8Array {
  const hdlrPayload = new Uint8Array(28); // ver/flags(4) + pre(4) + type(4) + reserved(12) + name(4)
  const dv = new DataView(hdlrPayload.buffer);
  dv.setUint32(4, 0); // pre_defined
  hdlrPayload.set(bytes('mdir'), 8); // handler_type
  dv.setUint32(12, 0);
  dv.setUint32(16, 0);
  dv.setUint32(20, 0);
  hdlrPayload.set(bytes('appl'), 24); // name
  const ilst = box(
    'ilst',
    concat(
      ilstItem('©nam', title),
      ilstItem('©ART', artist),
      ilstItem('©cmt', comment),
      // cover art (JPEG) — shows the brand + URL in players
      ...(cover ? [ilstItemData('covr', cover, 13)] : [])
    )
  );
  // meta is a FullBox: 1 byte version + 3 bytes flags, then hdlr + ilst
  const meta = box('meta', concat(new Uint8Array(4), box('hdlr', hdlrPayload), ilst));
  return box('udta', meta);
}

/**
 * Inject brand tags into an mp4/m4a blob. Returns the original blob
 * untouched if the structure isn't parseable (never throws).
 */
export async function injectBrandTags(
  blob: Blob,
  title: string,
  artist: string,
  comment: string,
  cover?: Uint8Array
): Promise<Blob> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (buf.length < 8) return blob;
  const dv = new DataView(buf.buffer);

  // Locate the top-level moov box
  let off = 0;
  let moovStart = -1;
  let moovSize = 0;
  while (off + 8 <= buf.length) {
    const size = dv.getUint32(off);
    if (size < 8) break;
    const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
    if (type === 'moov') {
      moovStart = off;
      moovSize = size;
      break;
    }
    off += size;
  }
  if (moovStart < 0 || moovSize < 8) return blob;

  // Append the udta box inside moov (box order inside moov is free) and
  // rebuild the file: [before moov][moov(new)][after moov]
  const moovPayload = buf.slice(moovStart + 8, moovStart + moovSize);
  const newMoov = box('moov', concat(moovPayload, udta(title, artist, comment, cover)));
  const tail = buf.slice(moovStart + moovSize);
  const out = new Uint8Array(moovStart + newMoov.length + tail.length);
  out.set(buf.slice(0, moovStart), 0);
  out.set(newMoov, moovStart);
  out.set(tail, moovStart + newMoov.length);
  return new Blob([out], { type: blob.type });
}
