const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxClose = document.getElementById("lightbox-close");

const observer = new IntersectionObserver(
  (entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }

      const img = entry.target;
      const src = img.dataset.src;

      if (src) {
        img.src = src;
        img.removeAttribute("data-src");
      }

      obs.unobserve(img);
    });
  },
  { rootMargin: "300px" }
);

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
    img.loading = "lazy";
    img.decoding = "async";

    const width = Number(image.width) || 0;
    const height = Number(image.height) || 0;
    if (width > 0 && height > 0) {
      img.width = width;
      img.height = height;
    }

    img.dataset.src = image.thumb;
    img.dataset.full = image.original;

    if (img.complete) {
      img.classList.add("loaded");
    } else {
      img.addEventListener("load", () => img.classList.add("loaded"), {
        once: true
      });
    }

    img.addEventListener("click", () => {
      openLightbox(img.dataset.full);
    });

    observer.observe(img);
    item.appendChild(img);
    fragment.appendChild(item);
  });

  grid.appendChild(fragment);
}

loadImages().catch(() => {
  empty.textContent = "Failed to load images.";
  empty.classList.remove("hidden");
});
