const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxClose = document.getElementById("lightbox-close");
const albumNav = document.getElementById("album-nav");
const albumNavList = document.getElementById("album-nav-list");

let currentSlug = null;

let isDragging = false;
let dragMoved = false;
let suppressClick = false;
let dragStartX = 0;
let dragStartScrollLeft = 0;

function openLightbox(src) {
  lightboxImage.src = src;
  lightbox.classList.remove("hidden");
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  lightboxImage.src = "";
}

lightboxClose.addEventListener("click", closeLightbox);
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
  img.dataset.full = image.original;

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
    openLightbox(img.dataset.full);
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
}

async function loadImages(slug) {
  const url = slug
    ? `/images?album=${encodeURIComponent(slug)}`
    : "/images";
  const response = await fetch(url);
  const images = await response.json();
  renderImages(images);
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

async function switchAlbum(slug) {
  if (slug === currentSlug) {
    return;
  }

  currentSlug = slug;
  setActive(slug);

  grid.classList.add("is-fading");

  try {
    await loadImages(slug);
  } catch (error) {
    empty.textContent = "Failed to load images.";
    empty.classList.remove("hidden");
  }

  grid.classList.remove("is-fading");
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
    await loadImages(null);
  } catch (error) {
    empty.textContent = "Failed to load images.";
    empty.classList.remove("hidden");
  }
});
