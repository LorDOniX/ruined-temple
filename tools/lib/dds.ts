/** Minimal DDS decoder (top mip level) for DXT1/DXT3/DXT5 and uncompressed 32-bit RGBA/BGRA. */
export function decodeDds(buf: Uint8Array): { width: number; height: number; data: Uint8ClampedArray } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x20534444) throw new Error('Not a DDS file');
  const height = dv.getUint32(12, true);
  const width = dv.getUint32(16, true);
  const pfFlags = dv.getUint32(80, true);
  const fourCC = String.fromCharCode(buf[84], buf[85], buf[86], buf[87]);
  let offset = 128;
  let format = fourCC;
  if (fourCC === 'DX10') {
    const dxgi = dv.getUint32(128, true);
    offset = 148;
    format = ({ 71: 'DXT1', 72: 'DXT1', 74: 'DXT3', 75: 'DXT3', 77: 'DXT5', 78: 'DXT5', 28: 'RGBA', 87: 'BGRA' } as Record<number, string>)[dxgi] ?? `DXGI${dxgi}`;
  } else if (pfFlags & 0x40) {
    format = dv.getUint32(88, true) === 32 && dv.getUint32(92, true) === 0xff ? 'RGBA' : 'BGRA';
  }
  const out = new Uint8ClampedArray(width * height * 4);
  if (format === 'RGBA' || format === 'BGRA') {
    for (let i = 0; i < width * height; i++) {
      const s = offset + i * 4;
      const swap = format === 'BGRA';
      out[i * 4] = buf[s + (swap ? 2 : 0)];
      out[i * 4 + 1] = buf[s + 1];
      out[i * 4 + 2] = buf[s + (swap ? 0 : 2)];
      out[i * 4 + 3] = buf[s + 3];
    }
    return { width, height, data: out };
  }
  if (format !== 'DXT1' && format !== 'DXT3' && format !== 'DXT5') throw new Error(`Unsupported DDS format ${format}`);
  const blockSize = format === 'DXT1' ? 8 : 16;
  const bw = Math.max(1, (width + 3) >> 2);
  const bh = Math.max(1, (height + 3) >> 2);
  const colors = new Uint8Array(16);
  const alphas = new Uint8Array(8);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const b = offset + (by * bw + bx) * blockSize;
      const c = format === 'DXT1' ? b : b + 8;
      const c0 = buf[c] | (buf[c + 1] << 8);
      const c1 = buf[c + 2] | (buf[c + 3] << 8);
      rgb565(c0, colors, 0);
      rgb565(c1, colors, 4);
      const fourColor = format !== 'DXT1' || c0 > c1;
      for (let k = 0; k < 3; k++) {
        colors[8 + k] = fourColor ? (2 * colors[k] + colors[4 + k]) / 3 : (colors[k] + colors[4 + k]) / 2;
        colors[12 + k] = fourColor ? (colors[k] + 2 * colors[4 + k]) / 3 : 0;
      }
      colors[3] = colors[7] = colors[11] = 255;
      colors[15] = fourColor ? 255 : 0;
      const idx = buf[c + 4] | (buf[c + 5] << 8) | (buf[c + 6] << 16) | (buf[c + 7] << 24);
      if (format === 'DXT5') {
        const a0 = buf[b];
        const a1 = buf[b + 1];
        alphas[0] = a0;
        alphas[1] = a1;
        for (let k = 1; k < 7; k++) {
          if (a0 > a1) alphas[k + 1] = ((7 - k) * a0 + k * a1) / 7;
          else if (k < 5) alphas[k + 1] = ((5 - k) * a0 + k * a1) / 5;
        }
        if (a0 <= a1) {
          alphas[6] = 0;
          alphas[7] = 255;
        }
      }
      for (let p = 0; p < 16; p++) {
        const x = bx * 4 + (p & 3);
        const y = by * 4 + (p >> 2);
        if (x >= width || y >= height) continue;
        const ci = (idx >>> (p * 2)) & 3;
        const o = (y * width + x) * 4;
        out[o] = colors[ci * 4];
        out[o + 1] = colors[ci * 4 + 1];
        out[o + 2] = colors[ci * 4 + 2];
        if (format === 'DXT1') out[o + 3] = colors[ci * 4 + 3];
        else if (format === 'DXT3') {
          const nib = (buf[b + (p >> 1)] >> ((p & 1) * 4)) & 15;
          out[o + 3] = nib * 17;
        } else {
          const bit = p * 3;
          const byte = b + 2 + (bit >> 3);
          const v = ((buf[byte] | (buf[byte + 1] << 8)) >> (bit & 7)) & 7;
          out[o + 3] = alphas[v];
        }
      }
    }
  }
  return { width, height, data: out };
}

function rgb565(v: number, out: Uint8Array, o: number) {
  const r = (v >> 11) & 31;
  const g = (v >> 5) & 63;
  const b = v & 31;
  out[o] = (r << 3) | (r >> 2);
  out[o + 1] = (g << 2) | (g >> 4);
  out[o + 2] = (b << 3) | (b >> 2);
}
