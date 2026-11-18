/** Minimal TGA decoder (true-color, uncompressed or RLE, 24/32 bpp) – enough for war3mapPreview.tga. */
export function decodeTga(buf: Uint8Array): { width: number; height: number; data: Uint8ClampedArray } {
  const idLength = buf[0];
  const colorMapType = buf[1];
  const imageType = buf[2];
  const width = buf[12] | (buf[13] << 8);
  const height = buf[14] | (buf[15] << 8);
  const bpp = buf[16];
  const descriptor = buf[17];
  if (colorMapType !== 0 || (imageType !== 2 && imageType !== 10) || (bpp !== 24 && bpp !== 32)) {
    throw new Error(`Unsupported TGA (type ${imageType}, ${bpp} bpp)`);
  }
  const bytes = bpp / 8;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let p = 18 + idLength;
  let i = 0;
  const put = (o: number) => {
    pixels[i * 4] = buf[o + 2];
    pixels[i * 4 + 1] = buf[o + 1];
    pixels[i * 4 + 2] = buf[o];
    pixels[i * 4 + 3] = bytes === 4 ? buf[o + 3] : 255;
    i++;
  };
  const total = width * height;
  if (imageType === 2) {
    while (i < total) {
      put(p);
      p += bytes;
    }
  } else {
    while (i < total) {
      const header = buf[p++];
      const count = (header & 0x7f) + 1;
      if (header & 0x80) {
        for (let k = 0; k < count; k++) put(p);
        p += bytes;
      } else {
        for (let k = 0; k < count; k++) {
          put(p);
          p += bytes;
        }
      }
    }
  }
  // Bottom-left origin unless bit 5 of the descriptor is set – flip to top-left.
  if (!(descriptor & 0x20)) {
    const row = width * 4;
    const tmp = new Uint8ClampedArray(row);
    for (let y = 0; y < height >> 1; y++) {
      const a = y * row;
      const b = (height - 1 - y) * row;
      tmp.set(pixels.subarray(a, a + row));
      pixels.copyWithin(a, b, b + row);
      pixels.set(tmp, b);
    }
  }
  return { width, height, data: pixels };
}
