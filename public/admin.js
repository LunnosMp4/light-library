const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const loginView = document.getElementById("login-view");
const dashboard = document.getElementById("dashboard");
const uploadForm = document.getElementById("upload-form");
const uploadStatus = document.getElementById("upload-status");
const logoutButton = document.getElementById("logout");
const progressBar = document.getElementById("progress-bar");
const adminGallery = document.getElementById("admin-gallery");
const storageBox = document.getElementById("storage");
const albumForm = document.getElementById("album-form");
const albumStatus = document.getElementById("album-status");
const albumList = document.getElementById("album-list");
const uploadAlbums = document.getElementById("upload-albums");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const previewQueue = document.getElementById("preview-queue");
const editModal = document.getElementById("edit-modal");
const editThumb = document.getElementById("edit-thumb");
const editFilename = document.getElementById("edit-filename");
const editAlbums = document.getElementById("edit-albums");
const editSave = document.getElementById("edit-save");
const editCancel = document.getElementById("edit-cancel");
const libraryTitle = document.getElementById("library-title");
const selectAllButton = document.getElementById("select-all");
const selectionBar = document.getElementById("selection-bar");
const selectionCount = document.getElementById("selection-count");
const selectionClear = document.getElementById("selection-clear");
const selectionDelete = document.getElementById("selection-delete");
const navItems = Array.from(document.querySelectorAll(".nav-item"));
const views = {
  upload: document.getElementById("view-upload"),
  library: document.getElementById("view-library")
};

let albums = [];
let albumById = new Map();
let albumCounts = new Map();
let selectedUploadAlbums = new Set();
let selectedFiles = [];
let editingSelected = new Set();
let selectedIds = new Set();
let libraryImages = [];
let currentFilter = null;
let editingImage = null;

function formatGB(bytes) {
  const gb = bytes / 1024 ** 3;
  return `${gb.toFixed(2)} GB`;
}

function switchView(name) {
  Object.entries(views).forEach(([key, element]) => {
    element.classList.toggle("active", key === name);
  });

  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === name);
  });
}

async function login(username, password) {
  const response = await fetch("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password })
  });

  if (!response.ok) {
    throw new Error("Invalid credentials");
  }
}

async function checkSession() {
  const response = await fetch("/admin/session", { credentials: "include" });
  const payload = await response.json();
  return Boolean(payload && payload.isAdmin);
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || "Request failed");
  }

  return payload;
}

function uploadSingle(file, albumIds, progressCallback) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("photo", file, file.name);
    albumIds.forEach((id) => formData.append("album_ids", id));

    xhr.open("POST", "/admin/upload");
    xhr.withCredentials = true;

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        return;
      }
      progressCallback(event.loaded / event.total);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      try {
        const payload = JSON.parse(xhr.responseText || "{}");
        reject(new Error(payload.message || "Upload failed"));
      } catch (error) {
        reject(new Error("Upload failed"));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error"));
    });

    xhr.send(formData);
  });
}

async function deletePhoto(id) {
  await apiJson(`/admin/images/${id}`, { method: "DELETE" });
}

async function updateImageAlbums(id, albumIds) {
  return apiJson(`/admin/images/${id}/albums`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ album_ids: albumIds })
  });
}

async function loadStorage() {
  if (!storageBox) {
    return;
  }

  try {
    const payload = await apiJson("/admin/storage");
    const used = Number(payload.usedBytes) || 0;
    const total = Number(payload.totalBytes) || 0;
    const free = Number(payload.freeBytes) || 0;
    const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;

    storageBox.innerHTML = `
      <div class="storage-row">
        <span>Storage used</span>
        <span>${formatGB(used)} / ${formatGB(total)}</span>
      </div>
      <div class="storage-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent.toFixed(1)}">
        <div class="storage-meter-fill" style="width: ${percent.toFixed(1)}%"></div>
      </div>
      <small>Free space: ${formatGB(free)}</small>
    `;
    storageBox.classList.remove("hidden");
  } catch (error) {
    storageBox.classList.add("hidden");
    storageBox.textContent = "";
  }
}

