const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const sharp = require("sharp");
const exifr = require("exifr");
const checkDiskSpace = require("check-disk-space").default;
const { nanoid } = require("nanoid");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "changeme";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me";
const THUMB_SIZE = Number(process.env.THUMB_SIZE || 1600);
const THUMB_QUALITY = Number(process.env.THUMB_QUALITY || 85);

const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const ORIGINAL_DIR = path.join(UPLOAD_DIR, "original");
const THUMB_DIR = path.join(UPLOAD_DIR, "thumbs");
const METADATA_FILE = path.join(DATA_DIR, "metadata.json");
const ALBUMS_FILE = path.join(DATA_DIR, "albums.json");
const TEMP_DIR = path.join(UPLOAD_DIR, "tmp");

const allowedMime = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif"
]);

const extByMime = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/heif": ".heif"
};

let writeQueue = Promise.resolve();
let albumsWriteQueue = Promise.resolve();

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(ORIGINAL_DIR, { recursive: true });
  await fs.mkdir(THUMB_DIR, { recursive: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });

  try {
    await fs.access(METADATA_FILE);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(METADATA_FILE, "[]");
    } else {
      throw error;
    }
  }

  try {
    await fs.access(ALBUMS_FILE);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(ALBUMS_FILE, "[]");
    } else {
      throw error;
    }
  }
}

async function readMetadata() {
  try {
    const raw = await fs.readFile(METADATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item) => ({
      ...item,
      albums: Array.isArray(item.albums) ? item.albums : [],
      isFeatured: Boolean(item.isFeatured)
    }));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    return [];
  }
}

function saveMetadata(items) {
  writeQueue = writeQueue.then(() =>
    fs.writeFile(METADATA_FILE, JSON.stringify(items, null, 2))
  );
  return writeQueue;
}

