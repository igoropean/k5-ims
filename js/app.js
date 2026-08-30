const API_URL =
  "https://script.google.com/macros/s/AKfycbwomiTJTWnJHU5cV29D-LcWmEMwwgF6fyevSgl5C5eSyfPZhYHpCO-5pZtnZC6Xm5i9/exec";

const state = {
  token: localStorage.getItem("k5_token") || "",
  user: JSON.parse(localStorage.getItem("k5_user") || "null"),
  transactionType: sessionStorage.getItem("k5_transaction_type") || "IR_ISSUE",
  items: JSON.parse(sessionStorage.getItem("k5_items") || "[]"),
  history: JSON.parse(localStorage.getItem("k5_history") || "[]"),
  scanner: null,
  scannerRunning: false,
  scannerStarting: false,
  scannerStopping: false,
  cameras: [],
  cameraIndex: 0,
  torchOn: false,
  qrProcessing: false,
  pendingStartTimer: null,
  startPromise: null,
  cameraReady: false,
  restartingCamera: false,
  watchdogInterval: null,
  watchdogLastTime: -1,
  watchdogStaleCount: 0,
  watchdogGreenCount: 0,
};

const $ = (id) => document.getElementById(id);

const scannerModalEl = $("scannerModal");
const scannerModal = new bootstrap.Modal(scannerModalEl, {
  backdrop: "static",
  keyboard: false,
});

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  updateTransactionUI();
  renderItems();

  const rememberedUser = localStorage.getItem("k5_remember_user");
  if (rememberedUser) $("username").value = rememberedUser;

  if (state.token && state.user) showScanner();
  else showLogin();
});

function bindEvents() {
  $("loginForm").addEventListener("submit", login);
  $("togglePassword").addEventListener("click", togglePassword);
  $("scanBtn").addEventListener("click", openScanner);
  $("closeScannerBtn").addEventListener("click", closeScanner);
  $("torchMainBtn").addEventListener("click", toggleTorch);
  $("submitBtn").addEventListener("click", reviewAndSubmit);
  $("clearAllBtn").addEventListener("click", clearAll);
  $("clearReference").addEventListener("click", clearReference);
  $("logoutBtn").addEventListener("click", logout);
  $("bottomLogoutBtn").addEventListener("click", logout);
  $("historyBtn").addEventListener("click", showHistory);
  $("referenceNumber").addEventListener("input", updateButtons);
  document.querySelectorAll("[data-transaction]").forEach((btn) => {
    btn.addEventListener("click", () =>
      changeTransactionType(btn.dataset.transaction),
    );
  });
}

function showLogin() {
  $("loginView").classList.add("active");
  $("scannerView").classList.remove("active");
}

function showScanner() {
  $("loginView").classList.remove("active");
  $("scannerView").classList.add("active");
  $("headerUser").textContent =
    state.user?.fullName || state.user?.username || "User";
  renderItems();
}

async function login(e) {
  e.preventDefault();
  const username = $("username").value.trim();
  const password = $("password").value;

  if (!username || !password) {
    Swal.fire({
      icon: "warning",
      title: "Login Required",
      text: "Please enter your username and password.",
    });
    return;
  }

  if (!isConfigured()) {
    Swal.fire({
      icon: "info",
      title: "API Not Configured",
      text: "Open js/app.js and paste your Google Apps Script Web App URL into API_URL first.",
    });
    return;
  }

  setLoading($("loginBtn"), true, "Signing in...");

  try {
    const result = await api("login", { username, password });
    if (!result.ok)
      throw new Error(result.message || "Invalid login credentials.");

    state.token = result.token;
    state.user = result.user;
    localStorage.setItem("k5_token", state.token);
    localStorage.setItem("k5_user", JSON.stringify(state.user));

    if ($("rememberMe").checked)
      localStorage.setItem("k5_remember_user", username);
    else localStorage.removeItem("k5_remember_user");

    showScanner();
    Swal.fire({
      icon: "success",
      title: "Welcome!",
      text: `Logged in as ${result.user.fullName || username}`,
      timer: 1200,
      showConfirmButton: false,
    });
  } catch (err) {
    Swal.fire({ icon: "error", title: "Login Failed", text: err.message });
  } finally {
    setLoading(
      $("loginBtn"),
      false,
      '<i class="bi bi-box-arrow-in-right me-2"></i>Login',
    );
  }
}

function togglePassword() {
  const input = $("password");
  const icon = $("togglePassword i");
  input.type = input.type === "password" ? "text" : "password";
  icon.className = input.type === "password" ? "bi bi-eye" : "bi bi-eye-slash";
}

function clearReference() {
  $("referenceNumber").value = "";
  updateButtons();
  $("referenceNumber").focus();
}

