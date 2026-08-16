const path = require("path");
const fs = require("fs/promises");
const sharp = require("sharp");

const THUMB_SIZE = Number(process.env.THUMB_SIZE || 1600);
const THUMB_QUALITY = Number(process.env.THUMB_QUALITY || 85);

const ROOT = path.join(__dirname, "..");
const METADATA_FILE = path.join(ROOT, "data", "metadata.json");
const ORIGINAL_DIR = path.join(ROOT, "uploads", "original");
const THUMB_DIR = path.join(ROOT, "uploads", "thumbs");

async function main() {
  const raw = await fs.readFile(METADATA_FILE, "utf8");
  const items = JSON.parse(raw);

  let processed = 0;

  for (const item of items) {
    const originalName = path.basename(item.original);
    const originalPath = path.join(ORIGINAL_DIR, originalName);
    const thumbName = `${item.id}.webp`;
    const thumbPath = path.join(THUMB_DIR, thumbName);

    await sharp(originalPath)
      .rotate()
      .resize({
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: THUMB_QUALITY })
      .toFile(thumbPath);

    processed += 1;
    console.log(`regenerated ${thumbName}`);
  }

  console.log(`done: ${processed} thumbnails`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
