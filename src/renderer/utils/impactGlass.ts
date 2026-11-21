import tinycolor from 'tinycolor2';

import {
  clampUnit,
  glassGeometry,
  type GlassPoint,
  impactRandom,
  SHARD_LIFETIME
} from './impactTimeline';

export function glassPalette(color: string) {
  const theme = tinycolor(color);
  const tint = theme.isValid() ? theme : tinycolor('#90c6fa');
  const rgb = tint.toRgb();
  return {
    light: (alpha: number) => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`,
    ink: tinycolor.mix(tint, '#ffffff', 23).toHexString(),
    glass: tinycolor.mix('#070d16', tint, 9).toHexString()
  };
}

type Palette = ReturnType<typeof glassPalette>;

export function drawGlass(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: Palette,
  climax: number,
  beat: number,
  time: number
) {
  const base = ctx.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, palette.glass);
  base.addColorStop(0.5, '#0b111b');
  base.addColorStop(1, palette.glass);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const beams = [
    [0.04, 0, 0.2, 0, 0.84, 0.84, 0.44, 0.6],
    [0.98, 0, 1, 0.17, 0.38, 0.71, 0.64, 0.29],
    [0, 0.87, 0, 0.96, 0.58, 0.49, 0.33, 0.54],
    [0.48, 1, 0.66, 1, 0.34, 0.28, 0.41, 0.57]
  ];
  ctx.globalCompositeOperation = 'screen';
  for (const [x, y, bx, by, cx, cy, dx, dy] of beams) {
    const light = ctx.createLinearGradient(x * width, y * height, cx * width, cy * height);
    light.addColorStop(0, palette.light((1 - climax) * 0.34));
    light.addColorStop(0.43, palette.light((1 - climax) * 0.11));
    light.addColorStop(1, palette.light(0));
    ctx.fillStyle = light;
    trace(
      ctx,
      [
        [x * width, y * height],
        [bx * width, by * height],
        [cx * width, cy * height],
        [dx * width, dy * height]
      ],
      true
    );
    ctx.fill();
  }

  if (climax > 0) {
    const perimeter = 2 * (width + height);
    for (let i = 0; i < 22; i++) {
      const phase = ((i / 22 + ((time * 0.033) % 1)) % 1) * perimeter;
      const [x, y, vertical] =
        phase < width
          ? [phase, 0, false]
          : phase < width + height
            ? [width, phase - width, true]
            : phase < 2 * width + height
              ? [2 * width + height - phase, height, false]
              : [0, perimeter - phase, true];
      const wave = Math.sin(i * 2.7 + time * 1.8);
      const radius = Math.min(width, height) * (0.16 + wave * 0.035);
      ctx.save();
      ctx.translate(Number(x), Number(y));
      if (vertical) ctx.rotate(Math.PI / 2);
      ctx.scale(1.75, 0.68 + (i % 3) * 0.21);
      const mist = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      mist.addColorStop(0, palette.light(climax * (0.25 + wave * 0.08)));
      mist.addColorStop(0.4, palette.light(climax * 0.085));
      mist.addColorStop(1, palette.light(0));
      ctx.fillStyle = mist;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.restore();
    }
  }

  for (const [x, y] of [
    [0, height * 0.29],
    [width, 0],
    [width * 0.21, 0],
    [0, height]
  ]) {
    const edge = ctx.createLinearGradient(
      x,
      y,
      x === 0 && y === height * 0.29 ? width * 0.17 : x === width ? width * 0.83 : x,
      y === 0 && x !== width ? height * 0.17 : y === height ? height * 0.83 : y
    );
    edge.addColorStop(0, `rgba(225, 241, 255, ${0.085 + beat * 0.46})`);
    edge.addColorStop(0.18, `rgba(225, 241, 255, ${0.024 + beat * 0.2})`);
    edge.addColorStop(1, 'rgba(225, 241, 255, 0)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = `rgba(220, 239, 255, ${0.2 + beat * 0.42})`;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(0.7, 0.7, width - 1.4, height - 1.4);
  ctx.strokeStyle = palette.light(0.16);
  ctx.lineWidth = 1;
  ctx.strokeRect(4.5, 4.5, width - 9, height - 9);
}

function trace(ctx: CanvasRenderingContext2D, points: readonly GlassPoint[], close = false) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  if (close) ctx.closePath();
}

export function drawCracks(
  ctx: CanvasRenderingContext2D,
  cracks: ReturnType<typeof glassGeometry>['cracks'],
  progress: number,
  shattered: boolean
) {
  const rays = Math.min(cracks.length, Math.ceil(progress * cracks.length));
  ctx.lineJoin = 'round';
  for (let index = 0; index < rays; index++) {
    const points = cracks[(index * 5) % cracks.length];
    const reach = shattered
      ? points.length
      : Math.min(points.length - 1, 3 + Math.floor(progress * 4) + (index % 2));
    const path = points.slice(0, reach);
    trace(ctx, path);
    ctx.strokeStyle = 'rgba(3, 9, 18, 0.8)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    trace(ctx, path);
    ctx.strokeStyle = index % 3 === 0 ? 'rgba(237, 249, 255, 0.72)' : 'rgba(180, 212, 238, 0.39)';
    ctx.lineWidth = 0.85;
    ctx.stroke();
    if (reach < 4) continue;
    const [x, y] = path[2];
    const [nextX, nextY] = path[3];
    trace(ctx, [
      [x, y],
      [x + (nextX - x) * 0.53 + (nextY - y) * 0.35, y + (nextY - y) * 0.48 - (nextX - x) * 0.35],
      [(x + nextX) / 2 + (nextY - y) * 0.76, (y + nextY) / 2 - (nextX - x) * 0.76]
    ]);
    ctx.strokeStyle = 'rgba(185, 211, 235, 0.31)';
    ctx.lineWidth = 0.65;
    ctx.stroke();
  }
}

export function drawShards(
  ctx: CanvasRenderingContext2D,
  texture: HTMLCanvasElement,
  shards: ReturnType<typeof glassGeometry>['shards'],
  width: number,
  height: number,
  age: number,
  reduced: boolean
) {
  const part = reduced ? 0.25 : clampUnit(age / SHARD_LIFETIME);
  const travel = 1 - 0.965 * (1 - part) ** 2;
  const opacity = reduced ? 0.7 : (1 - part) ** 1.35;
  for (let index = 0; index < shards.length; index++) {
    const points = shards[index];
    const [x, y] = points[Math.floor(points.length / 2)];
    const [nextX, nextY] = points[Math.floor(points.length / 2) + 1];
    const anchorX = (x + nextX) * 0.5;
    const anchorY = (y + nextY) * 0.5;
    const speed = (0.32 + (index % 4) * 0.13) * travel;
    ctx.save();
    ctx.translate(
      anchorX + (anchorX - width / 2) * speed,
      anchorY + (anchorY - height / 2) * speed + part ** 2 * height * 0.17
    );
    ctx.rotate((index % 2 ? 1 : -1) * part * (0.11 + (index % 3) * 0.045));
    ctx.translate(-anchorX, -anchorY);
    trace(ctx, points, true);
    ctx.clip();
    ctx.globalAlpha = opacity;
    ctx.drawImage(texture, 0, 0, width, height);
    ctx.strokeStyle = 'rgba(214, 236, 255, 0.42)';
    ctx.lineWidth = 1.65;
    ctx.stroke();
    ctx.restore();
  }
}

const INK_FONT = `900 160px 'ZephyrusNotoSerifSC', 'Noto Serif SC', 'Songti SC', SimSun, serif`;

export function printGlyph(
  text: string,
  color: string,
  seed: string,
  distress: number,
  rough: boolean,
  outline: boolean,
  font = INK_FONT,
  outlineWidth = 1.85
) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const metrics = ctx.measureText(text);
  const glyphWidth =
    metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight || metrics.width;
  const glyphHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent || 160;
  const rasterScale = Math.min(1.6, 1720 / Math.max(1, glyphWidth));
  const pad = 5;
  canvas.width = Math.ceil(glyphWidth * rasterScale + pad * 2);
  canvas.height = Math.ceil(glyphHeight * rasterScale + pad * 2);
  ctx.translate(pad, pad);
  ctx.scale(rasterScale, rasterScale);
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  if (outline) {
    ctx.strokeStyle = color;
    ctx.lineWidth = outlineWidth;
    ctx.strokeText(text, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxAscent);
  } else {
    ctx.fillStyle = color;
    ctx.fillText(text, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxAscent);
  }
  const random = impactRandom(seed);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  // Reproduce the same grain in the fill and the imprint for this word.
  const ratio = distress === 0 ? 0 : distress * (0.7 + random() * 0.58);
  const particles = Math.round(
    ((canvas.width * canvas.height) / 420) * ratio * (outline ? 0.7 : 1)
  );
  for (let i = 0; i < particles; i++) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radius = 1 + random() ** 3 * (outline ? 4.4 : 9);
    ctx.fillStyle = `rgba(0,0,0,${0.36 + random() * 0.64})`;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * (0.55 + random() * 0.5), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  if (rough) {
    const notches = Math.round(canvas.width / 1.8);
    ctx.fillStyle = 'rgba(0,0,0,0.87)';
    ctx.beginPath();
    for (let i = 0; i < notches; i++) {
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      ctx.moveTo(x, y);
      ctx.lineTo(x + 1.4 + random() * 3, y + random() * 3);
      ctx.lineTo(x - random() * 2, y + 0.62);
      ctx.closePath();
    }
    // Cut micro-notches into glyph contours independently of the larger ink flecks.
    const contour = document.createElement('canvas');
    contour.width = canvas.width;
    contour.height = canvas.height;
    const edge = contour.getContext('2d')!;
    edge.font = font;
    edge.setTransform(rasterScale, 0, 0, rasterScale, pad, pad);
    edge.lineWidth = 3.25 / rasterScale;
    edge.strokeText(text, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxAscent);
    const scratches = document.createElement('canvas');
    scratches.width = canvas.width;
    scratches.height = canvas.height;
    const scratch = scratches.getContext('2d')!;
    // Keep the path in its original context and use the contour as a mask for the cuts.
    ctx.globalCompositeOperation = 'source-over';
    scratch.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(contour, 0, 0);
    scratch.globalCompositeOperation = 'destination-out';
    scratch.drawImage(canvas, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(scratches, 0, 0);
  }
  return canvas;
}