function getTransactionConfig() {
  const configs = {
    IR_ISSUE: {
      label: "IR Issue",
      referenceLabel: "IR Slip Number",
      placeholder: "Enter IR Slip Number",
      submitLabel: "Submit IR Issue",
      emptyText:
        "Enter the IR Slip number, then tap <strong>Scan QR Code</strong>.",
      icon: "bi-box-arrow-up",
    },
    IR_RETURN: {
      label: "IR Return",
      referenceLabel: "Return Slip Number",
      placeholder: "Enter Return Slip Number",
      submitLabel: "Submit IR Return",
      emptyText:
        "Enter the Return Slip number, then tap <strong>Scan QR Code</strong>.",
      icon: "bi-box-arrow-down",
    },
    GOODS_RECEIVED: {
      label: "Goods Received",
      referenceLabel: "GR / PO Number",
      placeholder: "Enter GR / PO Number",
      submitLabel: "Submit Goods Received",
      emptyText:
        "Enter the GR / PO number, then tap <strong>Scan QR Code</strong>.",
      icon: "bi-box-seam",
    },
  };
  return configs[state.transactionType] || configs.IR_ISSUE;
}

async function changeTransactionType(nextType) {
  if (nextType === state.transactionType) return;

  if (state.items.length) {
    const cfg = getTransactionConfig();
    const result = await Swal.fire({
      icon: "warning",
      title: "Change Transaction Type?",
      html: `You currently have <strong>${state.items.length}</strong> unsaved item(s) under <strong>${escapeHtml(cfg.label)}</strong>.<br><br>Changing the transaction type will clear these items.`,
      showCancelButton: true,
      confirmButtonText: "Change & Clear",
      cancelButtonText: "Keep Current",
    });
    if (!result.isConfirmed) return;

    state.items = [];
    saveItems();
  }

  state.transactionType = nextType;
  sessionStorage.setItem("k5_transaction_type", nextType);
  $("referenceNumber").value = "";
  updateTransactionUI();
  renderItems();
}

function updateTransactionUI() {
  const cfg = getTransactionConfig();

  document.querySelectorAll("[data-transaction]").forEach((btn) => {
    const active = btn.dataset.transaction === state.transactionType;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  $("referenceLabel").textContent = cfg.referenceLabel;
  $("referenceNumber").placeholder = cfg.placeholder;
  $("emptyStateText").innerHTML = cfg.emptyText;
  $("submitLabel").textContent = cfg.submitLabel;

  updateButtons();
}

function updateButtons() {
  const hasReference = $("referenceNumber").value.trim().length > 0;
  const hasItems = state.items.length > 0;
  $("submitBtn").disabled = !hasReference || !hasItems;
  $("clearAllBtn").disabled = !hasItems;
}

async function openScanner() {
  const cfg = getTransactionConfig();

  if (!$("referenceNumber").value.trim()) {
    await Swal.fire({
      icon: "warning",
      title: `${cfg.referenceLabel} Required`,
      text: `Please enter the ${cfg.referenceLabel} before starting to scan an item.`,
      confirmButtonText: "OK",
    });
    $("referenceNumber").focus();
    return;
  }

  if (!window.isSecureContext) {
    await Swal.fire({
      icon: "warning",
      title: "Secure Connection Required",
      html: `
        <p class="mb-2">Camera access from a phone requires <strong>HTTPS</strong>.</p>
        <p class="mb-0">Open the GitHub Pages HTTPS address to use the scanner.</p>
      `,
      confirmButtonText: "OK",
    });
    return;
  }

  scannerModal.show();
  showScannerStatus("Starting camera…");

  // Track this so closeScanner() can cancel it if the user closes the
  // modal before the camera has actually started (see closeScanner).
  state.pendingStartTimer = setTimeout(() => {
    state.pendingStartTimer = null;
    startScanner();
  }, 350);
}

function showScannerStatus(text) {
  const overlay = $("scannerStatusOverlay");
  if (!overlay) return;
  $("scannerStatusText").textContent = text;
  overlay.classList.add("active");
}

function hideScannerStatus() {
  $("scannerStatusOverlay")?.classList.remove("active");
}

/**
 * Downsamples the current video frame onto a tiny offscreen canvas and
 * checks whether it's overwhelmingly green — the visual signature of the
 * "green screen" camera corruption some Android devices produce. Used
 * both to hold the startup overlay a little longer if the very first
 * frames come in corrupted, and by the freeze watchdog to catch a feed
 * that's technically still advancing but visually broken.
 */
function sampleFrameIsGreenish(video) {
  try {
    const w = 12;
    const h = 12;

    if (!state.sampleCanvas) {
      state.sampleCanvas = document.createElement("canvas");
      state.sampleCanvas.width = w;
      state.sampleCanvas.height = h;
    }

    const ctx = state.sampleCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    ctx.drawImage(video, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    const n = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
    }

    const r = rSum / n;
    const g = gSum / n;
    const b = bSum / n;

    return g > 60 && g > r * 1.6 && g > b * 1.6;
  } catch (_) {
    return false;
  }
}

/**
 * Resolves once the injected <video> element inside #reader is actually
 * delivering real, non-corrupted frames, rather than just once
 * getUserMedia/start() has resolved. On many Android devices start()
 * resolves well before the stream is visually ready — or briefly hands
 * back a garbled greenish frame while the sensor settles — which is what
 * caused the scanner to flash black or green before this fix. Always
 * resolves within timeoutMs so a slow-to-warm-up camera never leaves the
 * status overlay stuck forever; the ongoing watchdog takes over from
 * there if the feed genuinely never recovers.
 */
function waitForCameraFrames(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    function check() {
      if (!state.scannerRunning) {
        resolve(false);
        return;
      }

      const video = document.querySelector("#reader video");
      const timedOut = Date.now() - startedAt > timeoutMs;

      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        if (timedOut || !sampleFrameIsGreenish(video)) {
          resolve(true);
          return;
        }
      } else if (timedOut) {
        resolve(true);
        return;
      }

      requestAnimationFrame(check);
    }

    check();
  });
}

