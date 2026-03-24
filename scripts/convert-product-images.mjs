import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const PRODUCT_DIRS = [
  'assets/a_modo_mio',
  'assets/dolce_gusto',
  'assets/esse_cialde',
  'assets/grain',
  'assets/meleno',
  'assets/nespresso'
];

const HTML_GLOB_DIR = '.';

async function walk(dir, ext = '.png') {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walk(full, ext));
    } else if (entry.isFile() && full.toLowerCase().endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

function toWebPath(p) {
  return p.replaceAll('\\', '/');
}

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

async function statOrNull(file) {
  try {
    return await fs.stat(file);
  } catch {
    return null;
  }
}

async function convertOne(pngPath) {
  const webpPath = pngPath.replace(/\.png$/i, '.webp');

  const srcStat = await fs.stat(pngPath);

  // High visual quality presets; goal is speed without visible degradation.
  await sharp(pngPath).webp({ quality: 86, effort: 4 }).toFile(webpPath);
  const webpStat = await fs.stat(webpPath);

  return {
    pngPath,
    webpPath,
    pngBytes: srcStat.size,
    webpBytes: webpStat.size
  };
}

async function updateHtmlReferences(converted) {
  const htmlFiles = (await fs.readdir(HTML_GLOB_DIR))
    .filter((f) => f.toLowerCase().endsWith('.html'))
    .map((f) => path.join(HTML_GLOB_DIR, f));

  const map = new Map();
  for (const item of converted) {
    map.set(toWebPath(item.pngPath), toWebPath(item.webpPath));
  }

  let replacements = 0;
  for (const htmlPath of htmlFiles) {
    let content = await fs.readFile(htmlPath, 'utf8');
    const original = content;

    for (const [pngRef, webpRef] of map.entries()) {
      if (content.includes(pngRef)) {
        const escaped = pngRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        content = content.replace(new RegExp(escaped, 'g'), webpRef);
      }
    }

    if (content !== original) {
      replacements += 1;
      await fs.writeFile(htmlPath, content, 'utf8');
    }
  }

  return replacements;
}

async function run() {
  const pngFilesNested = await Promise.all(PRODUCT_DIRS.map((d) => walk(d)));
  const pngFiles = pngFilesNested.flat().sort();

  if (pngFiles.length === 0) {
    console.log('No product PNG files found.');
    return;
  }

  const converted = [];
  for (const pngPath of pngFiles) {
    converted.push(await convertOne(pngPath));
  }

  const htmlUpdated = await updateHtmlReferences(converted);

  const totals = converted.reduce((acc, f) => {
    acc.png += f.pngBytes;
    acc.webp += f.webpBytes;
    return acc;
  }, { png: 0, webp: 0 });

  console.log(`Product PNG converted: ${converted.length}`);
  console.log(`HTML files updated: ${htmlUpdated}`);
  console.log(`Original PNG total: ${mb(totals.png)} MB`);
  console.log(`Generated WebP total: ${mb(totals.webp)} MB`);
  console.log(`WebP saving vs PNG: ${mb(totals.png - totals.webp)} MB`);
}

run().catch((err) => {
  console.error('Conversion failed:', err);
  process.exit(1);
});
