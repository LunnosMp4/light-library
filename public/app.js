const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxClose = document.getElementById("lightbox-close");

let hasLoaded = false;

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

async function loadImages() {
  if (hasLoaded) {
    return;
  }
  hasLoaded = true;

  grid.innerHTML = "";

  const response = await fetch("/images");
  const images = await response.json();

  if (!Array.isArray(images) || images.length === 0) {
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  const fragment = document.createDocumentFragment();

  images.forEach((image) => {
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
    fragment.appendChild(item);
  });

  grid.appendChild(fragment);
}

document.addEventListener("DOMContentLoaded", () => {
  loadImages().catch(() => {
    empty.textContent = "Failed to load images.";
    empty.classList.remove("hidden");
  });
});