function stopFreezeWatchdog() {
  if (state.watchdogInterval) {
    clearInterval(state.watchdogInterval);
    state.watchdogInterval = null;
  }
}

/**
 * Some Android camera stacks silently stop delivering new frames — or
 * start delivering a corrupted greenish frame — while the MediaStream
 * track itself still reports as "live"; html5-qrcode has no idea
 * anything is wrong. This periodically checks whether the video's
 * playback position is actually advancing, and samples its color, and
 * if either looks broken for a couple of checks in a row, silently
 * recovers rather than leaving the user stuck.
 */
function startFreezeWatchdog() {
  stopFreezeWatchdog();

  state.watchdogLastTime = -1;
  state.watchdogStaleCount = 0;
  state.watchdogGreenCount = 0;

  state.watchdogInterval = setInterval(() => {
    if (!state.scannerRunning || state.restartingCamera) return;
    if (document.visibilityState !== "visible") return;

    const video = document.querySelector("#reader video");
    if (!video) return;

    const t = video.currentTime;

    if (t === state.watchdogLastTime) {
      state.watchdogStaleCount += 1;
    } else {
      state.watchdogStaleCount = 0;
    }
    state.watchdogLastTime = t;

    if (sampleFrameIsGreenish(video)) {
      state.watchdogGreenCount += 1;
    } else {
      state.watchdogGreenCount = 0;
    }

    // No advancement across ~2 checks (roughly 5 seconds), or a
    // sustained green/corrupted frame across ~3 checks (roughly 7.5
    // seconds — deliberately a bit more patient, so briefly pointing the
    // camera at something genuinely green in the item doesn't trip it) —
    // treat it as a broken stream and recover.
    if (state.watchdogStaleCount >= 2 || state.watchdogGreenCount >= 3) {
      state.watchdogStaleCount = 0;
      state.watchdogGreenCount = 0;
      recoverFrozenCamera();
    }
  }, 2500);
}

async function recoverFrozenCamera() {
  if (state.restartingCamera || !scannerModalEl.classList.contains("show")) {
    return;
  }

  state.restartingCamera = true;
  stopFreezeWatchdog();
  showScannerStatus("Reconnecting camera…");

  try {
    if (state.scanner) {
      try {
        await state.scanner.stop();
      } catch (_) {}
      try {
        state.scanner.clear();
      } catch (_) {}
    }

    state.scanner = null;
    state.scannerRunning = false;
    state.cameraReady = false;

    // Cycle to the next candidate camera rather than restarting the exact
    // one that was just stuck/corrupted, and rather than falling back to
    // the "known good" camera saved in localStorage (which may well be
    // this same one, if it usually works fine but is glitching this
    // particular session). If nothing is enumerated yet, startScanner()
    // will fall back to its own resolution logic.
    let forcedId = null;
    if (state.cameras.length) {
      state.cameraIndex = (state.cameraIndex + 1) % state.cameras.length;
      forcedId = state.cameras[state.cameraIndex].id;
    }

    await startScanner(forcedId);
  } finally {
    state.restartingCamera = false;
  }
}

/**
 * Ranks enumerated cameras so the "best" rear/main lens sorts first.
 * Many modern phones expose several rear-facing camera entries (main,
 * ultra-wide, telephoto, macro, depth) — `facingMode: "environment"`
 * leaves the choice among these entirely up to the browser, and on some
 * devices that pick turns out to be an auxiliary lens with no autofocus
 * tuned for close-up barcode reading and no flash pairing, which is
 * consistent with green/frozen frames and a non-working flash all
 * clearing up together once a different (device-ID-selected) camera is
 * used. This label-based heuristic tries to land on the correct one
 * automatically instead of requiring a manual camera switcher.
 */
