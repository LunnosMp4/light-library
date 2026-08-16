const path = require("path");
const fs = require("fs/promises");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const METADATA_FILE = path.join(ROOT, "data", "metadata.json");
const ORIGINAL_DIR = path.join(ROOT, "uploads", "original");

async function main() {
  const raw = await fs.readFile(METADATA_FILE, "utf8");
  const items = JSON.parse(raw);

  let fixed = 0;
  let unchanged = 0;

  for (const item of items) {
    const originalName = path.basename(item.original || "");
    const originalPath = path.join(ORIGINAL_DIR, originalName);

    try {
      const metadata = await sharp(originalPath).metadata();
      let width = metadata.width || null;
      let height = metadata.height || null;
      if (width != null && height != null && [5, 6, 7, 8].includes(metadata.orientation)) {
        [width, height] = [height, width];
      }

      if (width !== item.width || height !== item.height) {
        console.log(`${originalName}: ${item.width}x${item.height} -> ${width}x${height}`);
        item.width = width;
        item.height = height;
        fixed += 1;
      } else {
        unchanged += 1;
      }
    } catch (error) {
      console.log(`${originalName}: skipped (${error.message})`);
    }
  }

  await fs.writeFile(METADATA_FILE, JSON.stringify(items, null, 2));
  console.log(`done: ${fixed} fixed, ${unchanged} unchanged`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
