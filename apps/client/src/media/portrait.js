export const MAX_PORTRAIT_INPUT_BYTES = 10 * 1024 * 1024;
export const PORTRAIT_MAX_DIMENSION = 1024;

const supportedTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const canvasToPng = (canvas) => {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('PNG encoding failed')),
      'image/png'
    );
  });
};

const browserRenderer = async (file, { maxDimension }) => {
  if (typeof globalThis.createImageBitmap !== 'function') {
    throw new Error('Image decoding is unavailable');
  }
  const bitmap = await globalThis.createImageBitmap(file);
  try {
    if (!(bitmap.width > 0 && bitmap.height > 0)) {
      throw new Error('Image has invalid dimensions');
    }
    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height)
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas =
      typeof globalThis.OffscreenCanvas === 'function'
        ? new globalThis.OffscreenCanvas(width, height)
        : globalThis.document?.createElement('canvas');
    if (!canvas) {
      throw new Error('Canvas is unavailable');
    }
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      throw new Error('Canvas rendering is unavailable');
    }
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return {
      blob: await canvasToPng(canvas),
      width,
      height,
    };
  } finally {
    bitmap.close?.();
  }
};

export const normalizePortraitUpload = async (
  file,
  {
    maxBytes = MAX_PORTRAIT_INPUT_BYTES,
    maxDimension = PORTRAIT_MAX_DIMENSION,
    renderer = browserRenderer,
  } = {}
) => {
  if (!(file instanceof Blob) || !supportedTypes.has(file.type)) {
    throw new TypeError('Choose a supported image: PNG, JPEG, WebP, or GIF.');
  }
  if (file.size > maxBytes) {
    throw new RangeError('Portrait images must be 10 MiB or smaller.');
  }
  try {
    const result = await renderer(file, { maxDimension });
    if (
      !(result?.blob instanceof Blob) ||
      result.blob.type !== 'image/png' ||
      !(result.width > 0) ||
      !(result.height > 0) ||
      Math.max(result.width, result.height) > maxDimension
    ) {
      throw new Error('Normalized portrait is invalid');
    }
    return result;
  } catch {
    throw new Error('The portrait image could not be read.');
  }
};

export const blobToBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }
  return globalThis.btoa(binary);
};
