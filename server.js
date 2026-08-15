const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const sharp = require("sharp");
const checkDiskSpace = require("check-disk-space").default;
const { nanoid } = require("nanoid");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "changeme";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me";
const THUMB_SIZE = Number(process.env.THUMB_SIZE || 1200);
const THUMB_QUALITY = Number(process.env.THUMB_QUALITY || 85);

const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const ORIGINAL_DIR = path.join(UPLOAD_DIR, "original");
const THUMB_DIR = path.join(UPLOAD_DIR, "thumbs");
const METADATA_FILE = path.join(DATA_DIR, "metadata.json");
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
      return;
    }

    throw error;
  }
}

async function readMetadata() {
  try {
    const raw = await fs.readFile(METADATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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

app.get("/images", async (req, res) => {
  const images = await readMetadata();
  images.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json(images);
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

    try {
      const metadata = await sharp(file.path).metadata();
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
        createdAt: new Date().toISOString(),
        width: metadata.width || null,
        height: metadata.height || null
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