async function loadAlbums() {
  const response = await fetch("/albums");
  albums = await response.json();
  albumById = new Map(albums.map((album) => [album.id, album]));
  renderUploadAlbums();
  renderAlbumList();
}

function renderUploadAlbums() {
  uploadAlbums.innerHTML = "";

  if (albums.length === 0) {
    uploadAlbums.innerHTML =
      '<div class="muted">No albums yet. Create one in the sidebar.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  albums.forEach((album) => {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "album-pill";
    pill.setAttribute("aria-pressed", "false");
    pill.textContent = album.name;

    const syncState = () => {
      const active = selectedUploadAlbums.has(album.id);
      pill.classList.toggle("active", active);
      pill.setAttribute("aria-pressed", String(active));
    };

    pill.addEventListener("click", () => {
      if (selectedUploadAlbums.has(album.id)) {
        selectedUploadAlbums.delete(album.id);
      } else {
        selectedUploadAlbums.add(album.id);
      }
      syncState();
    });

    syncState();
    fragment.appendChild(pill);
  });

  uploadAlbums.appendChild(fragment);
}

function renderAlbumList() {
  albumList.innerHTML = "";

  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = "album-item" + (currentFilter === null ? " active" : "");
  allButton.innerHTML = `<span>All Images</span><span class="album-count">${
    albumCounts.get("__all__") ?? 0
  }</span>`;
  allButton.addEventListener("click", () => {
    currentFilter = null;
    renderAlbumList();
    loadGallery();
    switchView("library");
  });
  albumList.appendChild(allButton);

  albums.forEach((album) => {
    const item = document.createElement("div");
    item.className =
      "album-item" + (currentFilter === album.slug ? " active" : "");
    item.setAttribute("role", "button");
    item.tabIndex = 0;

    const label = document.createElement("span");
    label.className = "album-label";
    label.textContent = album.name;

    const count = document.createElement("span");
    count.className = "album-count";
    count.textContent = albumCounts.get(album.id) ?? 0;

    const actions = document.createElement("span");
    actions.className = "album-actions";

    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "album-action";
    renameButton.textContent = "Rename";
    renameButton.setAttribute("aria-label", `Rename ${album.name}`);
    renameButton.addEventListener("click", (event) => {
      event.stopPropagation();
      renameAlbum(album);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "album-action danger";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${album.name}`);
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteAlbum(album);
    });

    actions.append(renameButton, deleteButton);

    const openAlbum = () => {
      currentFilter = album.slug;
      renderAlbumList();
      loadGallery(album.slug);
      switchView("library");
    };

    item.addEventListener("click", openAlbum);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openAlbum();
      }
    });

    item.append(label, count, actions);
    albumList.appendChild(item);
  });
}

async function renameAlbum(album) {
  const name = window.prompt("Rename album", album.name);

  if (name == null || !name.trim()) {
    return;
  }

  try {
    const payload = await apiJson(`/admin/albums/${album.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() })
    });

    if (currentFilter === album.slug) {
      currentFilter = payload.album.slug;
    }

    await loadAlbums();
    if (currentFilter) {
      await loadGallery(currentFilter);
    }
  } catch (error) {
    albumStatus.textContent = error.message;
  }
}

async function deleteAlbum(album) {
  const count = albumCounts.get(album.id) ?? 0;

  if (!window.confirm(`Delete album "${album.name}"?`)) {
    return;
  }

  const deleteImages = window.confirm(
    `Delete the ${count} image(s) in this album too?\n\n` +
      `OK = delete the images as well\nCancel = keep the images (move to All Images)`
  );

  try {
    const query = deleteImages ? "?deleteImages=1" : "";
    await apiJson(`/admin/albums/${album.id}${query}`, { method: "DELETE" });

    if (currentFilter === album.slug) {
      currentFilter = null;
    }

    await loadAlbums();
    await refreshCounts();
    await loadGallery(currentFilter || undefined);
    await loadStorage();
  } catch (error) {
    albumStatus.textContent = error.message;
  }
}