function rankCameras(cameras) {
  const score = (cam) => {
    const label = (cam.label || "").toLowerCase();
    let s = 0;
    if (/back|rear/.test(label)) s += 10;
    if (/front|user|selfie|facetime/.test(label)) s -= 20;
    if (/ultra.?wide|wide angle|0\.5x/.test(label)) s -= 6;
    if (/tele(photo)?|zoom/.test(label)) s -= 4;
    if (/macro/.test(label)) s -= 6;
    if (/depth|infrared|\bir\b/.test(label)) s -= 15;
    return s;
  };

  return cameras
    .map((cam, i) => ({ cam, i, s: score(cam) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.cam);
}

/**
 * Enumerates cameras exactly once per session — before the main stream
 * opens, never after (calling getCameras() again while a stream is
 * already live risks a second concurrent camera negotiation on the same
 * hardware, itself a plausible cause of the corrupted-frame symptoms).
 * Prefers whichever camera last actually decoded a QR code successfully
 * (remembered in localStorage), falling back to the label-ranked guess.
 */
async function resolveStartCamera() {
  let cameras = [];
  try {
    cameras = await Html5Qrcode.getCameras();
  } catch (_) {
    cameras = [];
  }

  state.cameras = rankCameras(cameras);

  if (!state.cameras.length) {
    state.cameraIndex = 0;
    return null;
  }

  const savedId = localStorage.getItem("k5_camera_id");
  let idx = 0;

  if (savedId) {
    const found = state.cameras.findIndex((c) => c.id === savedId);
    if (found !== -1) idx = found;
  }

  state.cameraIndex = idx;
  return state.cameras[idx].id;
}

async function startScanner(forcedCameraId) {
  // Prevent start/start race conditions.
  if (state.scannerRunning || state.scannerStarting) {
    return;
  }

  // The modal may have been closed while this call was queued (e.g. the
  // user tapped the X during the opening delay). Starting the camera now
  // would grab a media stream behind a hidden modal that never gets
  // released, which blocks every future scan attempt with a "camera busy"
  // error. Bail out instead.
  if (!scannerModalEl.classList.contains("show")) {
    return;
  }

  state.scannerStarting = true;
  showScannerStatus(
    state.restartingCamera ? "Reconnecting camera…" : "Starting camera…",
  );

  try {
    if (!window.isSecureContext) {
      throw new Error("Camera access requires HTTPS.");
    }

    if (!state.scanner) {
      state.scanner = new Html5Qrcode("reader");
    }

    // Make sure the reader container is clean before starting.
    const reader = document.getElementById("reader");

    if (!reader) {
      throw new Error("Scanner element was not found.");
    }

    // Resolve which physical camera to use *before* opening the stream.
    // A forced ID (passed in during automatic recovery) always wins;
    // otherwise resolve fresh via getCameras() (see resolveStartCamera).
    // If enumeration comes back empty for any reason, fall back to the
    // plain facingMode preference exactly as before.
    let cameraIdOrConfig = forcedCameraId || null;

    if (!cameraIdOrConfig) {
      cameraIdOrConfig = await resolveStartCamera();
    }

    if (!cameraIdOrConfig) {
      // html5-qrcode's own argument validation only accepts `facingMode`
      // as either a plain string ("environment") or an object with just
      // an `exact` key — it rejects any other shape, including the
      // standard MediaTrackConstraints `{ ideal: "environment" }` form,
      // with "'facingMode' should be string or object with exact as
      // key." The plain string form is what the library treats as a
      // soft preference: falls back to another camera instead of forcing
      // an exact (and possibly nonexistent) match.
      cameraIdOrConfig = { facingMode: "environment" };
    }

    // Keep a handle on this promise on `state` so any other function that
    // wants to stop/clear the scanner (closeScanner, stopScanner) can wait
    // for it to settle first instead of calling stop()/clear() while
    // html5-qrcode is still mid-transition from this start() call — doing
    // so is what throws "Cannot transition to a new state, already under
    // transition."
    //
    // No `aspectRatio` constraint here — forcing a non-native aspect
    // ratio (like a previous 1:1) makes some Android camera pipelines
    // hand back a corrupted/greenish frame. The video element is already
    // forced to fill and crop to a square via CSS (`object-fit: cover`),
    // so dropping this has no visual effect.
    state.startPromise = state.scanner.start(
      cameraIdOrConfig,
      {
        fps: 10,

        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const size = Math.floor(
            Math.min(viewfinderWidth, viewfinderHeight) * 0.7,
          );

          return {
            width: size,
            height: size,
          };
        },
      },

      // QR success
      onQrSuccess,

      // QR scan failure
      () => {},
    );

    await state.startPromise;

    // getUserMedia/start() resolving only means the camera negotiation
    // succeeded — on many Android devices the video element isn't
    // actually painting real (uncorrupted) frames yet at this point,
    // which is what produced the black/green-screen flash. Keep
    // state.cameraReady false and the status overlay up until frames are
    // confirmed. Camera enumeration already happened above, before the
    // stream opened — it is deliberately not repeated here.
    state.scannerRunning = true;
    state.cameraReady = false;

    await waitForCameraFrames();
    state.cameraReady = true;
    hideScannerStatus();
    startFreezeWatchdog();
  } catch (err) {
    console.error("Scanner start error:", err);

    state.scannerRunning = false;
    state.cameraReady = false;
    stopFreezeWatchdog();
    hideScannerStatus();

    // Don't show the error dialog (or leave the scanner instance in a
    // broken state) if the user already closed the modal — closeScanner()
    // is already awaiting this same promise and will handle cleanup.
    if (scannerModalEl.classList.contains("show")) {
      await Swal.fire({
        icon: "error",
        title: "Camera Error",
        text: friendlyCameraError(err),
        confirmButtonText: "OK",
      });
    }
  } finally {
    state.scannerStarting = false;
    state.startPromise = null;
  }
}

async function closeScanner() {
  // Cancel a still-pending "start the camera after the modal opens" call
  // so it can never fire once the user has already closed the modal.
  if (state.pendingStartTimer) {
    clearTimeout(state.pendingStartTimer);
    state.pendingStartTimer = null;
  }

  if (state.scannerStopping) {
    return;
  }

  state.scannerStopping = true;
  stopFreezeWatchdog();

  try {
    // If a start() call is still in flight (the user closed the modal
    // while the camera was still initializing), wait for it to settle
    // before doing anything else. Calling stop() or clear() while
    // html5-qrcode is still mid-transition from an in-progress start()
    // throws "Cannot transition to a new state, already under transition"
    // — and can leave that original start() promise (and the camera
    // stream it opened) dangling, breaking every future scan attempt.
    if (state.startPromise) {
      try {
        await state.startPromise;
      } catch (_) {
        // start() failed on its own — nothing further to tear down.
      }
    }

    if (state.scanner && state.scannerRunning) {
      await state.scanner.stop();
    }

    // Tear down the injected video/canvas elements so the #reader
    // container is clean for the next scan. Without this, reopening the
    // scanner can leave a stale/frozen video element in place and the
    // camera feed fails to (re)attach on many Android devices.
    if (state.scanner) {
      try {
        state.scanner.clear();
      } catch (_) {}
    }

    // Discard the Html5Qrcode instance entirely rather than reusing it for
    // the next scan session. html5-qrcode tracks its own internal
    // start/stop transition state on the instance, and reusing the same
    // instance across open→close→reopen cycles is what triggers "Cannot
    // transition to a new state, already under transition" the second (or
    // later) time the scanner is opened — even though stop()/clear() both
    // completed cleanly. A fresh instance next time guarantees there's no
    // stale internal state left over from this session.
    state.scanner = null;
    state.cameraIndex = 0;
  } catch (err) {
    console.warn("Camera stop:", err);
  } finally {
    state.scannerRunning = false;
    state.scannerStopping = false;
    state.cameraReady = false;
    hideScannerStatus();

    scannerModal.hide();
  }
}

async function stopScanner() {
  state.torchOn = false;
  stopFreezeWatchdog();
  state.cameraReady = false;

  // Same reasoning as in closeScanner(): never stop()/clear() while a
  // start() transition is still in flight.
  if (state.startPromise) {
    try {
      await state.startPromise;
    } catch (_) {}
  }

  if (state.scanner && state.scannerRunning) {
    try {
      await state.scanner.stop();
    } catch (_) {}
    try {
      state.scanner.clear();
    } catch (_) {}

    // Same reasoning as closeScanner(): always start the next scan session
    // (the next time the user taps "Scan QR Code") with a brand new
    // Html5Qrcode instance so no internal transition-state can leak
    // between sessions.
    state.scanner = null;
    state.cameraIndex = 0;
  }
  state.scannerRunning = false;
}

async function onQrSuccess(decodedText) {
  // Ignore any decode that fires before we've confirmed the camera is
  // actually delivering real frames (see waitForCameraFrames). This is a
  // safety net against decoding a stale/corrupted warm-up frame.
  if (!state.cameraReady) {
    return;
  }

  if (state.qrProcessing) {
    return;
  }

  state.qrProcessing = true;

  try {
    // A real, successful decode is the strongest possible signal that
    // the current camera is the right one — remember it so future
    // sessions on this device/browser start directly on it instead of
    // re-guessing via facingMode or label heuristics.
    const activeCamera = state.cameras[state.cameraIndex];
    if (activeCamera?.id) {
      try {
        localStorage.setItem("k5_camera_id", activeCamera.id);
      } catch (_) {}
    }

    await stopScanner();
    scannerModal.hide();

    const parsed = parseQrPayload(decodedText);
    if (!parsed) {
      await Swal.fire({
        icon: "error",
        title: "Invalid QR Code",
        text: "This QR code does not contain the expected 3-line item format.",
      });
      return;
    }

    const duplicate = state.items.some(
      (x) => x.inventoryId.toLowerCase() === parsed.inventoryId.toLowerCase(),
    );
    if (duplicate) {
      await Swal.fire({
        icon: "warning",
        title: "Duplicate Scan",
        text: `${parsed.inventoryId} is already in the current IR Slip. The duplicate scan was rejected.`,
      });
      return;
    }

    state.items.push({ ...parsed, quantity: "", remarks: "" });
    saveItems();
    renderItems();

    const card = document.querySelector(
      `[data-item-id="${cssEscape(parsed.inventoryId)}"]`,
    );
    card?.scrollIntoView({ behavior: "smooth", block: "center" });

    setTimeout(() => {
      card?.querySelector(".qty-input")?.focus();
    }, 350);

    if (navigator.vibrate) navigator.vibrate([80, 50, 80]);
    
  } finally {
    state.qrProcessing = false;
  }
}

function parseQrPayload(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length < 3) return null;

  return {
    inventoryId: lines[0],
    description: lines[1],
    unit: lines[2],
  };
}