async function readAlbums() {
  try {
    const raw = await fs.readFile(ALBUMS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    return [];
  }
}

function saveAlbums(items) {
  albumsWriteQueue = albumsWriteQueue.then(() =>
    fs.writeFile(ALBUMS_FILE, JSON.stringify(items, null, 2))
  );
  return albumsWriteQueue;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeIds(raw) {
  if (raw == null) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw.map((value) => String(value)).filter(Boolean);
  }

  return [String(raw)].filter(Boolean);
}

function toIsoDate(value) {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

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
      "Make",
      "Model",
      "FNumber",
      "ExposureTime",
      "ISO",
      "FocalLength",
      "DateTimeOriginal",
      "CreateDate"
    ]);
    if (!data) {
      return { exif: null, dateTaken: null };
    }

    const exif = {};
    if (data.Make) {
      exif.make = String(data.Make).trim();
    }
    if (data.Model) {
      exif.model = String(data.Model).trim();
    }
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

    const dateTaken = toIsoDate(data.DateTimeOriginal || data.CreateDate);

    return {
      exif: Object.keys(exif).length ? exif : null,
      dateTaken
    };
  } catch (error) {
    return { exif: null, dateTaken: null };
  }
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }

  return res.status(401).json({ ok: false, message: "Unauthorized" });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, TEMP_DIR);
    },
    filename: (req, file, cb) => {
      const ext = extByMime[file.mimetype];
      cb(null, `${nanoid()}${ext}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (allowedMime.has(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error("Unsupported file type"));
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

app.use("/uploads", express.static(UPLOAD_DIR, { fallthrough: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function imageSortTime(image) {
  const taken = toIsoDate(image.dateTaken);
  if (taken) {
    return new Date(taken).getTime();
  }

  const fallback = toIsoDate(image.upload_date || image.createdAt);
  return fallback ? new Date(fallback).getTime() : 0;
}

app.get("/images", async (req, res) => {
  const { album } = req.query;
  let images = await readMetadata();
  images.sort((a, b) => imageSortTime(b) - imageSortTime(a));

  if (album) {
    const albums = await readAlbums();
    const target = albums.find((entry) => entry.slug === album);

    if (target) {
      images = images.filter(
        (image) =>
          Array.isArray(image.albums) && image.albums.includes(target.id)
      );
    } else {
      images = [];
    }
  }

  res.json(images);
});

app.get("/albums", async (req, res) => {
  const albums = await readAlbums();
  res.json(albums);
});

app.post("/admin/albums", requireAdmin, async (req, res, next) => {
  try {
    const name = String((req.body && req.body.name) || "").trim();

    if (!name) {
      res.status(400).json({ ok: false, message: "Album name is required" });
      return;
    }

    const albums = await readAlbums();
    const base = slugify(name) || "album";
    const existing = new Set(albums.map((entry) => entry.slug));

    let slug = base;
    let counter = 2;
    while (existing.has(slug)) {
      slug = `${base}-${counter}`;
      counter += 1;
    }

    const album = {
      id: nanoid(),
      name,
      slug,
      createdAt: new Date().toISOString()
    };

    albums.unshift(album);
    await saveAlbums(albums);

    res.json({ ok: true, album });
  } catch (error) {
    next(error);
  }
});

app.put("/admin/albums/reorder", requireAdmin, async (req, res, next) => {
  try {
    const order = Array.isArray(req.body && req.body.order)
      ? req.body.order.map((id) => String(id))
      : null;

    if (!order) {
      res.status(400).json({ ok: false, message: "Order array is required" });
      return;
    }

    const albums = await readAlbums();
    const byId = new Map(albums.map((album) => [album.id, album]));

    const ordered = order.map((id) => byId.get(id)).filter(Boolean);

    const included = new Set(ordered.map((album) => album.id));
    const extras = albums.filter((album) => !included.has(album.id));

    const result = ordered.concat(extras);
    await saveAlbums(result);

    res.json({ ok: true, albums: result });
  } catch (error) {
    next(error);
  }
});

app.patch("/admin/albums/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const name = String((req.body && req.body.name) || "").trim();

    if (!name) {
      res.status(400).json({ ok: false, message: "Album name is required" });
      return;
    }

    const albums = await readAlbums();
    const album = albums.find((entry) => entry.id === id);

    if (!album) {
      res.status(404).json({ ok: false, message: "Not found" });
      return;
    }

    album.name = name;

    const base = slugify(name) || "album";
    const existing = new Set(
      albums.filter((entry) => entry.id !== id).map((entry) => entry.slug)
    );

    let slug = base;
    let counter = 2;
    while (existing.has(slug)) {
      slug = `${base}-${counter}`;
      counter += 1;
    }

    album.slug = slug;
    await saveAlbums(albums);

    res.json({ ok: true, album });
  } catch (error) {
    next(error);
  }
});

app.delete("/admin/albums/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleteImages =
      req.query.deleteImages === "1" || req.query.deleteImages === "true";

    const albums = await readAlbums();
    const albumIndex = albums.findIndex((entry) => entry.id === id);

    if (albumIndex === -1) {
      res.status(404).json({ ok: false, message: "Not found" });
      return;
    }

    albums.splice(albumIndex, 1);
    await saveAlbums(albums);

    const items = await readMetadata();
    const affected = items.filter(
      (item) => Array.isArray(item.albums) && item.albums.includes(id)
    );

    if (deleteImages) {
      const removedIds = new Set(affected.map((item) => item.id));
      const remaining = items.filter((item) => !removedIds.has(item.id));
      await saveMetadata(remaining);

      await Promise.allSettled(
        affected.flatMap((item) => {
          const originalName = path.basename(item.original || "");
          const thumbName = path.basename(item.thumb || "");
          const tasks = [];

          if (originalName) {
            tasks.push(fs.unlink(path.join(ORIGINAL_DIR, originalName)));
          }

          if (thumbName) {
            tasks.push(fs.unlink(path.join(THUMB_DIR, thumbName)));
          }

          return tasks;
        })
      );
    } else {
      affected.forEach((item) => {
        item.albums = item.albums.filter((albumId) => albumId !== id);
      });
      await saveMetadata(items);
    }

    res.json({ ok: true, removedImages: affected.length });
  } catch (error) {
    next(error);
  }
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/admin/session", (req, res) => {
  res.json({ ok: true, isAdmin: Boolean(req.session && req.session.isAdmin) });
});

app.get("/admin/storage", requireAdmin, async (req, res, next) => {
  try {
    const { free, size } = await checkDiskSpace(UPLOAD_DIR);
    const used = Math.max(0, size - free);
    res.json({ ok: true, totalBytes: size, freeBytes: free, usedBytes: used });
  } catch (error) {
    next(error);
  }
});

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    res.json({ ok: true });
    return;
  }

  res.status(401).json({ ok: false, message: "Invalid credentials" });
});

app.post("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post("/admin/upload", requireAdmin, upload.single("photo"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ ok: false, message: "No files uploaded" });
      return;
    }

    const items = await readMetadata();
    const file = req.file;
    const originalName = path.basename(file.filename);
    const id = path.parse(originalName).name;
    const originalPath = path.join(ORIGINAL_DIR, originalName);
    const thumbName = `${id}.webp`;
    const thumbPath = path.join(THUMB_DIR, thumbName);

    const albums = await readAlbums();
    const validAlbumIds = new Set(albums.map((album) => album.id));
    const albumIds = normalizeIds(req.body.album_ids).filter((albumId) =>
      validAlbumIds.has(albumId)
    );

    try {
      const metadata = await sharp(file.path).metadata();
      const { exif, dateTaken } = await extractExif(file.path);

      let width = metadata.width || null;
      let height = metadata.height || null;
      if (width != null && height != null && [5, 6, 7, 8].includes(metadata.orientation)) {
        [width, height] = [height, width];
      }

      const createdAt = new Date().toISOString();
      let resolvedDateTaken = dateTaken;
      if (!resolvedDateTaken) {
        try {
          const stat = await fs.stat(file.path);
          resolvedDateTaken = toIsoDate(stat.birthtime) || createdAt;
        } catch (statError) {
          resolvedDateTaken = createdAt;
        }
      }

      await sharp(file.path)
        .rotate()
        .resize({
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          fit: "inside",
          withoutEnlargement: true
        })
        .webp({ quality: THUMB_QUALITY })
        .toFile(thumbPath);

      await fs.rename(file.path, originalPath);

      const record = {
        id,
        filename: originalName,
        original: `/uploads/original/${originalName}`,
        thumb: `/uploads/thumbs/${thumbName}`,
        createdAt,
        dateTaken: resolvedDateTaken,
        width,
        height,
        albums: albumIds,
        isFeatured: false,
        exif
      };

      items.push(record);
      await saveMetadata(items);

      res.json({ ok: true, added: [record] });
    } catch (error) {
      try {
        await fs.unlink(file.path);
      } catch (cleanupError) {
        void cleanupError;
      }

      throw error;
    }
  } catch (error) {
    next(error);
  }
});

app.delete("/admin/images/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const items = await readMetadata();
    const index = items.findIndex((item) => item.id === id);

    if (index === -1) {
      res.status(404).json({ ok: false, message: "Not found" });
      return;
    }

    const [removed] = items.splice(index, 1);
    await saveMetadata(items);

    const originalName = path.basename(removed.original || "");
    const thumbName = path.basename(removed.thumb || "");

    await Promise.allSettled([
      originalName ? fs.unlink(path.join(ORIGINAL_DIR, originalName)) : null,
      thumbName ? fs.unlink(path.join(THUMB_DIR, thumbName)) : null
    ]);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.patch("/admin/images/:id/featured", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const items = await readMetadata();
    const index = items.findIndex((item) => item.id === id);

    if (index === -1) {
      res.status(404).json({ ok: false, message: "Not found" });
      return;
    }

    const isFeatured = Boolean(req.body && req.body.isFeatured);
    const item = items[index];
    const width = Number(item.width) || 0;
    const height = Number(item.height) || 0;

    if (isFeatured && width <= height) {
      res
        .status(400)
        .json({ ok: false, message: "Only horizontal images can be featured" });
      return;
    }

    item.isFeatured = isFeatured;
    await saveMetadata(items);

    res.json({ ok: true, image: item });
  } catch (error) {
    next(error);
  }
});

app.patch("/admin/images/:id/albums", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const items = await readMetadata();
    const index = items.findIndex((item) => item.id === id);

    if (index === -1) {
      res.status(404).json({ ok: false, message: "Not found" });
      return;
    }

    const albums = await readAlbums();
    const validAlbumIds = new Set(albums.map((album) => album.id));
    const albumIds = normalizeIds(req.body.album_ids).filter((albumId) =>
      validAlbumIds.has(albumId)
    );

    items[index].albums = albumIds;
    await saveMetadata(items);

    res.json({ ok: true, image: items[index] });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ ok: false, message: error.message });
    return;
  }

  res.status(400).json({
    ok: false,
    message: error.message || "Upload failed"
  });
});

ensureStorage()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Photo server listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
