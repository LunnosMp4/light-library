const path = require("path");
const fs = require("fs/promises");
const exifr = require("exifr");

const ROOT = path.join(__dirname, "..");
const METADATA_FILE = path.join(ROOT, "data", "metadata.json");
const ORIGINAL_DIR = path.join(ROOT, "uploads", "original");

function toShutterFraction(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  if (seconds >= 1) {
    return String(Number(seconds.toFixed(1)));
  }

  return `1/${Math.round(1 / seconds)}`;
}

async function extractExif(filePath) {
  try {
    const data = await exifr.parse(filePath, [
      "FNumber",
      "ExposureTime",
      "ISO",
      "FocalLength"
    ]);
    if (!data) {
      return null;
    }

    const exif = {};
    if (data.FNumber) {
      exif.aperture = Number(data.FNumber.toFixed(1));
    }
    const shutter = toShutterFraction(data.ExposureTime);
    if (shutter) {
      exif.shutter = shutter;
    }
    if (data.ISO) {
      exif.iso = Number(data.ISO);
    }
    if (data.FocalLength) {
      exif.focalLength = Math.round(data.FocalLength);
    }

    return Object.keys(exif).length ? exif : null;
  } catch (error) {
    return null;
  }
}

async function main() {
  const raw = await fs.readFile(METADATA_FILE, "utf8");
  const items = JSON.parse(raw);

  let updated = 0;
  let missing = 0;

  for (const item of items) {
    const originalName = path.basename(item.original || "");
    const originalPath = path.join(ORIGINAL_DIR, originalName);

    let exif = null;
    try {
      exif = await extractExif(originalPath);
    } catch (error) {
      exif = null;
    }

    item.exif = exif;
    if (exif) {
      updated += 1;
      console.log(`${originalName}: ${JSON.stringify(exif)}`);
    } else {
      missing += 1;
      console.log(`${originalName}: no EXIF`);
    }
  }

  await fs.writeFile(METADATA_FILE, JSON.stringify(items, null, 2));
  console.log(`done: ${updated} with EXIF, ${missing} without`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
