import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, process.argv[2] || 'resources/icon.png');
const original = await sharp(source)
  .resize(512, 512, { fit: 'contain', background: '#ffffff' })
  .png()
  .toBuffer();
const rounded = await sharp(original)
  .composite([
    {
      input: Buffer.from(
        '<svg width="512" height="512"><rect width="512" height="512" rx="112" fill="white"/></svg>'
      ),
      blend: 'dest-in'
    }
  ])
  .png()
  .toBuffer();

async function save(path, data) {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
}

async function png(path, size, image = rounded) {
  await save(path, await sharp(image).resize(size, size).png().toBuffer());
}

async function ico(image) {
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map((size) => sharp(image).resize(size, size).png().toBuffer())
  );
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  return Buffer.concat([header, ...images]);
}

await save('resources/icon.png', original);
await save('resources/icon-web.png', rounded);
for (const directory of ['resources', 'src/renderer/assets', 'website/public']) {
  await png(`${directory}/icon_512.png`, 512);
  await png(`${directory}/icon_16x16.png`, 16);
  if (directory !== 'resources') await png(`${directory}/icon.png`, 512);
  await save(`${directory}/icon.ico`, await ico(original));
  await save(`${directory}/favicon.ico`, await ico(rounded));
}
await save('src/renderer/assets/logo.png', rounded);
await save(
  'src/renderer/assets/splash-launch.png',
  await sharp({ create: { width: 1920, height: 4103, channels: 3, background: '#ffffff' } })
    .composite([
      { input: await sharp(original).resize(1024, 1024).png().toBuffer(), left: 448, top: 1539 }
    ])
    .png()
    .toBuffer()
);
for (const path of [
  'product-site/public/icon.png',
  'product-site/public/zephyrus-mark.png',
  'website/public/zephyrus-mark.png',
  'website/public/zephyrus-icon.png'
])
  await save(path, rounded);
await save('product-site/public/zephyrus-logo-original.png', original);

const chunks = [];
for (const [type, size] of [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024]
]) {
  const image = await sharp(original).resize(size, size).png().toBuffer();
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(image.length + 8, 4);
  chunks.push(header, image);
}
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns');
icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
await save('resources/icon.icns', Buffer.concat([icnsHeader, ...chunks]));

const { data, info } = await sharp(original)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const mask = Buffer.alloc(info.width * info.height * 4);
for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
  mask[pixel * 4 + 3] =
    255 - Math.round((data[pixel * 3] + data[pixel * 3 + 1] + data[pixel * 3 + 2]) / 3);
}
const monochrome = await sharp(mask, {
  raw: { width: info.width, height: info.height, channels: 4 }
})
  .png()
  .toBuffer();
for (const [density, size, foreground] of [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432]
]) {
  const directory = `android/app/src/main/res/mipmap-${density}`;
  await png(`${directory}/ic_launcher.png`, size, original);
  const circle = await sharp(original)
    .composite([
      {
        input: Buffer.from(
          '<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="white"/></svg>'
        ),
        blend: 'dest-in'
      }
    ])
    .png()
    .toBuffer();
  await png(`${directory}/ic_launcher_round.png`, size, circle);
  await png(`${directory}/ic_launcher_foreground.png`, foreground, original);
  await png(`${directory}/ic_launcher_monochrome.png`, foreground, monochrome);
}
console.log('Updated application, Android, desktop and website icons.');
