const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const polaroidWrapper = document.querySelector(".polaroid-img-wrapper");
const exifData = document.getElementById("exif-data");
const polaroidAction = document.getElementById("polaroid-action");
const albumNav = document.getElementById("album-nav");
const albumNavList = document.getElementById("album-nav-list");

let currentSlug = null;
let lightboxToken = 0;

let isDragging = false;
let dragMoved = false;
let suppressClick = false;
let dragStartX = 0;
let dragStartScrollLeft = 0;

function cameraLabel(exif) {
  const make = exif.make ? String(exif.make).trim() : "";
  const model = exif.model ? String(exif.model).trim() : "";

  if (!make && !model) {
    return null;
  }

  if (make && model) {
    return model.toLowerCase().startsWith(make.toLowerCase())
      ? model
      : `${make} ${model}`;
  }

  return make || model;
}

function renderExif(exif) {
  if (!exif) {
    exifData.textContent = "";
    exifData.classList.add("hidden");
    return;
  }

  const parts = [];
  const camera = cameraLabel(exif);
  if (camera) {
    parts.push(camera);
  }
  if (exif.focalLength != null) {
    parts.push(`${exif.focalLength}mm`);
  }
  if (exif.aperture != null) {
    parts.push(`f/${exif.aperture}`);
  }
  if (exif.shutter) {
    parts.push(`${exif.shutter}s`);
  }
  if (exif.iso != null) {
    parts.push(`ISO ${exif.iso}`);
  }

  if (!parts.length) {
    exifData.textContent = "";
    exifData.classList.add("hidden");
    return;
  }

  exifData.textContent = parts.join(" • ");
  exifData.classList.remove("hidden");
}

function openLightbox(image, thumbImg) {
  const token = ++lightboxToken;

  let ratio = null;
  if (thumbImg && thumbImg.naturalWidth > 0 && thumbImg.naturalHeight > 0) {
    ratio = thumbImg.naturalWidth / thumbImg.naturalHeight;
  } else {
    const width = Number(image.width) || 0;
    const height = Number(image.height) || 0;
    if (width > 0 && height > 0) {
      ratio = width / height;
    }
  }

  lightboxImage.classList.add("loading");
  if (ratio) {
    polaroidWrapper.style.setProperty("--ratio", String(ratio));
  }
  lightboxImage.src = image.thumb;
  polaroidAction.href = image.original;
  renderExif(image.exif);
  lightbox.classList.remove("hidden");

  const highResImg = new Image();
  highResImg.onload = () => {
    if (token !== lightboxToken) {
      return;
    }

    lightboxImage.src = image.original;
    lightboxImage.classList.remove("loading");
  };
  highResImg.onerror = () => {
    if (token === lightboxToken) {
      lightboxImage.classList.remove("loading");
    }
  };
  highResImg.src = image.original;
}

function closeLightbox() {
  lightboxToken += 1;
  lightbox.classList.add("hidden");
  lightboxImage.classList.remove("loading");
  lightboxImage.src = "";
  polaroidAction.href = "#";
  exifData.textContent = "";
  exifData.classList.add("hidden");
}

lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLightbox();
  }
});

function buildImageItem(image) {
  const item = document.createElement("article");
  item.className = "masonry-item";

  const img = document.createElement("img");
  img.alt = "Photo";
  img.decoding = "async";
  img.src = image.thumb;

  const width = Number(image.width) || 0;
  const height = Number(image.height) || 0;
  if (width > 0 && height > 0) {
    img.width = width;
    img.height = height;
  }

  if (img.complete && img.naturalWidth > 0) {
    img.classList.add("loaded");
  } else {
    img.addEventListener("load", () => img.classList.add("loaded"), {
      once: true
    });
  }

  img.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 768px)").matches) {
      window.open(image.original, "_blank", "noopener,noreferrer");
      return;
    }
    openLightbox(image, img);
  });

  item.appendChild(img);
  return item;
}

