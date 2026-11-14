import type { MatrixRaster } from './dotMatrix';

/** Native pixel outlines only scale by whole cells. Never synthesize a bold face. */
export const MATRIX_FONT_SIZES = [8, 10, 12, 16, 20, 24, 30] as const;
export function matrixFontFace(size: number) {
  const native = size % 12 === 0 ? 12 : size % 10 === 0 ? 10 : 8;
  return `Zephyrus Fusion Pixel ${native}`;
}

export async function loadMatrixFonts() {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all([8, 10, 12].map(size =>
    document.fonts.load(`400 ${size}px "Zephyrus Fusion Pixel ${size}"`, '音乐 Music')
  ));
}

export function createMatrixFontRaster(
  context: CanvasRenderingContext2D,
  fallback = 'sans-serif'
): MatrixRaster {
  const widths = new Map<string, number>();
  function prepare(size: number) {
    context.font = `400 ${size}px "${matrixFontFace(size)}", ${fallback || 'sans-serif'}`;
    // One unlit cell separates adjacent glyphs, including when a word contains several characters.
    context.letterSpacing = '1px';
    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';
    context.direction = 'ltr';
  }
  return {
    sizes: MATRIX_FONT_SIZES,
    measure(text, size) {
      const key = `${size}:${text}`;
      const cached = widths.get(key);
      if (cached !== undefined) return cached;
      prepare(size);
      const width = context.measureText(text).width;
      widths.set(key, width);
      return width;
    },
    pixels(text, size, width, height) {
      context.canvas.width = width;
      context.canvas.height = height;
      prepare(size);
      const rtl = /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(text);
      context.direction = rtl ? 'rtl' : 'ltr';
      context.textAlign = rtl ? 'right' : 'left';
      context.fillStyle = '#000';
      context.fillText(text, rtl ? width - 2 : 2, Math.ceil(size * 1.08));
      const data = context.getImageData(0, 0, width, height).data;
      const points: { x: number; y: number }[] = [];
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (data[(y * width + x) * 4 + 3] >= 128) points.push({ x, y });
      return points;
    }
  };
}
