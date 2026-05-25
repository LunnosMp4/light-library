const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const loginPanel = document.getElementById("login-panel");
const uploadPanel = document.getElementById("upload-panel");
const uploadForm = document.getElementById("upload-form");
const uploadStatus = document.getElementById("upload-status");
const logoutButton = document.getElementById("logout");
const progressBar = document.getElementById("progress-bar");
const galleryPanel = document.getElementById("gallery-panel");
const adminGallery = document.getElementById("admin-gallery");

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

function uploadSingle(file, progressCallback) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("photo", file, file.name);

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
  const response = await fetch(`/admin/images/${id}`, {
    method: "DELETE",
    credentials: "include"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Delete failed");
  }
}

function renderGallery(images) {
  adminGallery.innerHTML = "";

  if (!Array.isArray(images) || images.length === 0) {
    galleryPanel.classList.add("hidden");
    return;
  }

  galleryPanel.classList.remove("hidden");

  images.forEach((image) => {
    const card = document.createElement("div");
    card.className = "admin-card";

    const thumb = document.createElement("img");
    thumb.className = "admin-thumb";
    thumb.src = image.thumb;
    thumb.alt = "";

    const meta = document.createElement("div");
    meta.className = "admin-meta";
    meta.textContent = image.filename || image.id;

    const button = document.createElement("button");
    button.className = "ghost danger";
    button.type = "button";
    button.textContent = "x";
    button.setAttribute("aria-label", "Delete photo");
    button.addEventListener("click", async () => {
      try {
        await deletePhoto(image.id);
        await loadGallery();
      } catch (error) {
        uploadStatus.textContent = error.message;
      }
    });

    card.append(thumb, meta, button);
    adminGallery.appendChild(card);
  });
}

async function loadGallery() {
  const response = await fetch("/images", { cache: "no-store" });
  const images = await response.json();
  renderGallery(images);
}

function setProgress(value) {
  const percent = Math.max(0, Math.min(100, value * 100));
  progressBar.style.width = `${percent.toFixed(1)}%`;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "";

  const formData = new FormData(loginForm);
  const username = formData.get("username");
  const password = formData.get("password");

  try {
    await login(username, password);
    loginPanel.classList.add("hidden");
    uploadPanel.classList.remove("hidden");
    uploadStatus.textContent = "";
    setProgress(0);
    await loadGallery();
  } catch (error) {
    loginStatus.textContent = error.message;
  }
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  uploadStatus.textContent = "Preparing upload...";
  setProgress(0);

  try {
    const input = uploadForm.querySelector("input[type=\"file\"]");
    const files = Array.from(input.files || []);

    if (files.length === 0) {
      uploadStatus.textContent = "Select at least one file.";
      return;
    }

    let completed = 0;

    for (const file of files) {
      uploadStatus.textContent = `Uploading ${completed + 1}/${files.length}...`;
      await uploadSingle(file, (currentProgress) => {
        const overall = (completed + currentProgress) / files.length;
        setProgress(overall);
      });
      completed += 1;
      setProgress(completed / files.length);
      uploadStatus.textContent = `Processing ${completed}/${files.length}...`;
    }

    uploadStatus.textContent = "Upload complete.";
    uploadForm.reset();
    await loadGallery();
  } catch (error) {
    uploadStatus.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await fetch("/admin/logout", { method: "POST", credentials: "include" });
  uploadPanel.classList.add("hidden");
  loginPanel.classList.remove("hidden");
  galleryPanel.classList.add("hidden");
  loginForm.reset();
  uploadForm.reset();
  uploadStatus.textContent = "";
  setProgress(0);
});

checkSession()
  .then((isAdmin) => {
    if (isAdmin) {
      loginPanel.classList.add("hidden");
      uploadPanel.classList.remove("hidden");
      loadGallery().catch(() => {
        void 0;
      });
    }
  })
  .catch(() => {
    void 0;
  });