async function refreshCounts() {
  const response = await fetch("/images", { cache: "no-store" });
  const images = await response.json();
  albumCounts = new Map();

  if (Array.isArray(images)) {
    albumCounts.set("__all__", images.length);
    images.forEach((image) => {
      (image.albums || []).forEach((albumId) => {
        albumCounts.set(albumId, (albumCounts.get(albumId) || 0) + 1);
      });
    });
  }

  renderAlbumList();
}

function renderGallery(images) {
  adminGallery.innerHTML = "";
  libraryImages = Array.isArray(images) ? images : [];
  selectedIds = new Set();

  if (libraryImages.length === 0) {
    adminGallery.innerHTML =
      '<div class="empty-state"><p>No images in this view.</p><span>Upload photos to get started.</span></div>';
    updateSelectionUI();
    return;
  }

  const fragment = document.createDocumentFragment();

  libraryImages.forEach((image) => {
    const card = document.createElement("div");
    card.className = "admin-card";
    card.dataset.id = image.id;
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.setAttribute("aria-label", "Edit albums");

    const thumb = document.createElement("img");
    thumb.className = "admin-thumb";
    thumb.src = image.thumb;
    thumb.alt = "";
    thumb.loading = "lazy";
    thumb.decoding = "async";

    const select = document.createElement("button");
    select.type = "button";
    select.className = "admin-select";
    select.setAttribute("aria-label", "Select photo");
    select.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>';
    select.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSelect(image.id);
    });

    const overlay = document.createElement("div");
    overlay.className = "admin-card-overlay";

    const chips = document.createElement("div");
    chips.className = "admin-chips";
    const imageAlbums = image.albums || [];

    if (imageAlbums.length === 0) {
      chips.innerHTML = '<span class="chip-none">No album</span>';
    } else {
      imageAlbums.forEach((albumId) => {
        const album = albumById.get(albumId);
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = album ? album.name : albumId;
        chips.appendChild(chip);
      });
    }

    overlay.appendChild(chips);

    const openEdit = () => openEditModal(image);
    card.addEventListener("click", (event) => {
      if (event.target.closest(".admin-select")) {
        return;
      }
      openEdit();
    });
    card.addEventListener("keydown", (event) => {
      if (event.target.closest(".admin-select")) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openEdit();
      }
    });

    card.append(select, thumb, overlay);
    fragment.appendChild(card);
  });

  adminGallery.appendChild(fragment);
  updateSelectionUI();
}

function syncCardSelection(card) {
  const active = selectedIds.has(card.dataset.id);
  card.classList.toggle("selected", active);
  const select = card.querySelector(".admin-select");
  if (select) {
    select.classList.toggle("checked", active);
    select.setAttribute("aria-pressed", String(active));
  }
}

function updateSelectionUI() {
  const count = selectedIds.size;
  const total = libraryImages.length;

  selectionCount.textContent = `${count} selected`;
  selectionBar.classList.toggle("hidden", count === 0);
  selectAllButton.classList.toggle("hidden", total === 0);

  if (count > 0 && count === total) {
    selectAllButton.textContent = "Deselect all";
  } else {
    selectAllButton.textContent = "Select all";
  }
}

function toggleSelect(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }

  const card = adminGallery.querySelector(`.admin-card[data-id="${id}"]`);
  if (card) {
    syncCardSelection(card);
  }
  updateSelectionUI();
}

function selectAll() {
  if (selectedIds.size === libraryImages.length && libraryImages.length > 0) {
    selectedIds = new Set();
  } else {
    selectedIds = new Set(libraryImages.map((image) => image.id));
  }

  adminGallery.querySelectorAll(".admin-card").forEach(syncCardSelection);
  updateSelectionUI();
}

function clearSelection() {
  selectedIds = new Set();
  adminGallery.querySelectorAll(".admin-card").forEach(syncCardSelection);
  updateSelectionUI();
}

function setSelectionBusy(busy) {
  selectionDelete.disabled = busy;
  selectionClear.disabled = busy;
  selectAllButton.disabled = busy;
  selectionDelete.textContent = busy ? "Deleting..." : "Delete";
}