function renderItems() {
  const list = $("itemsList");
  const empty = $("emptyState");

  [...list.querySelectorAll(".item-card")].forEach((el) => el.remove());

  if (!state.items.length) {
    empty.style.display = "";
  } else {
    empty.style.display = "none";

    state.items.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "item-card";
      card.dataset.itemId = item.inventoryId;
      card.innerHTML = `
        <div class="item-top">
          <div class="flex-grow-1">
            <div class="item-id">ID: ${escapeHtml(item.inventoryId)}</div>
            <div class="item-description">${escapeHtml(item.description)}</div>
            <div class="item-unit">Unit: ${escapeHtml(item.unit)}</div>
          </div>
          <button class="remove-item" type="button" title="Remove item" data-remove="${index}">×</button>
        </div>
        <div class="qty-row">
          <span class="qty-label">Quantity</span>
          <div class="qty-wrap">
            <input class="qty-input" type="number" min="0.01" max="999999999" step="0.01"
              inputmode="decimal" placeholder="0.00" value="${escapeAttr(item.quantity)}"
              data-qty="${index}" aria-label="Quantity for ${escapeAttr(item.description)}">
            <span class="qty-unit">${escapeHtml(item.unit)}</span>
          </div>
        </div>
        <div class="remarks-row">
          <span class="qty-label">Remarks</span>
          <div class="remarks-wrap">
            <textarea class="remarks-input" rows="2" maxlength="500"
              placeholder="Optional notes..."
              data-remarks="${index}"
              aria-label="Remarks for ${escapeAttr(item.description)}">${escapeHtml(item.remarks || "")}</textarea>
          </div>
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () =>
        removeItem(Number(btn.dataset.remove)),
      );
    });
    list.querySelectorAll("[data-qty]").forEach((input) => {
      input.addEventListener("input", () => {
        const i = Number(input.dataset.qty);
        input.value = normalizeQtyInput(input.value);
        state.items[i].quantity = input.value;
        saveItems();
        updateSummary();
      });
    });
    list.querySelectorAll("[data-remarks]").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        const i = Number(textarea.dataset.remarks);
        state.items[i].remarks = textarea.value;
        saveItems();
      });
    });
  }

  updateSummary();
  updateButtons();
}

function normalizeQtyInput(value) {
  let v = String(value).replace(/[^\d.]/g, "");
  const firstDot = v.indexOf(".");
  if (firstDot !== -1) {
    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
    const decimals = v.split(".")[1] || "";
    v = v.split(".")[0] + "." + decimals.slice(0, 2);
  }
  if (v.length > 1 && v.startsWith("0") && !v.startsWith("0."))
    v = v.replace(/^0+/, "");
  return v;
}

function removeItem(index) {
  const item = state.items[index];
  Swal.fire({
    icon: "question",
    title: "Remove Item?",
    text: item.description,
    showCancelButton: true,
    confirmButtonText: "Remove",
    cancelButtonText: "Keep",
  }).then((result) => {
    if (result.isConfirmed) {
      state.items.splice(index, 1);
      saveItems();
      renderItems();
    }
  });
}

function clearAll() {
  Swal.fire({
    icon: "warning",
    title: "Clear All Items?",
    text: "All scanned items for this IR Slip will be removed from this device.",
    showCancelButton: true,
    confirmButtonText: "Clear All",
  }).then((result) => {
    if (result.isConfirmed) {
      state.items = [];
      saveItems();
      renderItems();
    }
  });
}

function updateSummary() {
  $("itemCount").textContent = state.items.length;
  $("totalItems").textContent = state.items.length;

  const total = state.items.reduce(
    (sum, x) => sum + (parseFloat(x.quantity) || 0),
    0,
  );
  $("totalQty").textContent = total.toFixed(2);
}

async function reviewAndSubmit() {
  const referenceNumber = $("referenceNumber").value.trim();
  const cfg = getTransactionConfig();

  if (!referenceNumber) {
    Swal.fire({
      icon: "warning",
      title: `${cfg.referenceLabel} Required`,
      text: `Enter the ${cfg.referenceLabel} first.`,
    });
    $("referenceNumber").focus();
    return;
  }

  const invalid = state.items.find((x) => {
    const n = Number(x.quantity);
    return (
      !x.quantity ||
      !Number.isFinite(n) ||
      n <= 0 ||
      !/^\d+(\.\d{1,2})?$/.test(String(x.quantity))
    );
  });

  if (invalid) {
    Swal.fire({
      icon: "warning",
      title: "Quantity Required",
      text: `Enter a valid quantity (up to 2 decimal places) for ${invalid.inventoryId}.`,
    });
    document
      .querySelector(
        `[data-item-id="${cssEscape(invalid.inventoryId)}"] .qty-input`,
      )
      ?.focus();
    return;
  }

  const totalQty = state.items.reduce((sum, x) => sum + Number(x.quantity), 0);

  const summaryHtml = `
    <div class="text-start">
      <div class="p-2 mb-2 rounded-3" style="background:#eef6ff">
        <div class="small text-muted">Transaction Type</div>
        <strong>${escapeHtml(cfg.label)}</strong>
      </div>
      <div class="p-2 mb-2 rounded-3" style="background:#eef6ff">
        <div class="small text-muted">${escapeHtml(cfg.referenceLabel)}</div>
        <strong>${escapeHtml(referenceNumber)}</strong>
      </div>
      ${state.items
        .map(
          (x, i) => `
        <div class="p-2 mb-2 rounded-3 border">
          <div class="small text-primary fw-bold">${i + 1}. ${escapeHtml(x.inventoryId)}</div>
          <div class="fw-bold">${escapeHtml(x.description)}</div>
          <div class="small text-muted">Unit: ${escapeHtml(x.unit)} · Qty: <strong>${Number(x.quantity).toFixed(2)}</strong></div>
          ${x.remarks ? `<div class="small text-muted mt-1">Remarks: ${escapeHtml(x.remarks)}</div>` : ""}
        </div>
      `,
        )
        .join("")}
      <div class="d-flex justify-content-between mt-2">
        <strong>Total Items</strong><strong>${state.items.length}</strong>
      </div>
      <div class="d-flex justify-content-between">
        <strong>Total Quantity</strong><strong>${totalQty.toFixed(2)}</strong>
      </div>
    </div>`;

  const result = await Swal.fire({
    icon: "info",
    title: "Review & Confirm",
    html: summaryHtml,
    showCancelButton: true,
    confirmButtonText: '<i class="bi bi-check-lg"></i> Confirm & Submit',
    cancelButtonText: "Cancel",
    width: 500,
  });

  if (!result.isConfirmed) return;

  await submitRecords(referenceNumber);
}

async function submitRecords(referenceNumber) {
  if (!state.token) {
    Swal.fire({
      icon: "error",
      title: "Session Expired",
      text: "Please log in again.",
    });
    logout(false);
    return;
  }

  const cfg = getTransactionConfig();
  setLoading($("submitBtn"), true, "Submitting...");

  try {
    const result = await api("submit", {
      token: state.token,
      transactionType: state.transactionType,
      referenceNumber,
      items: state.items.map((x) => ({
        inventoryId: x.inventoryId,
        description: x.description,
        unit: x.unit,
        quantity: Number(x.quantity),
        remarks: x.remarks || "",
      })),
    });

    if (!result.ok) throw new Error(result.message || "Submission failed.");

    state.history.unshift({
      transactionType: state.transactionType,
      transactionLabel: cfg.label,
      referenceNumber,
      submittedAt: new Date().toISOString(),
      itemCount: state.items.length,
      totalQty: state.items.reduce((sum, x) => sum + Number(x.quantity), 0),
    });
    state.history = state.history.slice(0, 20);
    localStorage.setItem("k5_history", JSON.stringify(state.history));

    state.items = [];
    saveItems();
    $("referenceNumber").value = "";
    renderItems();

    await Swal.fire({
      icon: "success",
      title: "Submitted Successfully",
      text: `${cfg.label} was written to Google Sheets.`,
      confirmButtonText: "New Transaction",
    });
  } catch (err) {
    if (/session|token|unauthorized/i.test(err.message)) {
      await Swal.fire({
        icon: "error",
        title: "Session Expired",
        text: "Please log in again.",
      });
      logout(false);
    } else {
      Swal.fire({
        icon: "error",
        title: "Submission Failed",
        text: err.message,
      });
    }
  } finally {
    setLoading(
      $("submitBtn"),
      false,
      `<i class="bi bi-send me-2"></i><span id="submitLabel">${getTransactionConfig().submitLabel}</span>`,
    );
  }
}

async function logout(confirm = true) {
  if (confirm) {
    const result = await Swal.fire({
      icon: "question",
      title: "Logout?",
      text: "Your current unsaved scanned items will remain in this browser session.",
      showCancelButton: true,
      confirmButtonText: "Logout",
    });
    if (!result.isConfirmed) return;
  }

  try {
    if (state.token && isConfigured())
      await api("logout", { token: state.token });
  } catch (_) {}

  localStorage.removeItem("k5_token");
  localStorage.removeItem("k5_user");
  state.token = "";
  state.user = null;
  showLogin();
}

function showHistory() {
  const container = $("historyList");
  if (!state.history.length) {
    container.innerHTML = `<div class="text-center text-muted py-4"><i class="bi bi-clock-history fs-2 d-block mb-2"></i>No local submission history.</div>`;
  } else {
    container.innerHTML = state.history
      .map(
        (x) => `
      <div class="history-row">
        <strong>${escapeHtml(x.transactionLabel || x.transactionType || "Transaction")}</strong>
        <span>${escapeHtml(x.referenceNumber || x.irSlip || "")}</span>
        <span>${new Date(x.submittedAt).toLocaleString()} · ${x.itemCount} item(s) · Qty ${Number(x.totalQty).toFixed(2)}</span>
      </div>
    `,
      )
      .join("");
  }
  new bootstrap.Modal($("historyModal")).show();
}

async function toggleTorch() {
  if (!state.scanner || !state.scannerRunning) return;

  const desired = !state.torchOn;

  try {
    // Check the running track's actual capabilities first rather than
    // just firing the constraint and hoping. Some browsers accept an
    // unsupported "advanced" constraint without ever throwing — silently
    // doing nothing — which is exactly what made this look like it
    // "wasn't working" with no visible error before this fix.
    let capabilities = {};
    try {
      capabilities = state.scanner.getRunningTrackCapabilities() || {};
    } catch (_) {
      capabilities = {};
    }

    if (!("torch" in capabilities)) {
      await Swal.fire({
        icon: "info",
        title: "Flash Unavailable",
        text: "This camera does not report flash/torch support.",
      });
      return;
    }

    await state.scanner.applyVideoConstraints({
      advanced: [{ torch: desired }],
    });

    // Verify the constraint actually took effect — some devices accept
    // it without error but don't actually toggle the hardware.
    let settings = {};
    try {
      settings = state.scanner.getRunningTrackSettings() || {};
    } catch (_) {
      settings = {};
    }

    if (settings.torch !== desired) {
      throw new Error("Torch constraint did not apply.");
    }

    state.torchOn = desired;
    $("torchMainBtn").innerHTML = state.torchOn
      ? '<i class="bi bi-lightning-fill"></i> Flash On'
      : '<i class="bi bi-lightning-charge"></i> Flash';
  } catch (_) {
    // Leave state.torchOn as it was — the toggle never actually took
    // effect, so don't let the app's idea of the flash state drift from
    // reality.
    await Swal.fire({
      icon: "info",
      title: "Flash Unavailable",
      text: "Your browser or camera does not support flash control.",
    });
  }
}

async function api(action, payload = {}) {
  if (!isConfigured())
    throw new Error("Google Apps Script API URL is not configured.");
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
  });

  if (!response.ok) throw new Error(`API request failed (${response.status}).`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(
      "The API returned an invalid response. Check your Apps Script deployment and URL.",
    );
  }
}

function isConfigured() {
  return API_URL && !API_URL.includes("PASTE_YOUR_GOOGLE_APPS_SCRIPT");
}

function saveItems() {
  sessionStorage.setItem("k5_items", JSON.stringify(state.items));
}

function setLoading(button, loading, html) {
  button.disabled = loading;
  button.innerHTML = loading
    ? `<span class="spinner-border spinner-border-sm me-2"></span>${html.replace(/<[^>]*>/g, "")}`
    : html;
}

function friendlyCameraError(err) {
  const msg = String(err?.message || err);

  if (!window.isSecureContext) {
    return "Camera access requires HTTPS. Please open the application through its HTTPS address, such as GitHub Pages.";
  }

  if (/permission|notallowed|denied/i.test(msg)) {
    return "Camera permission was denied. Please allow camera access for this site in your browser settings, then try again.";
  }

  if (/notfound|no camera|device/i.test(msg)) {
    return "No usable camera was found on this device.";
  }

  if (/in use|busy|notreadable/i.test(msg)) {
    return "The camera may already be in use by another application. Close other camera apps and try again.";
  }

  return msg || "Unable to start the camera.";
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c],
  );
}
function escapeAttr(value) {
  return escapeHtml(value);
}
function cssEscape(value) {
  return String(value).replace(/(["\\.#:[\],>+~*^$|=])/g, "\\$1");
}

window.addEventListener("beforeunload", () => {
  if (state.scannerRunning) stopScanner();
});
