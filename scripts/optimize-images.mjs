import fs from 'node:fs/promises';
import imagemin from 'imagemin';
import imageminMozjpeg from 'imagemin-mozjpeg';
import imageminPngquant from 'imagemin-pngquant';

const SOURCE_GLOB = ['assets/**/*.{jpg,jpeg,png}', '!assets/favicon-full.png'];
const TEMP_DIR = '.tmp-optimized-assets';

async function ensureCleanTempDir() {
  await fs.rm(TEMP_DIR, { recursive: true, force: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

async function optimize() {
  await ensureCleanTempDir();

  const files = await imagemin(SOURCE_GLOB, {
    destination: TEMP_DIR,
    plugins: [
      imageminMozjpeg({
        quality: 92,
        progressive: true
      }),
      imageminPngquant({
        quality: [0.92, 1],
        speed: 1,
        strip: true
      })
    ]
  });

  let originalBytes = 0;
  let optimizedBytes = 0;
  let savedBytes = 0;
  let replaced = 0;
  let skipped = 0;

  for (const file of files) {
    const srcPath = file.sourcePath;
    const optimizedPath = file.destinationPath;

    const srcStat = await fs.stat(srcPath).catch(() => null);
    if (!srcStat) {
      skipped += 1;
      continue;
    }

    const optimizedStat = await fs.stat(optimizedPath).catch(() => null);

    originalBytes += srcStat.size;
    // Some files can be skipped by plugins and not written to destination.
    if (!optimizedStat) {
      optimizedBytes += srcStat.size;
      skipped += 1;
      continue;
    }

    optimizedBytes += optimizedStat.size;

    if (optimizedStat.size < srcStat.size) {
      await fs.copyFile(optimizedPath, srcPath);
      savedBytes += srcStat.size - optimizedStat.size;
      replaced += 1;
    }
  }

  await fs.rm(TEMP_DIR, { recursive: true, force: true });

  console.log(`Files processed: ${files.length}`);
  console.log(`Files replaced: ${replaced}`);
  console.log(`Files skipped: ${skipped}`);
  console.log(`Original total: ${mb(originalBytes)} MB`);
  console.log(`Optimized total: ${mb(optimizedBytes)} MB`);
  console.log(`Saved: ${mb(savedBytes)} MB`);
}

optimize().catch(async (error) => {
  console.error('Image optimization failed:', error);
  await fs.rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