async function deleteSelected() {
  const ids = Array.from(selectedIds);
  if (ids.length === 0) {
    return;
  }

  if (
    !window.confirm(`Delete ${ids.length} photo${ids.length === 1 ? "" : "s"}?`)
  ) {
    return;
  }

  setSelectionBusy(true);
  let deleted = 0;
  const failures = [];

  for (let i = 0; i < ids.length; i += 1) {
    selectionCount.textContent = `Deleting ${i + 1}/${ids.length}...`;
    try {
      await deletePhoto(ids[i]);
      deleted += 1;
    } catch (error) {
      failures.push(error.message);
    }
  }

  setSelectionBusy(false);
  selectedIds = new Set();

  await loadGallery(currentFilter || undefined);
  await refreshCounts();
  await loadStorage();

  if (failures.length) {
    uploadStatus.textContent = `${deleted} deleted, ${failures.length} failed.`;
  }
}

async function loadGallery(albumSlug) {
  const query = albumSlug ? `?album=${encodeURIComponent(albumSlug)}` : "";
  const response = await fetch(`/images${query}`, { cache: "no-store" });
  const images = await response.json();

  if (albumSlug) {
    const album = albums.find((entry) => entry.slug === albumSlug);
    libraryTitle.textContent = album ? album.name : "Library";
  } else {
    libraryTitle.textContent = "Library";
  }

  renderGallery(images);
}

function openEditModal(image) {
  editingImage = image;
  editThumb.src = image.thumb;
  editFilename.textContent = image.filename || image.id;
  editingSelected = new Set(image.albums || []);
  renderEditAlbums();
  editModal.classList.remove("hidden");
}

function closeEditModal() {
  editingImage = null;
  editingSelected = new Set();
  editModal.classList.add("hidden");
}

function renderEditAlbums() {
  editAlbums.innerHTML = "";

  if (albums.length === 0) {
    editAlbums.innerHTML =
      '<div class="muted">No albums yet. Create one in the sidebar.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  albums.forEach((album) => {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "album-pill";
    pill.setAttribute("aria-pressed", "false");
    pill.textContent = album.name;

    const syncState = () => {
      const active = editingSelected.has(album.id);
      pill.classList.toggle("active", active);
      pill.setAttribute("aria-pressed", String(active));
    };

    pill.addEventListener("click", () => {
      if (editingSelected.has(album.id)) {
        editingSelected.delete(album.id);
      } else {
        editingSelected.add(album.id);
      }
      syncState();
    });

    syncState();
    fragment.appendChild(pill);
  });

  editAlbums.appendChild(fragment);
}

function setProgress(value) {
  const percent = Math.max(0, Math.min(100, value * 100));
  progressBar.style.width = `${percent.toFixed(1)}%`;
}

function resetUploadProgress() {
  setProgress(0);
  uploadStatus.textContent = "";
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function addFiles(fileList) {
  const incoming = Array.from(fileList || []).filter((file) => {
    const duplicate = selectedFiles.some(
      (existing) => existing.name === file.name && existing.size === file.size
    );
    return !duplicate;
  });

  if (incoming.length) {
    selectedFiles = selectedFiles.concat(incoming);
    renderPreviewQueue();
  }
}

function renderPreviewQueue() {
  previewQueue.querySelectorAll(".preview-thumb").forEach((img) => {
    if (img.src && img.src.startsWith("blob:")) {
      URL.revokeObjectURL(img.src);
    }
  });
  previewQueue.innerHTML = "";

  if (selectedFiles.length === 0) {
    previewQueue.classList.add("hidden");
    return;
  }

  previewQueue.classList.remove("hidden");

  const fragment = document.createDocumentFragment();

  selectedFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "preview-item";

    const thumb = document.createElement("img");
    thumb.className = "preview-thumb";
    thumb.alt = "";
    if (file.type && file.type.startsWith("image/")) {
      thumb.src = URL.createObjectURL(file);
    }

    const meta = document.createElement("div");
    meta.className = "preview-meta";

    const name = document.createElement("span");
    name.className = "preview-name";
    name.textContent = file.name;

    const size = document.createElement("span");
    size.className = "preview-size";
    size.textContent = formatFileSize(file.size);

    meta.append(name, size);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "preview-remove";
    remove.textContent = "\u00d7";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.addEventListener("click", () => {
      selectedFiles.splice(index, 1);
      renderPreviewQueue();
    });

    item.append(thumb, meta, remove);
    fragment.appendChild(item);
  });

  previewQueue.appendChild(fragment);
}

