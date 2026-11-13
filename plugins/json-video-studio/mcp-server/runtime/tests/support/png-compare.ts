import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';

/** PNG decoding and tolerant comparison shared by the golden-frame tests. */
export interface DecodedPng {
  width: number;
  height: number;
  rgb: Buffer;
}

const paeth = (left: number, above: number, upperLeft: number): number => {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
};

/** Decode the non-interlaced 8-bit RGB/RGBA PNGs emitted by Chromium. */
export const decodePng = async (filename: string): Promise<DecodedPng> => {
  const encoded = await readFile(filename);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!encoded.subarray(0, 8).equals(signature)) throw new Error(`${filename} is not a PNG.`);
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = -1;
  let interlace = -1;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset + 12 <= encoded.length;) {
    const length = encoded.readUInt32BE(offset);
    const type = encoded.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > encoded.length) throw new Error(`${filename} contains a truncated PNG chunk.`);
    if (type === 'IHDR') {
      width = encoded.readUInt32BE(start);
      height = encoded.readUInt32BE(start + 4);
      bitDepth = encoded[start + 8] ?? -1;
      colorType = encoded[start + 9] ?? -1;
      interlace = encoded[start + 12] ?? -1;
    } else if (type === 'IDAT') {
      compressed.push(encoded.subarray(start, end));
    }
    offset = end + 4;
    if (type === 'IEND') break;
  }
  if (width <= 0 || height <= 0 || bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error(`${filename} must be a non-interlaced 8-bit RGB or RGBA PNG.`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const filtered = inflateSync(Buffer.concat(compressed));
  if (filtered.length !== (stride + 1) * height) throw new Error(`${filename} has an unexpected scanline size.`);
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[row * (stride + 1)] ?? -1;
    if (filter < 0 || filter > 4) throw new Error(`${filename} uses unsupported PNG filter ${filter}.`);
    const sourceStart = row * (stride + 1) + 1;
    const targetStart = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const source = filtered[sourceStart + column] ?? 0;
      const left = column >= channels ? (pixels[targetStart + column - channels] ?? 0) : 0;
      const above = row > 0 ? (pixels[targetStart + column - stride] ?? 0) : 0;
      const upperLeft = row > 0 && column >= channels ? (pixels[targetStart + column - stride - channels] ?? 0) : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : paeth(left, above, upperLeft);
      pixels[targetStart + column] = (source + predictor) & 0xff;
    }
  }
  if (channels === 3) return {width, height, rgb: pixels};
  const rgb = Buffer.alloc(width * height * 3);
  for (let source = 0, target = 0; source < pixels.length; source += 4, target += 3) {
    const alpha = (pixels[source + 3] ?? 0) / 255;
    // Compare visible premultiplied color so hidden RGB in transparent pixels
    // cannot create a false regression.
    rgb[target] = Math.round((pixels[source] ?? 0) * alpha);
    rgb[target + 1] = Math.round((pixels[source + 1] ?? 0) * alpha);
    rgb[target + 2] = Math.round((pixels[source + 2] ?? 0) * alpha);
  }
  return {width, height, rgb};
};

export const comparePngs = async (actualPath: string, expectedPath: string) => {
  const [actual, expected] = await Promise.all([decodePng(actualPath), decodePng(expectedPath)]);
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return {sameSize: false, meanAbsoluteError: Number.POSITIVE_INFINITY, changedPixelRatio: 1};
  }
  let absoluteDifference = 0;
  let changedPixels = 0;
  for (let pixel = 0; pixel < actual.width * actual.height; pixel += 1) {
    let largestChannelDifference = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const index = pixel * 3 + channel;
      const difference = Math.abs((actual.rgb[index] ?? 0) - (expected.rgb[index] ?? 0));
      absoluteDifference += difference;
      largestChannelDifference = Math.max(largestChannelDifference, difference);
    }
    if (largestChannelDifference > 24) changedPixels += 1;
  }
  return {
    sameSize: true,
    meanAbsoluteError: absoluteDifference / actual.rgb.length,
    changedPixelRatio: changedPixels / (actual.width * actual.height),
  };
};