function renderImages(images) {
  grid.innerHTML = "";

  if (!Array.isArray(images) || images.length === 0) {
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  const fragment = document.createDocumentFragment();
  images.forEach((image) => {
    fragment.appendChild(buildImageItem(image));
  });
  grid.appendChild(fragment);

  applyColumnBalance(images.length);
}

function responsiveColumnCount() {
  return window.matchMedia("(max-width: 768px)").matches ? 2 : 4;
}

function applyColumnBalance(count) {
  const columns = responsiveColumnCount();

  if (count > 0 && count < columns) {
    grid.style.columnCount = String(count);
  } else {
    grid.style.columnCount = "";
  }
}

async function fetchImages(slug) {
  const url = slug
    ? `/images?album=${encodeURIComponent(slug)}`
    : "/images";
  const response = await fetch(url);
  return response.json();
}

function setActive(slug) {
  albumNavList.querySelectorAll(".album-link").forEach((link) => {
    const linkSlug = link.dataset.slug || null;
    const active = linkSlug === slug;
    link.classList.toggle("active", active);

    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function renderNav(albums) {
  albumNavList.innerHTML = "";

  const allItem = document.createElement("li");
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = "album-link active";
  allButton.dataset.slug = "";
  allButton.textContent = "All Images";
  allItem.appendChild(allButton);
  albumNavList.appendChild(allItem);

  (albums || []).forEach((album) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "album-link";
    button.dataset.slug = album.slug;
    button.textContent = album.name;
    item.appendChild(button);
    albumNavList.appendChild(item);
  });
}

const EXIT_DURATION = 350;
const ENTER_DURATION = 600;
const STAGGER_STEP = 25;
const STAGGER_MAX = 300;

let switchToken = 0;

function animateExit(items) {
  if (!items.length) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timer = setTimeout(finish, EXIT_DURATION + 60);

    let pending = items.length;
    items.forEach((item) => {
      const onEnd = (event) => {
        if (event.target !== item || event.propertyName !== "transform") {
          return;
        }
        item.removeEventListener("transitionend", onEnd);
        pending -= 1;
        if (pending <= 0) {
          clearTimeout(timer);
          finish();
        }
      };
      item.addEventListener("transitionend", onEnd);
      item.classList.add("album-exit");
    });
  });
}

function enterItems(items) {
  if (!items.length) {
    return;
  }

  items.forEach((item, index) => {
    item.style.setProperty(
      "--delay",
      `${Math.min(index * STAGGER_STEP, STAGGER_MAX)}ms`
    );
    item.classList.add("album-enter");
  });

  const maxDelay = Math.min((items.length - 1) * STAGGER_STEP, STAGGER_MAX);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      items.forEach((item) => {
        item.classList.remove("album-enter");
        item.classList.add("album-enter-active");
      });

      window.setTimeout(() => {
        items.forEach((item) => {
          item.classList.remove("album-enter-active");
          item.style.removeProperty("--delay");
        });
      }, maxDelay + ENTER_DURATION + 60);
    });
  });
}

async function switchAlbum(slug) {
  if (slug === currentSlug) {
    return;
  }

  const token = ++switchToken;
  currentSlug = slug;
  setActive(slug);

  const items = Array.from(grid.querySelectorAll(".masonry-item"));
  await animateExit(items);
  if (token !== switchToken) {
    return;
  }

  let images;
  try {
    images = await fetchImages(slug);
  } catch (error) {
    if (token !== switchToken) {
      return;
    }
    grid.innerHTML = "";
    empty.textContent = "Failed to load images.";
    empty.classList.remove("hidden");
    return;
  }
  if (token !== switchToken) {
    return;
  }

  renderImages(images);
  enterItems(Array.from(grid.querySelectorAll(".masonry-item")));
}

albumNavList.addEventListener("click", (event) => {
  const button = event.target.closest(".album-link");

  if (!button) {
    return;
  }

  if (suppressClick) {
    suppressClick = false;
    return;
  }

  switchAlbum(button.dataset.slug || null);
});

albumNav.addEventListener("mousedown", (event) => {
  isDragging = true;
  dragMoved = false;
  suppressClick = false;
  dragStartX = event.clientX;
  dragStartScrollLeft = albumNav.scrollLeft;
  albumNav.classList.add("is-dragging");
});

window.addEventListener("mousemove", (event) => {
  if (!isDragging) {
    return;
  }

  const dx = event.clientX - dragStartX;
  if (Math.abs(dx) > 5) {
    dragMoved = true;
  }

  albumNav.scrollLeft = dragStartScrollLeft - dx;
});

function endDrag() {
  if (!isDragging) {
    return;
  }

  isDragging = false;
  albumNav.classList.remove("is-dragging");
  suppressClick = dragMoved;
  dragMoved = false;
}

window.addEventListener("mouseup", endDrag);
albumNav.addEventListener("mouseleave", endDrag);

albumNav.addEventListener(
  "wheel",
  (event) => {
    if (albumNav.scrollWidth <= albumNav.clientWidth) {
      return;
    }

    event.preventDefault();
    albumNav.scrollLeft += event.deltaY + event.deltaX;
  },
  { passive: false }
);

window.addEventListener("resize", () => {
  applyColumnBalance(grid.querySelectorAll(".masonry-item").length);
});

document.addEventListener("DOMContentLoaded", async () => {
  let albums = [];

  try {
    const response = await fetch("/albums");
    albums = await response.json();
  } catch (error) {
    albums = [];
  }

  renderNav(albums);
  setActive(null);

  try {
    const images = await fetchImages(null);
    renderImages(images);
    enterItems(Array.from(grid.querySelectorAll(".masonry-item")));
  } catch (error) {
    empty.textContent = "Failed to load images.";
    empty.classList.remove("hidden");
  }
});