function clearSelectedFiles() {
  selectedFiles = [];
  renderPreviewQueue();
  if (fileInput) {
    fileInput.value = "";
  }
}

dropzone.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

["dragenter", "dragover"].forEach((type) => {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((type) => {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (event) => {
  addFiles(event.dataTransfer && event.dataTransfer.files);
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "";

  const formData = new FormData(loginForm);
  const username = formData.get("username");
  const password = formData.get("password");

  try {
    await login(username, password);
    await showDashboard();
  } catch (error) {
    loginStatus.textContent = error.message;
  }
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  uploadStatus.textContent = "Preparing upload...";
  setProgress(0);

  try {
    const files = selectedFiles.slice();

    if (files.length === 0) {
      uploadStatus.textContent = "Select at least one file.";
      return;
    }

    const albumIds = Array.from(selectedUploadAlbums);
    let completed = 0;

    for (const file of files) {
      uploadStatus.textContent = `Uploading ${completed + 1}/${files.length}...`;
      await uploadSingle(file, albumIds, (currentProgress) => {
        const overall = (completed + currentProgress) / files.length;
        setProgress(overall);
      });
      completed += 1;
      setProgress(completed / files.length);
      uploadStatus.textContent = `Processing ${completed}/${files.length}...`;
    }

    uploadStatus.textContent = "Upload complete.";
    clearSelectedFiles();
    await loadGallery(currentFilter || undefined);
    await refreshCounts();
    await loadStorage();
  } catch (error) {
    uploadStatus.textContent = error.message;
  }
});

albumForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  albumStatus.textContent = "";

  const formData = new FormData(albumForm);
  const name = String(formData.get("name") || "").trim();

  if (!name) {
    return;
  }

  try {
    await apiJson("/admin/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    albumForm.reset();
    albumStatus.textContent = "";
    await loadAlbums();
  } catch (error) {
    albumStatus.textContent = error.message;
  }
});

editSave.addEventListener("click", async () => {
  if (!editingImage) {
    return;
  }

  const checked = Array.from(editingSelected);

  try {
    await updateImageAlbums(editingImage.id, checked);
    closeEditModal();
    await loadGallery(currentFilter || undefined);
    await refreshCounts();
  } catch (error) {
    uploadStatus.textContent = error.message;
  }
});

editCancel.addEventListener("click", closeEditModal);

editModal.addEventListener("click", (event) => {
  if (event.target.dataset.close !== undefined) {
    closeEditModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !editModal.classList.contains("hidden")) {
    closeEditModal();
  }
});

logoutButton.addEventListener("click", async () => {
  await fetch("/admin/logout", { method: "POST", credentials: "include" });
  dashboard.classList.add("hidden");
  loginView.classList.remove("hidden");
  loginForm.reset();
  resetUploadProgress();
  clearSelectedFiles();
  selectedUploadAlbums.clear();
  currentFilter = null;
  editingImage = null;
  editingSelected = new Set();
  selectedIds = new Set();
  libraryImages = [];
});

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    switchView(item.dataset.view);
  });
});

selectAllButton.addEventListener("click", selectAll);
selectionClear.addEventListener("click", clearSelection);
selectionDelete.addEventListener("click", deleteSelected);

async function showDashboard() {
  loginView.classList.add("hidden");
  dashboard.classList.remove("hidden");
  resetUploadProgress();
  await loadAlbums();
  await refreshCounts();
  await loadGallery(currentFilter || undefined);
  await loadStorage();
  switchView("upload");
}

checkSession()
  .then((isAdmin) => {
    if (isAdmin) {
      showDashboard().catch(() => {
        void 0;
      });
    }
  })
  .catch(() => {
    void 0;
  });
