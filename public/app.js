const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxClose = document.getElementById("lightbox-close");

const placeholderSrc =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

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

function getGridMetrics() {
  const styles = getComputedStyle(grid);
  const rowHeight = parseInt(styles.getPropertyValue("grid-auto-rows"), 10) || 10;
  const gap = parseInt(styles.getPropertyValue("gap"), 10) || 0;
  return { rowHeight, gap };
}

function layoutGrid() {
  const items = Array.from(grid.children);
  if (items.length === 0) {
    return;
  }

  const first = items[0];
  const columnWidth = first.getBoundingClientRect().width;
  if (!columnWidth) {
    return;
  }

  const { rowHeight, gap } = getGridMetrics();
  const maxCols = Math.max(1, Math.floor((grid.clientWidth + gap) / (columnWidth + gap)));

  items.forEach((item) => {
    const width = Number(item.dataset.width) || 1;
    const height = Number(item.dataset.height) || 1;
    let spanCols = Number(item.dataset.span) || 1;
    spanCols = Math.min(spanCols, maxCols);

    item.style.gridColumnEnd = `span ${spanCols}`;

    const itemWidth = columnWidth * spanCols + gap * (spanCols - 1);
    const itemHeight = Math.round(itemWidth);
    const rowSpan = Math.max(1, Math.ceil((itemHeight + gap) / (rowHeight + gap)));

    item.style.gridRowEnd = `span ${rowSpan}`;
  });
}

const resizeObserver = new ResizeObserver(() => {
  layoutGrid();
});
resizeObserver.observe(grid);

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

  images.forEach((image) => {
    const item = document.createElement("article");
    item.className = "grid-item";

    const width = image.width || 1;
    const height = image.height || 1;
    const aspectRatio = width / height;
    let spanCols = 1;

    if (aspectRatio > 1.25) {
      spanCols = 2;
    }

    item.dataset.width = String(width);
    item.dataset.height = String(height);
    item.dataset.span = String(spanCols);

    const img = document.createElement("img");
    img.alt = "Photo";
    img.loading = "lazy";
    img.src = placeholderSrc;
    img.dataset.src = image.thumb;
    img.dataset.full = image.original;

    img.addEventListener("click", () => {
      openLightbox(img.dataset.full);
    });

    observer.observe(img);
    item.appendChild(img);

    grid.appendChild(item);
  });

  requestAnimationFrame(layoutGrid);
}

loadImages().catch(() => {
  empty.textContent = "Failed to load images.";
  empty.classList.remove("hidden");
});
