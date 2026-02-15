/**
 * Signature Flow – main application script.
 * Handles: view switching (landing vs editor), SVG/photo upload, stroke animation (CSS keyframes),
 * export (SVG/MP4/GIF), photo trace, and UI controls. View switch: showLanding() / showEditor().
 * SVG loaded path: file or photo trace -> handleSvgText -> buildPreview() -> showEditor().
 * Clear path: logo click or clear -> clearPreview() -> showLanding().
 */
const fileInput = document.getElementById("svgFile");
const photoInput = document.getElementById("photoFile");
const svgFileName = document.getElementById("svgFileName");
const photoFileName = document.getElementById("photoFileName");
const photoStrokeWidthInput = document.getElementById("photoStrokeWidth");
const photoThresholdInput = document.getElementById("photoThreshold");
const photoInvertInput = document.getElementById("photoInvert");
const photoPathOmitInput = document.getElementById("photoPathOmit");
const photoSimplifyInput = document.getElementById("photoSimplify");
const photoDilationInput = document.getElementById("photoDilation");
const photoGapBridgeInput = document.getElementById("photoGapBridge");
const redoTraceButton = document.getElementById("redoTrace");
const photoTracePaneContent = document.getElementById("photoTraceSvgContent");
const photoTracePane = document.querySelector(".preview-pane--trace");
const openTraceModalButton = document.getElementById("openTraceModal");
const openTraceModalAltButton = document.getElementById("openTraceModalAlt");
const photoTraceModal = document.getElementById("photoTraceModal");
const closeTraceModalButton = document.getElementById("closeTraceModal");
const removePhotoTraceButton = document.getElementById("removePhotoTrace");
const viewLanding = document.getElementById("view-landing");
const viewEditor = document.getElementById("view-editor");
const uploadSvgPrimary = document.getElementById("uploadSvgPrimary");
const editorLogoLink = document.querySelector(".editor-logo-link");
const landingLogo = document.querySelector(".landing-logo");
/** Landing view container; used for loading overlay and visibility. No #previewEmpty in new layout. */
const previewEmpty = viewLanding;
const svgPreview = document.getElementById("svgPreview");
const previewShowcaseStage = document.getElementById("previewShowcaseStage");
const pathsList = document.getElementById("pathsList");
const particlesBg = document.getElementById("particles-bg");
const exportButton = document.getElementById("exportButton");
const exportModal = document.getElementById("exportModal");
const closeExportModalButton = document.getElementById("closeExportModal");
const exportButtonModal = document.getElementById("exportButtonModal");
const howItWorksModal = document.getElementById("howItWorksModal");
const openHowItWorksButton = document.getElementById("openHowItWorks");
const closeHowItWorksModalButton = document.getElementById("closeHowItWorksModal");
const exportFormatInput = document.getElementById("exportFormat");
const exportBackgroundInput = document.getElementById("exportBackground");
const exportStatus = document.getElementById("exportStatus");
const exportResolutionText = document.getElementById("exportResolutionText");
const toggleThemeButton = document.getElementById("toggleTheme");
const photoTraceBottomButton = document.getElementById("photoTraceBottomButton");
const appHeader = document.querySelector(".app-header");

const durationInput = document.getElementById("duration");
const easingInput = document.getElementById("easing");
// easingButtons removed - now using <select> dropdown
const directionInput = document.getElementById("direction");
const directionButtons = document.querySelectorAll(".direction-button");
const sequentialLoopInput = document.getElementById("sequentialLoop");
const loopDelayInput = document.getElementById("loopDelay");
const strokeScaleInput = document.getElementById("strokeScale");
const cornerBoostInput = document.getElementById("cornerBoost");
// Dynamic motion functionality removed
const fillRevealInput = document.getElementById("fillReveal");
const fpsInput = document.getElementById("fps");
const scaleInput = document.getElementById("scale");
const scaleButtons = document.querySelectorAll(".scale-button");

const CONFIG = {
  defaultDuration: 3.5,
  defaultLoopDelay: 0.8,
  defaultEasing: "ease-in-out",
  defaultStrokeScale: 1,
  defaultCornerBoost: 6,
};

const state = {
  baseSvgText: "",
  metadata: [],
  lastPhotoDataUrl: "",
  lastPhotoTraceSvg: "",
  originalColors: new Map(), // Store original fill colors by element index
};

function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

const previewShowcaseSources = ["example4.mp4", "example1.svg", "example3.svg", "example2.svg"];
let previewShowcaseIndex = 0;
let previewShowcaseTimer = null;
let previewShowcaseActive = false;
let previewShowcaseRunId = 0;
const previewShowcaseFadeMs = 1450;
const previewShowcaseGapMs = 280;
const previewShowcaseFallbackMs = 3200;
let userHasInteracted = false;

const geometrySelector = "path, line, polyline, polygon, circle, ellipse";
const fillStripSelector = "path, line, polyline, polygon, rect, circle, ellipse";
const ffmpegState = {
  instance: null,
  loadingPromise: null,
  scriptPromise: null,
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function ensureFfmpegScript() {
  if (window.FFmpegWASM && window.FFmpegWASM.FFmpeg) {
    return Promise.resolve();
  }

  if (!ffmpegState.scriptPromise) {
    ffmpegState.scriptPromise = (async () => {
      try {
        await loadScript(
          "vendor/ffmpeg.js"
        );
      } catch (error) {
        try {
          await loadScript(
            "https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js"
          );
        } catch (fallbackError) {
          await loadScript(
            "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js"
          );
        }
      }
    })();
  }

  return ffmpegState.scriptPromise;
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.classList.remove("dark", "light");
  document.body.classList.remove("dark", "light");
  document.documentElement.classList.add(isDark ? "dark" : "light");
  document.body.classList.add(isDark ? "dark" : "light");
  toggleThemeButton.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  localStorage.setItem("svg-stroke-theme", isDark ? "dark" : "light");
  
  // Reapply animation to update colors for new theme
  if (state.baseSvgText) {
    applyAnimation();
  }
}

function formatLength(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${value.toFixed(1)}px`;
}

function normalizeViewBox(svgElement) {
  if (svgElement.getAttribute("viewBox")) {
    return;
  }

  const width = parseFloat(svgElement.getAttribute("width"));
  const height = parseFloat(svgElement.getAttribute("height"));

  if (Number.isFinite(width) && Number.isFinite(height)) {
    svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
}

function stripSvgFills(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svgElement = doc.querySelector("svg");
  if (!svgElement) {
    return svgText;
  }
  
  // Store original colors before removing fills
  const geometryElements = Array.from(svgElement.querySelectorAll(geometrySelector));
  geometryElements.forEach((element, index) => {
    const fill = element.getAttribute("fill") || 
                 element.style.fill || 
                 window.getComputedStyle ? window.getComputedStyle(element).fill : null;
    if (fill && fill !== "none" && fill !== "transparent" && fill !== "") {
      state.originalColors.set(index, fill);
    }
  });
  
  const elements = Array.from(svgElement.querySelectorAll(fillStripSelector));
  elements.forEach((element) => {
    element.setAttribute("fill", "none");
    element.style.fill = "none";
    element.setAttribute("fill-opacity", "");
    element.style.fillOpacity = "";
  });
  return new XMLSerializer().serializeToString(svgElement);
}

function ensureSvgBackground(svgElement) {
  const existing = svgElement.querySelector("#stroke-anim-bg");
  if (existing) {
    existing.remove();
  }
}

// Helper functions to get colors based on theme
function getStrokeColor() {
  const isLight = document.body.classList.contains("light");
  return isLight ? "#1f2937" : "#f0f0f0";
}

function getFillColor(elementIndex) {
  const isLight = document.body.classList.contains("light");
  // Check if we have an original color stored for this element
  const originalColor = state.originalColors.get(elementIndex);
  if (originalColor && originalColor !== "none" && originalColor !== "") {
    return originalColor; // Preserve original color
  }
  // Otherwise use theme-appropriate color
  return isLight ? "#1f2937" : "#f0f0f0";
}

// Store original colors from SVG elements
function storeOriginalColors(svgElement) {
  state.originalColors.clear();
  const elements = Array.from(svgElement.querySelectorAll(geometrySelector));
  elements.forEach((element, index) => {
    const fill = element.getAttribute("fill") || 
                 element.style.fill || 
                 window.getComputedStyle(element).fill;
    if (fill && fill !== "none" && fill !== "transparent") {
      state.originalColors.set(index, fill);
    }
  });
}

function readSettings() {
  const sequentialLoop = sequentialLoopInput && sequentialLoopInput.value === "true";
  return {
    duration: getDurationFromSpeedSlider(),
    delay: 0, // Delay removed - only using "Delay before loop" now
    easing: easingInput.value,
    direction: directionInput.value || "normal",
    loop: sequentialLoop,
    sequentialLoop,
    naturalSpeed: sequentialLoop,
    loopDelay: Math.max(0, parseFloat(loopDelayInput.value) || 0),
    strokeScale: Math.max(0.1, parseFloat(strokeScaleInput.value) || 1),
    cornerBoost: Math.max(0, parseFloat(cornerBoostInput.value) || 0),
    fillReveal: fillRevealInput.value === "true",
  };
}

function getDurationFromSpeedSlider() {
  const max = parseFloat(durationInput.max) || 5;
  const value = parseFloat(durationInput.value);
  if (!Number.isFinite(value)) {
    return Math.max(0, max || 5);
  }

  // Slider goes from 0 (5s duration) to 5 (0s duration)
  // Higher slider value = faster = shorter duration
  const duration = max - value;
  return Math.max(0, duration);
}

function readMp4Settings() {
  return {
    fps: Math.max(1, parseInt(fpsInput.value, 10) || 30),
    scale: Math.max(0.1, parseFloat(scaleInput.value) || 1),
  };
}

function readExportBackground() {
  const v = exportBackgroundInput && exportBackgroundInput.value;
  return v === "black" || v === "white" || v === "transparent" ? v : "white";
}

function readPhotoTraceSettings() {
  return {
    strokeWidth: Math.max(0.5, parseFloat(photoStrokeWidthInput.value) || 2),
    threshold: Math.min(
      255,
      Math.max(0, parseInt(photoThresholdInput.value, 10) || 160)
    ),
    invert: photoInvertInput.checked,
    pathOmit: Math.max(0, parseFloat(photoPathOmitInput.value) || 0),
    simplify: Math.max(0, parseFloat(photoSimplifyInput.value) || 0),
    dilation: Math.max(0, parseInt(photoDilationInput.value, 10) || 0),
    gapBridge: Math.max(0, parseFloat(photoGapBridgeInput.value) || 0),
  };
}

function setStatus(message) {
  exportStatus.textContent = message || "";
}

// Loading state utilities
function showLoading(element, message = "") {
  if (!element) return;
  
  // Remove existing loading overlay if present
  hideLoading(element);
  
  const overlay = document.createElement("div");
  overlay.className = "loading-overlay";
  overlay.setAttribute("data-loading-overlay", "true");
  const messageEl = document.createElement("div");
  messageEl.className = "loading-message";
  messageEl.textContent = message || "Loading...";
  overlay.appendChild(messageEl);
  element.appendChild(overlay);
  
  // Force no box when showing "Analyzing photo.." on preview empty (inline overrides any CSS)
  const isAnalyzingOnPreview = element.id === "view-landing" && (message === "Analyzing photo.." || message === "Analyzing photo...");
  if (isAnalyzingOnPreview) {
    overlay.style.cssText = "background: transparent !important; box-shadow: none !important; border: none !important;";
    messageEl.style.cssText = "background: none !important; box-shadow: none !important; border: none !important; padding: 0 !important; margin: 0 !important;";
  }
  
  // Ensure parent has relative positioning
  const computedStyle = window.getComputedStyle(element);
  if (computedStyle.position === "static") {
    element.style.position = "relative";
  }
}

function hideLoading(element) {
  if (!element) return;
  const overlay = element.querySelector('[data-loading-overlay="true"]');
  if (overlay) {
    overlay.remove();
  }
}

function showSkeleton(element, type = "default") {
  if (!element) return;
  
  // Remove existing skeleton if present
  hideSkeleton(element);
  
  const skeleton = document.createElement("div");
  skeleton.className = `skeleton skeleton-${type}`;
  skeleton.setAttribute("data-skeleton", "true");
  
  // Store original content if not already stored
  if (!element.hasAttribute("data-original-content")) {
    element.setAttribute("data-original-content", element.innerHTML);
  }
  
  element.appendChild(skeleton);
}

function hideSkeleton(element) {
  if (!element) return;
  const skeleton = element.querySelector('[data-skeleton="true"]');
  if (skeleton) {
    skeleton.remove();
  }
}

function updateProgress(element, current, total) {
  if (!element) return;
  
  let progressBar = element.querySelector(".progress-bar");
  if (!progressBar) {
    progressBar = document.createElement("div");
    progressBar.className = "progress-bar";
    const progressFill = document.createElement("div");
    progressFill.className = "progress-bar-fill";
    progressBar.appendChild(progressFill);
    element.appendChild(progressBar);
  }
  
  const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const progressFill = progressBar.querySelector(".progress-bar-fill");
  if (progressFill) {
    progressFill.style.width = `${percentage}%`;
  }
  
  // Update text if progress text element exists
  let progressText = element.querySelector(".progress-text");
  if (!progressText) {
    progressText = document.createElement("div");
    progressText.className = "progress-text";
    element.appendChild(progressText);
  }
  progressText.textContent = `${current} / ${total}`;
}

function showButtonLoading(button) {
  if (!button) return;
  button.classList.add("loading-button");
  button.disabled = true;
}

function hideButtonLoading(button) {
  if (!button) return;
  button.classList.remove("loading-button");
  button.disabled = false;
}

function updateRangeValue(input) {
  const display = document.querySelector(`[data-value-for="${input.id}"]`);
  if (!display) {
    return;
  }
  const step = parseFloat(input.step);
  let value = parseFloat(input.value);
  if (!Number.isFinite(value)) {
    display.textContent = "";
    return;
  }

  if (input.id === "duration") {
    value = getDurationFromSpeedSlider();
  }
  
  // Append "s" for time-based inputs (duration, loopDelay)
  const timeInputs = ["duration", "loopDelay"];
  const suffix = timeInputs.includes(input.id) ? "s" : "";
  
  if (!Number.isFinite(step) || step >= 1) {
    display.textContent = `${Math.round(value)}${suffix}`;
    return;
  }
  const decimals = (input.step.split(".")[1] || "").length;
  display.textContent = value.toFixed(decimals) + suffix;
}

function updateRangeFill(input) {
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 100;
  const value = parseFloat(input.value) || 0;
  const percent = ((value - min) / (max - min)) * 100;
  input.style.setProperty("--range-percent", `${percent}%`);
}

function setPanelControlsDisabled(disabled) {
  const panel = document.querySelector(".panel.controls-bar");
  if (!panel) {
    console.warn("Panel controls-bar not found");
    return;
  }
  
  // Add/remove disabled class to panel for CSS targeting
  if (disabled) {
    panel.classList.add("is-disabled");
  } else {
    panel.classList.remove("is-disabled");
  }
  
  // Disable all inputs, selects, and buttons (including those without explicit type="button")
  const controls = panel.querySelectorAll(
    'input:not([type="hidden"]), select, button'
  );
  
  controls.forEach((el) => {
    // Don't disable the photo file button or input - users should be able to upload photos even without SVG
    if (el.id === "photoFile" || el.id === "photoFileButton") {
      // Explicitly ensure these are always enabled
      el.disabled = false;
      return;
    }
    
    el.disabled = disabled;
  });
  
  // Also explicitly enable photo file controls after disabling others (in case they weren't in the querySelector)
  const photoFileButton = document.getElementById("photoFileButton");
  const photoFileInput = document.getElementById("photoFile");
  if (photoFileButton) {
    photoFileButton.disabled = false;
  }
  if (photoFileInput) {
    photoFileInput.disabled = false;
  }
  
  console.log(`Panel controls ${disabled ? 'disabled' : 'enabled'}, found ${controls.length} controls`);
}

function showLanding() {
  if (viewEditor) {
    viewEditor.setAttribute("hidden", "");
    viewEditor.setAttribute("aria-hidden", "true");
  }
  if (viewLanding) {
    viewLanding.removeAttribute("hidden");
    viewLanding.setAttribute("aria-hidden", "false");
  }
}

function showEditor() {
  if (viewLanding) {
    viewLanding.setAttribute("hidden", "");
    viewLanding.setAttribute("aria-hidden", "true");
  }
  if (viewEditor) {
    viewEditor.removeAttribute("hidden");
    viewEditor.setAttribute("aria-hidden", "false");
  }
}

function clearPreview() {
  // Re-enable SVG file input and clear photo trace state so logo click → home allows uploading SVG again
  resetPhotoTrace();
  svgPreview.innerHTML = "";
  if (photoTracePaneContent) {
    photoTracePaneContent.innerHTML = "";
    photoTracePaneContent.classList.remove("is-visible");
  }
  showLanding();

  // Clear uploaded file state
  state.baseSvgText = "";
  state.metadata = [];

  exportButton.disabled = true;
  if (exportButtonModal) exportButtonModal.disabled = true;
  redoTraceButton.disabled = !state.lastPhotoDataUrl;
  uploadSvgButton.classList.add("hidden");
  if (photoTraceBottomButton) photoTraceBottomButton.classList.remove("hidden");
  if (sequentialLoopInput) {
    sequentialLoopInput.value = "true";
  }
  if (sequentialLoopButton) {
    sequentialLoopButton.classList.add("active");
    const toggleLabel = sequentialLoopButton.querySelector(".toggle-label");
    if (toggleLabel) {
      toggleLabel.textContent = "Enabled";
    }
  }
  startPreviewShowcase();
  if (fullscreenButton) fullscreenButton.classList.add("hidden");

  // Reset controls panel animation state
  const panel = document.querySelector(".panel.controls-bar");
  if (panel) {
    panel.classList.remove("animating-in");
  }
  setPanelControlsDisabled(true);
  setStatus("");
  if (particlesBg) particlesBg.classList.remove("hidden");
}

function updateFileLabel(input, labelElement) {
  if (!labelElement) {
    return;
  }
  const [file] = input.files || [];
  const fileName = file ? file.name : "No file chosen";
  labelElement.textContent = fileName;
  
  // Hide photoFileName when it shows "No file chosen"
  if (labelElement.id === "photoFileName") {
    if (fileName === "No file chosen") {
      labelElement.style.display = "none";
    } else {
      labelElement.style.display = "";
    }
  }
}

function renderPhotoTrace(svgText) {
  state.lastPhotoTraceSvg = svgText;
  const photoTraceSvgContent = document.getElementById("photoTraceSvgContent");
  const photoTraceControls = document.querySelector(".photo-trace-controls");
  
  if (svgText && photoTraceSvgContent) {
    photoTraceSvgContent.innerHTML = svgText;
    photoTraceSvgContent.classList.add("is-visible");
    
    // Show photo trace controls
    if (photoTraceControls) {
      photoTraceControls.classList.remove("hidden");
    }
    
    // Expand paths section to show photo trace controls
    const pathsList = document.getElementById('pathsList');
    const pathsSection = pathsList ? pathsList.closest('.collapsible-section') : null;
    if (pathsSection) {
      pathsSection.classList.add('expanded');
    }
  } else {
    if (photoTraceSvgContent) {
      photoTraceSvgContent.innerHTML = "";
      photoTraceSvgContent.classList.remove("is-visible");
    }
    
    // Hide photo trace controls
    if (photoTraceControls) {
      photoTraceControls.classList.add("hidden");
    }
  }
  updatePhotoTraceStatus(Boolean(svgText));
}

function updatePhotoTraceStatus(isActive) {
  if (removePhotoTraceButton) {
    removePhotoTraceButton.classList.toggle("hidden", !isActive);
  }

  fileInput.disabled = isActive;
  if (isActive) {
    svgFileName.textContent = "Photo trace active";
  }
}

function resetPhotoTrace() {
  state.lastPhotoTraceSvg = "";
  state.lastPhotoDataUrl = "";
  photoInput.value = "";
  updateFileLabel(photoInput, photoFileName);
  renderPhotoTrace("");
  redoTraceButton.disabled = true;
  fileInput.disabled = false;
  updateFileLabel(fileInput, svgFileName);
}

function runPhotoTrace(dataUrl) {
  if (!dataUrl) {
    setStatus("Upload a photo first.");
    return;
  }
  setStatus("Vectorizing photo...");
  
  // Show loading in photo trace section
  const photoTraceSection = document.querySelector(".photo-trace-section");
  if (photoTraceSection) {
    showLoading(photoTraceSection, "Vectorizing photo...");
  }
  
  // Show loading on landing view if it's still visible
  if (viewLanding && !viewLanding.hidden) {
    showLoading(viewLanding, "Analyzing photo..");
  }

  // Show skeleton for photo trace controls
  const photoTraceControls = document.querySelector(".photo-trace-controls");
  if (photoTraceControls) {
    showSkeleton(photoTraceControls, "default");
  }

  // Show skeleton in paths list only – do NOT show skeleton on svgPreview when
  // "Analyzing photo.." is on landing (it would show through as a dark box)
  const svgPreview = document.getElementById("svgPreview");
  if (svgPreview && (!viewLanding || viewLanding.hidden)) {
    showSkeleton(svgPreview, "preview");
  }
  if (pathsList) {
    showSkeleton(pathsList, "path-item");
    pathsList.innerHTML = "";
    // Add 3 skeleton items
    for (let i = 0; i < 3; i++) {
      const skeletonItem = document.createElement("div");
      skeletonItem.className = "skeleton-path-item";
      pathsList.appendChild(skeletonItem);
    }
  }
  
  const traceSettings = readPhotoTraceSettings();
  traceImageToSvg(dataUrl, traceSettings)
    .then((svgText) => {
      renderPhotoTrace(svgText);
      handleSvgText(svgText);
      setStatus("");
      
      // Hide loading states
      if (photoTraceSection) {
        hideLoading(photoTraceSection);
      }
      if (viewLanding) {
        hideLoading(viewLanding);
      }
      if (photoTraceControls) {
        hideSkeleton(photoTraceControls);
      }
      if (svgPreview) {
        hideSkeleton(svgPreview);
      }
      if (pathsList) {
        hideSkeleton(pathsList);
      }
      
      // Hide button loading if redoTraceButton was clicked
      if (redoTraceButton && redoTraceButton.classList.contains("loading-button")) {
        hideButtonLoading(redoTraceButton);
      }
    })
    .catch((error) => {
      setStatus(`Photo import failed: ${error.message}`);
      
      // Hide loading states on error
      if (photoTraceSection) {
        hideLoading(photoTraceSection);
      }
      if (viewLanding) {
        hideLoading(viewLanding);
      }
      if (photoTraceControls) {
        hideSkeleton(photoTraceControls);
      }
      if (svgPreview) {
        hideSkeleton(svgPreview);
      }
      if (pathsList) {
        hideSkeleton(pathsList);
      }
      
      // Hide button loading on error
      if (redoTraceButton && redoTraceButton.classList.contains("loading-button")) {
        hideButtonLoading(redoTraceButton);
      }
    });
}

const TRACE_BLACK = 0;
const TRACE_WHITE = 255;

function traceCoordsToIndex(coords, width, multiple = 4) {
  return coords.x * multiple + coords.y * width * multiple;
}

function traceIsBlack(value) {
  return value === TRACE_BLACK;
}

function traceIsWhite(value) {
  return value === TRACE_WHITE;
}

function traceImageToSvg(imageSource, settings) {
  return loadPhotoImageData(imageSource)
    .then((imgData) => applyThreshold(imgData, settings.threshold, settings.invert))
    .then((bwData) => {
      const binary = imageDataToBinary(bwData);
      const dilated = settings.dilation > 0
        ? dilateBinary(binary, bwData.width, bwData.height, settings.dilation)
        : binary;
      const skeleton = skeletonize(dilated, bwData.width, bwData.height);
      const rawPaths = extractSkeletonPaths(
        skeleton,
        bwData.width,
        bwData.height
      );
      const merged = settings.gapBridge > 0
        ? bridgeCloseEndpoints(rawPaths, settings.gapBridge)
        : rawPaths;
      const simplified = merged
        .map((path) => simplifyPath(path, clampSimplify(path, settings.simplify)))
        .filter((path) => path.length > 1)
        .filter((path) => {
          if (settings.pathOmit <= 0) {
            return true;
          }
          return pathLengthPoints(path) >= settings.pathOmit;
        });

      if (simplified.length === 0) {
        throw new Error("No stroke paths detected. Try adjusting the threshold.");
      }

      return buildCenterlineSvg(
        simplified,
        bwData.width,
        bwData.height,
        settings.strokeWidth
      );
    });
}

function loadPhotoImageData(imageSource) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas is not supported in this browser."));
        return;
      }
      context.drawImage(img, 0, 0);
      resolve(context.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error("Could not load photo."));
    img.src = imageSource;
  });
}

function applyThreshold(imgData, threshold, invert) {
  const output = new ImageData(imgData.width, imgData.height);
  const data = imgData.data;
  const out = output.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
    let isWhite = gray >= threshold;
    if (invert) {
      isWhite = !isWhite;
    }
    const value = isWhite ? TRACE_WHITE : TRACE_BLACK;
    out[i] = value;
    out[i + 1] = value;
    out[i + 2] = value;
    out[i + 3] = TRACE_WHITE;
  }
  return output;
}

function dilateBinary(binary, width, height, radius) {
  const output = new Uint8Array(binary);
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) {
    return output;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (binary[idx] !== 1) {
        continue;
      }
      for (let dy = -r; dy <= r; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          continue;
        }
        for (let dx = -r; dx <= r; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) {
            continue;
          }
          output[ny * width + nx] = 1;
        }
      }
    }
  }
  return output;
}

function imageDataToBinary(imgData) {
  const binary = new Uint8Array(imgData.width * imgData.height);
  for (let y = 0; y < imgData.height; y += 1) {
    for (let x = 0; x < imgData.width; x += 1) {
      const index = (y * imgData.width + x) * 4;
      binary[y * imgData.width + x] = imgData.data[index] === TRACE_BLACK ? 1 : 0;
    }
  }
  return binary;
}

function skeletonize(binary, width, height) {
  const output = new Uint8Array(binary);
  let changed = true;
  let iterations = 0;
  const maxIterations = 1000;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations += 1;
    let toRemove = [];

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = y * width + x;
        if (output[idx] !== 1) {
          continue;
        }
        const neighbors = getNeighbors(output, width, x, y);
        const B = neighbors.reduce((sum, n) => sum + n, 0);
        const A = countTransitions(neighbors);
        if (
          B >= 2 &&
          B <= 6 &&
          A === 1 &&
          neighbors[0] * neighbors[2] * neighbors[4] === 0 &&
          neighbors[2] * neighbors[4] * neighbors[6] === 0
        ) {
          toRemove.push(idx);
        }
      }
    }

    if (toRemove.length > 0) {
      toRemove.forEach((idx) => {
        output[idx] = 0;
      });
      changed = true;
    }

    toRemove = [];

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const idx = y * width + x;
        if (output[idx] !== 1) {
          continue;
        }
        const neighbors = getNeighbors(output, width, x, y);
        const B = neighbors.reduce((sum, n) => sum + n, 0);
        const A = countTransitions(neighbors);
        if (
          B >= 2 &&
          B <= 6 &&
          A === 1 &&
          neighbors[0] * neighbors[2] * neighbors[6] === 0 &&
          neighbors[0] * neighbors[4] * neighbors[6] === 0
        ) {
          toRemove.push(idx);
        }
      }
    }

    if (toRemove.length > 0) {
      toRemove.forEach((idx) => {
        output[idx] = 0;
      });
      changed = true;
    }
  }

  return output;
}

function getNeighbors(binary, width, x, y) {
  const idx = y * width + x;
  const w = width;
  return [
    binary[idx - w],
    binary[idx - w + 1],
    binary[idx + 1],
    binary[idx + w + 1],
    binary[idx + w],
    binary[idx + w - 1],
    binary[idx - 1],
    binary[idx - w - 1],
  ];
}

function countTransitions(neighbors) {
  let transitions = 0;
  for (let i = 0; i < neighbors.length; i += 1) {
    const curr = neighbors[i];
    const next = neighbors[(i + 1) % neighbors.length];
    if (curr === 0 && next === 1) {
      transitions += 1;
    }
  }
  return transitions;
}

function extractSkeletonPaths(binary, width, height) {
  const visited = new Uint8Array(binary.length);
  const paths = [];

  const neighborOffsets = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
  ];

  const getNeighborsCoords = (x, y) => {
    const coords = [];
    neighborOffsets.forEach(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        return;
      }
      const nIdx = ny * width + nx;
      if (binary[nIdx] === 1) {
        coords.push({ x: nx, y: ny, idx: nIdx });
      }
    });
    return coords;
  };

  const neighborCount = (x, y) => getNeighborsCoords(x, y).length;

  const traceFrom = (startX, startY) => {
    const path = [];
    let current = { x: startX, y: startY, idx: startY * width + startX };
    let prev = null;

    while (current) {
      visited[current.idx] = 1;
      path.push({ x: current.x, y: current.y });
      const neighbors = getNeighborsCoords(current.x, current.y)
        .filter((n) => !prev || n.idx !== prev.idx);
      const nextCandidates = neighbors.filter((n) => !visited[n.idx]);

      if (prev && neighborCount(current.x, current.y) > 2) {
        break;
      }

      const next = nextCandidates[0];
      if (!next) {
        break;
      }
      prev = current;
      current = next;
    }

    return path;
  };

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      if (binary[idx] !== 1 || visited[idx]) {
        continue;
      }
      const count = neighborCount(x, y);
      if (count === 1 || count >= 3) {
        const path = traceFrom(x, y);
        if (path.length > 1) {
          paths.push(path);
        }
      }
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      if (binary[idx] !== 1 || visited[idx]) {
        continue;
      }
      const path = traceFrom(x, y);
      if (path.length > 1) {
        paths.push(path);
      }
    }
  }

  return paths;
}

function simplifyPath(points, tolerance) {
  if (!points || points.length <= 2 || tolerance <= 0) {
    return points;
  }

  const sqTolerance = tolerance * tolerance;

  const simplifySection = (pts, start, end, keep) => {
    let maxDist = 0;
    let index = start;
    const startPt = pts[start];
    const endPt = pts[end];

    for (let i = start + 1; i < end; i += 1) {
      const dist = getSqSegDist(pts[i], startPt, endPt);
      if (dist > maxDist) {
        index = i;
        maxDist = dist;
      }
    }

    if (maxDist > sqTolerance) {
      keep[index] = true;
      simplifySection(pts, start, index, keep);
      simplifySection(pts, index, end, keep);
    }
  };

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  simplifySection(points, 0, points.length - 1, keep);

  return points.filter((_, index) => keep[index]);
}

function getSqSegDist(point, start, end) {
  let x = start.x;
  let y = start.y;
  let dx = end.x - x;
  let dy = end.y - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end.x;
      y = end.y;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = point.x - x;
  dy = point.y - y;
  return dx * dx + dy * dy;
}

function clampSimplify(points, tolerance) {
  if (!points || points.length < 2) {
    return 0;
  }
  const bounds = getBounds(points);
  const maxSpan = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const safeMax = Math.max(0.5, maxSpan * 0.02);
  return Math.min(Math.max(tolerance, 0), safeMax);
}

function getBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  return { minX, minY, maxX, maxY };
}

function bridgeCloseEndpoints(paths, maxGap) {
  if (!paths || paths.length < 2 || maxGap <= 0) {
    return paths;
  }

  const remaining = paths.map((path) => [...path]);
  const merged = [];

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  while (remaining.length) {
    let current = remaining.shift();
    let mergedSomething = true;

    while (mergedSomething) {
      mergedSomething = false;
      const last = current[current.length - 1];
      const first = current[0];

      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        const candFirst = candidate[0];
        const candLast = candidate[candidate.length - 1];

        if (distance(last, candFirst) <= maxGap) {
          current = current.concat(candidate);
          remaining.splice(i, 1);
          mergedSomething = true;
          break;
        }
        if (distance(last, candLast) <= maxGap) {
          current = current.concat(candidate.slice().reverse());
          remaining.splice(i, 1);
          mergedSomething = true;
          break;
        }
        if (distance(first, candLast) <= maxGap) {
          current = candidate.concat(current);
          remaining.splice(i, 1);
          mergedSomething = true;
          break;
        }
        if (distance(first, candFirst) <= maxGap) {
          current = candidate.slice().reverse().concat(current);
          remaining.splice(i, 1);
          mergedSomething = true;
          break;
        }
      }
    }

    merged.push(current);
  }

  return merged;
}

function TraceVertexFinder(imgData) {
  if (!imgData) {
    throw new Error("No image data passed.");
  }
  this.imgData = imgData;
  this.allVertices = [];
  this.vLength = 0;
}

TraceVertexFinder.prototype.addVertex = function addVertex(vertex) {
  const index = traceCoordsToIndex(vertex, this.imgData.width, 1);
  this.allVertices[index] = vertex;
  this.vLength += 1;
  return true;
};

TraceVertexFinder.prototype.findAllVertices = function findAllVertices() {
  for (let y = 0; y < this.imgData.height; y += 1) {
    for (let x = 0; x < this.imgData.width; x += 1) {
      const vertex = new TraceVertex(x, y);
      if (vertex.checkIfEdge(this.imgData)) {
        this.addVertex(vertex);
      }
    }
  }
};

function TraceVertex(x, y) {
  if (typeof x === "undefined" || typeof y === "undefined") {
    throw new Error("No x and y passed.");
  }
  this.x = x;
  this.y = y;
}

TraceVertex.prototype.neighborPixelCoords = function neighborPixelCoords(width, height) {
  const borders = this.checkIfBorder(width, height);
  return {
    nw: borders.top || borders.left ? TRACE_WHITE : { x: this.x - 1, y: this.y - 1 },
    ne: borders.top || borders.right ? TRACE_WHITE : { x: this.x, y: this.y - 1 },
    sw: borders.bottom || borders.left ? TRACE_WHITE : { x: this.x - 1, y: this.y },
    se: borders.bottom || borders.right ? TRACE_WHITE : { x: this.x, y: this.y },
  };
};

TraceVertex.prototype.neighborVertexCoords = function neighborVertexCoords(width, height) {
  const borders = this.checkIfBorder(width, height);
  return {
    n: borders.top ? null : { x: this.x, y: this.y - 1 },
    s: borders.bottom ? null : { x: this.x, y: this.y + 1 },
    e: borders.right ? null : { x: this.x + 1, y: this.y },
    w: borders.left ? null : { x: this.x - 1, y: this.y },
  };
};

TraceVertex.prototype.getNextVertex = function getNextVertex(imgData) {
  const neighborP = this.neighborPixelCoords(imgData.width, imgData.height);
  const neighborV = this.neighborVertexCoords(imgData.width, imgData.height);
  let nextVertex;

  if (this.isVertex(neighborP.nw, neighborP.ne, imgData)) {
    nextVertex = new TraceVertex(neighborV.n.x, neighborV.n.y);
  } else if (this.isVertex(neighborP.ne, neighborP.se, imgData)) {
    nextVertex = new TraceVertex(neighborV.e.x, neighborV.e.y);
  } else if (this.isVertex(neighborP.se, neighborP.sw, imgData)) {
    nextVertex = new TraceVertex(neighborV.s.x, neighborV.s.y);
  } else if (this.isVertex(neighborP.sw, neighborP.nw, imgData)) {
    nextVertex = new TraceVertex(neighborV.w.x, neighborV.w.y);
  }

  return nextVertex;
};

TraceVertex.prototype.isVertex = function isVertex(np1, np2, imgData) {
  const pixel1 =
    typeof np1 === "number"
      ? np1
      : imgData.data[traceCoordsToIndex(np1, imgData.width)];
  const pixel2 =
    typeof np2 === "number"
      ? np2
      : imgData.data[traceCoordsToIndex(np2, imgData.width)];
  return Boolean(np1 && np2 && traceIsBlack(pixel1) && traceIsWhite(pixel2));
};

TraceVertex.prototype.checkIfBorder = function checkIfBorder(width, height) {
  return {
    top: traceIsBlack(this.y),
    bottom: this.y === height,
    left: traceIsBlack(this.x),
    right: this.x === width,
  };
};

TraceVertex.prototype.checkIfEdge = function checkIfEdge(imgData) {
  const neighbors = this.neighborPixelCoords(imgData.width, imgData.height);
  const neighborVals = Object.keys(neighbors).map((key) => neighbors[key]);
  for (let i = 0; i < neighborVals.length; i += 1) {
    const currVal =
      typeof neighborVals[i] === "number"
        ? neighborVals[i]
        : imgData.data[traceCoordsToIndex(neighborVals[i], imgData.width)];
    for (let j = i + 1; j < neighborVals.length; j += 1) {
      const compareVal =
        typeof neighborVals[j] === "number"
          ? neighborVals[j]
          : imgData.data[traceCoordsToIndex(neighborVals[j], imgData.width)];
      if (currVal !== compareVal) {
        return true;
      }
    }
  }
  return false;
};

function TracePathFinder(vertices, imgData) {
  if (!vertices) {
    throw new Error("No vertices and image data given.");
  }
  this.allVertices = vertices;
  this.imgData = imgData;
  this.allPaths = [];
  this.count = this.countVertices();
}

TracePathFinder.prototype.countVertices = function countVertices() {
  if (typeof this.count === "undefined") {
    this.count = 0;
    for (const vertex in this.allVertices) {
      if (this.allVertices[vertex]) {
        this.count += 1;
      }
    }
  }
  return this.count;
};

TracePathFinder.prototype.getCurrentPath = function getCurrentPath() {
  if (typeof this.currPath === "undefined") {
    this.currPath = new TracePath(this.imgData);
  }
  return this.currPath;
};

TracePathFinder.prototype.addToPath = function addToPath(index) {
  const vertexToAdd = this.allVertices[index];
  delete this.allVertices[index];
  this.count -= 1;
  return this.getCurrentPath().addVertex(vertexToAdd);
};

TracePathFinder.prototype.findAllPaths = function findAllPaths() {
  let currVertexInd;
  let currVertexObj;
  while (this.count > 0) {
    for (currVertexInd in this.allVertices) {
      if (typeof this.allVertices[currVertexInd] !== "undefined") {
        while (this.getCurrentPath().isCircular === false) {
          currVertexObj = this.allVertices[currVertexInd];
          const nextVertex = currVertexObj.getNextVertex(this.imgData);
          this.addToPath(currVertexInd);
          if (!nextVertex) {
            this.getCurrentPath().isCircular = true;
            break;
          }
          currVertexInd = traceCoordsToIndex(nextVertex, this.imgData.width, 1);
          if (typeof this.allVertices[currVertexInd] === "undefined") {
            this.getCurrentPath().isCircular = true;
          }
        }
        this.allPaths.push(this.getCurrentPath());
        delete this.currPath;
      }
    }
  }
};

function TracePath(imgData) {
  this.imgData = imgData;
  this.vertices = [];
  this.isCircular = false;
}

TracePath.prototype.addVertex = function addVertex(vertex) {
  if (
    this.vertices.length > 0 &&
    this.vertices[0].x === vertex.x &&
    this.vertices[0].y === vertex.y
  ) {
    this.isCircular = true;
  }
  if (this.isCircular === true) {
    return false;
  }
  if (this.contains(vertex)) {
    return false;
  }
  this.vertices.push(vertex);
  return true;
};

TracePath.prototype.contains = function contains(vertex) {
  return Boolean(this.find(vertex));
};

TracePath.prototype.find = function find(vertexOrIndex) {
  let vertexIndex = vertexOrIndex;
  if (typeof vertexOrIndex === "number") {
    vertexIndex = traceIndexToCoords(vertexOrIndex, this.imgData.width, 1);
  }
  for (let i = 0; i < this.vertices.length; i += 1) {
    if (
      this.vertices[i].x === vertexIndex.x &&
      this.vertices[i].y === vertexIndex.y
    ) {
      return this.vertices[i];
    }
  }
  return undefined;
};

function traceIndexToCoords(index, width, multiple = 4) {
  return {
    x: (index % (width * multiple)) / multiple,
    y: Math.floor(index / (width * multiple)),
  };
}

function tracePathLength(path) {
  let length = 0;
  if (!path.vertices || path.vertices.length < 2) {
    return length;
  }
  for (let i = 1; i < path.vertices.length; i += 1) {
    length += Math.hypot(
      path.vertices[i].x - path.vertices[i - 1].x,
      path.vertices[i].y - path.vertices[i - 1].y
    );
  }
  length += Math.hypot(
    path.vertices[0].x - path.vertices[path.vertices.length - 1].x,
    path.vertices[0].y - path.vertices[path.vertices.length - 1].y
  );
  return length;
}

function pathLengthPoints(points) {
  let length = 0;
  if (!points || points.length < 2) {
    return length;
  }
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}

function buildTraceSvg(paths, width, height, strokeWidth) {
  const pathElements = paths
    .map((path) => tracePathToSvg(path, strokeWidth))
    .filter(Boolean)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${pathElements}</svg>`;
}

function tracePathToSvg(path, strokeWidth) {
  if (!path.vertices || path.vertices.length < 2) {
    return "";
  }
  const strokeColor = getStrokeColor();
  let d = `M ${path.vertices[0].x} ${path.vertices[0].y}`;
  for (let i = 1; i < path.vertices.length; i += 1) {
    d += ` L ${path.vertices[i].x} ${path.vertices[i].y}`;
  }
  d += ` L ${path.vertices[0].x} ${path.vertices[0].y}`;
  return `<path d="${d}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
}

function buildCenterlineSvg(paths, width, height, strokeWidth) {
  const pathElements = paths
    .map((path) => centerlinePathToSvg(path, strokeWidth))
    .filter(Boolean)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${pathElements}</svg>`;
}

function centerlinePathToSvg(points, strokeWidth) {
  if (!points || points.length < 2) {
    return "";
  }
  const strokeColor = getStrokeColor();
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return `<path d="${d}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
}

function updatePathsList() {
  pathsList.innerHTML = "";
  const showSequentialSpeed = sequentialLoopInput && sequentialLoopInput.value === "true";

  if (state.metadata.length === 0) {
    pathsList.classList.add("empty");
    pathsList.textContent = "No path-like elements found.";
    return;
  }

  pathsList.classList.remove("empty");
  const ordered = getOrderedMetadata(state.metadata);
  ordered.forEach((item, orderIndex) => {
    const row = document.createElement("div");
    row.className = "path-item";
    row.draggable = true;
    row.dataset.orderIndex = orderIndex;
    row.dataset.originalIndex = item.index;

    const mainRow = document.createElement("div");
    mainRow.className = "path-item-main";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.enabled;
    checkbox.addEventListener("change", () => {
      item.enabled = checkbox.checked;
      applyAnimation();
    });
    checkbox.addEventListener("click", (e) => e.stopPropagation());

    const label = document.createElement("span");
    label.className = "path-item-name";
    label.textContent = `${item.tagName.toLowerCase()} #${item.index + 1}`;

    const orderTag = document.createElement("span");
    orderTag.className = "path-order";
    orderTag.textContent = `#${orderIndex + 1}`;

    const actions = document.createElement("div");
    actions.className = "path-actions";

    const moveUp = document.createElement("button");
    moveUp.type = "button";
    moveUp.className = "path-action";
    moveUp.textContent = "↑";
    moveUp.disabled = orderIndex === 0;
    moveUp.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      swapOrder(state.metadata, orderIndex, orderIndex - 1);
      updatePathsList();
      applyAnimation();
    });

    const moveDown = document.createElement("button");
    moveDown.type = "button";
    moveDown.className = "path-action";
    moveDown.textContent = "↓";
    moveDown.disabled = orderIndex === ordered.length - 1;
    moveDown.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      swapOrder(state.metadata, orderIndex, orderIndex + 1);
      updatePathsList();
      applyAnimation();
    });

    actions.appendChild(moveUp);
    actions.appendChild(moveDown);

    const length = document.createElement("span");
    length.className = "path-length";
    length.textContent = formatLength(item.length);

    let speedField = null;
    if (showSequentialSpeed) {
      speedField = document.createElement("label");
      speedField.className = "path-seq-speed";

      const speedLabel = document.createElement("span");
      speedLabel.className = "path-seq-speed-label";
      speedLabel.textContent = "Speed (x)";

      const speedInput = document.createElement("input");
      speedInput.type = "number";
      speedInput.min = "0.1";
      speedInput.step = "0.1";
      speedInput.value = Number.isFinite(item.sequentialSpeed)
        ? item.sequentialSpeed.toString()
        : "1";
      speedInput.addEventListener("input", () => {
        const parsed = parseFloat(speedInput.value);
        item.sequentialSpeed = Number.isFinite(parsed) ? Math.max(0.1, parsed) : 1;
        applyAnimation();
      });
      speedInput.addEventListener("pointerdown", (event) => event.stopPropagation());
      speedInput.addEventListener("click", (event) => event.stopPropagation());

      speedField.appendChild(speedLabel);
      speedField.appendChild(speedInput);
    }

    // Drag and drop handlers
    let draggedElement = null;
    let draggedIndex = null;

    row.addEventListener("dragstart", (e) => {
      if (e.target && e.target.closest(".path-seq-speed")) {
        e.preventDefault();
        return;
      }
      draggedElement = row;
      draggedIndex = parseInt(row.dataset.orderIndex);
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/html", row.innerHTML);
    });

    row.addEventListener("dragend", (e) => {
      row.classList.remove("dragging");
      document.querySelectorAll(".path-item").forEach((item) => {
        item.classList.remove("drag-over");
      });
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const afterElement = getDragAfterElement(pathsList, e.clientY);
      const dragging = document.querySelector(".dragging");
      if (afterElement == null && dragging !== row) {
        pathsList.appendChild(dragging);
      } else if (afterElement && dragging !== row) {
        pathsList.insertBefore(dragging, afterElement);
      }
      row.classList.add("drag-over");
    });

    row.addEventListener("dragleave", (e) => {
      row.classList.remove("drag-over");
    });

    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (draggedElement && draggedElement !== row) {
        const draggedOrderIndex = parseInt(draggedElement.dataset.orderIndex);
        const targetOrderIndex = parseInt(row.dataset.orderIndex);
        swapOrder(state.metadata, draggedOrderIndex, targetOrderIndex);
        updatePathsList();
        applyAnimation();
      }
    });

    const meta = document.createElement("div");
    meta.className = "path-item-meta";
    meta.appendChild(orderTag);
    meta.appendChild(actions);
    meta.appendChild(length);

    mainRow.appendChild(checkbox);
    mainRow.appendChild(label);
    mainRow.appendChild(meta);
    row.appendChild(mainRow);
    if (speedField) {
      row.appendChild(speedField);
    }
    pathsList.appendChild(row);
  });

  setupPathsListScrollCapture();
}

function setupPathsListScrollCapture() {
  if (!pathsList || pathsList.dataset.scrollCaptureSetup === "true") {
    return;
  }

  const handlePathsListWheel = (event) => {
    if (!pathsList.contains(event.target)) {
      return;
    }

    const canScroll = pathsList.scrollHeight > pathsList.clientHeight + 1;
    if (!canScroll) {
      return;
    }

    const maxScrollTop = pathsList.scrollHeight - pathsList.clientHeight;
    const nextScrollTop = pathsList.scrollTop + event.deltaY;
    const clampedScrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
    const didScroll = clampedScrollTop !== pathsList.scrollTop;

    if (didScroll) {
      event.preventDefault();
      event.stopPropagation();
      pathsList.scrollTop = clampedScrollTop;
    }
  };

  pathsList.dataset.scrollCaptureSetup = "true";
  document.addEventListener("wheel", handlePathsListWheel, {
    capture: true,
    passive: false,
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll(".path-item:not(.dragging)")];
  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    },
    { offset: Number.NEGATIVE_INFINITY }
  ).element;
}

function getBaseStrokeWidth(element) {
  const attrValue = parseFloat(element.getAttribute("stroke-width"));
  if (Number.isFinite(attrValue) && attrValue > 0) {
    return attrValue;
  }
  const styleValue = parseFloat(element.style.strokeWidth);
  if (Number.isFinite(styleValue) && styleValue > 0) {
    return styleValue;
  }
  return 1;
}

function computeCurvatureScore(element, length) {
  if (
    typeof element.getPointAtLength !== "function" ||
    !Number.isFinite(length) ||
    length <= 0
  ) {
    return 0;
  }

  const samples = Math.max(8, Math.min(24, Math.floor(length / 30)));
  if (samples < 3) {
    return 0;
  }

  const points = [];
  for (let i = 0; i <= samples; i += 1) {
    const point = element.getPointAtLength((length * i) / samples);
    points.push(point);
  }

  let totalTurn = 0;
  let validTurns = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const v1Len = Math.hypot(v1x, v1y);
    const v2Len = Math.hypot(v2x, v2y);
    if (v1Len === 0 || v2Len === 0) {
      continue;
    }
    const dot = v1x * v2x + v1y * v2y;
    const cosine = Math.min(Math.max(dot / (v1Len * v2Len), -1), 1);
    const angle = Math.acos(cosine);
    totalTurn += Math.abs(angle);
    validTurns += 1;
  }

  if (validTurns === 0) {
    return 0;
  }

  const maxTurn = Math.PI * validTurns;
  return Math.min(totalTurn / maxTurn, 1);
}

function getSequentialSlotDuration(drawDuration, settings) {
  if (!settings.fillReveal) {
    return drawDuration;
  }
  return drawDuration + Math.max(0.2, drawDuration * 0.2) + 0.01;
}

function buildSequentialTimingPlan(metadata, settings) {
  if (!settings.sequentialLoop) {
    return null;
  }

  const timings = new Map();
  const enabledOrdered = getOrderedMetadata(metadata).filter((item) => item.enabled);
  const equalDuration = Math.max(0, settings.duration);
  const totalEnabled = enabledOrdered.length;
  const totalLength = enabledOrdered.reduce(
    (sum, item) =>
      sum + (Number.isFinite(item.length) && item.length > 0 ? item.length : 0),
    0
  );
  const totalDrawDuration = equalDuration * totalEnabled;

  let cursor = 0;
  enabledOrdered.forEach((item) => {
    const hasLengthWeight = settings.naturalSpeed && totalLength > 0 && totalDrawDuration > 0;
    const safeLength = Number.isFinite(item.length) && item.length > 0 ? item.length : 0;
    const durationPerPath = hasLengthWeight
      ? totalDrawDuration * (safeLength / totalLength)
      : equalDuration;
    const pathSpeed = Number.isFinite(item.sequentialSpeed)
      ? Math.max(0.1, item.sequentialSpeed)
      : 1;
    const adjustedDuration = durationPerPath / pathSpeed;
    const slotDuration = getSequentialSlotDuration(adjustedDuration, settings);
    const startTime = cursor;
    timings.set(item.index, {
      startTime,
      duration: adjustedDuration,
    });
    cursor = startTime + slotDuration;
  });

  const loopGap = settings.loop ? settings.loopDelay : 0;
  const cycleDuration = cursor + loopGap;
  return {
    timings,
    enabledCount: enabledOrdered.length,
    cycleDuration,
  };
}

function getTimingForItem(item, settings, sequentialPlan = null) {
  const easing =
    typeof item.easingOverride === "string" && item.easingOverride.trim()
      ? item.easingOverride
      : settings.easing;

  if (sequentialPlan && sequentialPlan.timings.has(item.index)) {
    const sequentialTiming = sequentialPlan.timings.get(item.index);
    return {
      duration: sequentialTiming.duration,
      easing,
      startTime: sequentialTiming.startTime,
      cycleDuration: sequentialPlan.cycleDuration,
    };
  }

  const duration =
    Number.isFinite(item.durationOverride) && item.durationOverride >= 0
      ? item.durationOverride
      : settings.duration;
  const startTime =
    Number.isFinite(item.startTime) && item.startTime >= 0 ? item.startTime : 0;
  return {
    duration,
    easing,
    startTime,
    cycleDuration: null,
  };
}

const EASING_PRESETS = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

function parseCubicBezierEasing(easing) {
  if (!easing || typeof easing !== "string") {
    return null;
  }

  const trimmed = easing.trim();
  if (EASING_PRESETS[trimmed]) {
    return EASING_PRESETS[trimmed];
  }

  const match = trimmed.match(
    /^cubic-bezier\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)$/i
  );
  if (!match) {
    return null;
  }

  const x1 = parseFloat(match[1]);
  const y1 = parseFloat(match[2]);
  const x2 = parseFloat(match[3]);
  const y2 = parseFloat(match[4]);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }

  return [x1, y1, x2, y2];
}

function cubicBezierCoord(t, p1, p2) {
  const mt = 1 - t;
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
}

function evaluateCubicBezier(progress, x1, y1, x2, y2) {
  const x = Math.min(Math.max(progress, 0), 1);
  if (x <= 0 || x >= 1) {
    return x;
  }

  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const currentX = cubicBezierCoord(t, x1, x2);
    const delta = currentX - x;
    if (Math.abs(delta) < 1e-5) {
      break;
    }
    const mt = 1 - t;
    const derivative =
      3 * mt * mt * x1 + 6 * mt * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(derivative) < 1e-6) {
      break;
    }
    t -= delta / derivative;
    if (t < 0 || t > 1) {
      break;
    }
  }

  // Fallback binary search when Newton iteration diverges.
  let low = 0;
  let high = 1;
  t = Math.min(Math.max(t, 0), 1);
  for (let i = 0; i < 10; i += 1) {
    const currentX = cubicBezierCoord(t, x1, x2);
    if (Math.abs(currentX - x) < 1e-5) {
      break;
    }
    if (currentX < x) {
      low = t;
    } else {
      high = t;
    }
    t = (low + high) / 2;
  }

  return Math.min(Math.max(cubicBezierCoord(t, y1, y2), 0), 1);
}

function applyEasing(progress, easing) {
  const clamped = Math.min(Math.max(progress, 0), 1);
  const bezier = parseCubicBezierEasing(easing);
  if (!bezier) {
    return clamped;
  }
  return evaluateCubicBezier(clamped, bezier[0], bezier[1], bezier[2], bezier[3]);
}

function getStrokeWidthForItem(item, settings) {
  const scaled = item.baseStrokeWidth * settings.strokeScale;
  return Number.isFinite(scaled) && scaled > 0 ? scaled : 1;
}

function getOrderedMetadata(metadata) {
  return [...metadata].sort((a, b) => a.order - b.order);
}

function swapOrder(metadata, fromIndex, toIndex) {
  const ordered = getOrderedMetadata(metadata);
  const from = ordered[fromIndex];
  const to = ordered[toIndex];
  if (!from || !to) {
    return;
  }
  const temp = from.order;
  from.order = to.order;
  to.order = temp;
}

function applyAnimationToSvg(svgElement, metadata, settings) {
  const existingStyle = svgElement.querySelector("#stroke-anim-style");
  if (existingStyle) {
    existingStyle.remove();
  }

  ensureSvgBackground(svgElement);

  const style = document.createElement("style");
  style.id = "stroke-anim-style";

  const elements = Array.from(svgElement.querySelectorAll(geometrySelector));
  const keyframes = [];
  const sequentialPlan = buildSequentialTimingPlan(metadata, settings);

  const ordered = getOrderedMetadata(metadata);
  ordered.forEach((item) => {
    const target = elements[item.index];
    if (!target) {
      return;
    }

    target.classList.add(`stroke-anim-${item.index}`);
    target.style.stroke = getStrokeColor();
    target.style.strokeDasharray = item.length;
    const strokeWidth = getStrokeWidthForItem(item, settings);
    target.style.strokeDashoffset =
      settings.direction === "reverse" ? 0 : item.length;
    target.style.strokeLinecap = "round";
    target.style.strokeLinejoin = "round";
    target.style.strokeOpacity = 0;
    target.style.strokeWidth = strokeWidth;
    target.style.fill = settings.fillReveal ? getFillColor(item.index) : "none";

    const drawFrom =
      settings.direction === "reverse" ? 0 : item.length.toFixed(3);
    const drawTo =
      settings.direction === "reverse" ? item.length.toFixed(3) : 0;

    const timing = getTimingForItem(item, settings, sequentialPlan);
    const startTime = timing.startTime;

    if (!item.enabled) {
      target.style.animation = "none";
      target.style.removeProperty("animation-iteration-count");
      return;
    }

    const loopGap = settings.loop ? settings.loopDelay : 0;
    const loopDuration = settings.loop
      ? Math.max(
          settings.sequentialLoop && Number.isFinite(timing.cycleDuration)
            ? timing.cycleDuration
            : startTime + timing.duration + loopGap,
          0.0001
        )
      : Math.max(timing.duration, 0.0001);
    const drawKeyframes = `stroke-draw-${item.index}`;
    const visibilityKeyframes = `stroke-visible-${item.index}`;
    if (settings.loop) {
      const startPercent = ((startTime / loopDuration) * 100).toFixed(2);
      const activePercent = (
        ((startTime + timing.duration) / loopDuration) *
        100
      ).toFixed(2);
      keyframes.push(
        `@keyframes ${drawKeyframes} { 0% { stroke-dashoffset: ${drawFrom}; } ${startPercent}% { stroke-dashoffset: ${drawFrom}; } ${activePercent}% { stroke-dashoffset: ${drawTo}; } 100% { stroke-dashoffset: ${drawTo}; } }`
      );
      keyframes.push(
        `@keyframes ${visibilityKeyframes} { 0% { stroke-opacity: 0; } ${startPercent}% { stroke-opacity: 0; } ${Math.min(100, parseFloat(startPercent) + 0.01).toFixed(2)}% { stroke-opacity: 1; } 100% { stroke-opacity: 1; } }`
      );
    } else {
      keyframes.push(
        `@keyframes ${drawKeyframes} { from { stroke-dashoffset: ${drawFrom}; } to { stroke-dashoffset: ${drawTo}; } }`
      );
      keyframes.push(
        `@keyframes ${visibilityKeyframes} { from { stroke-opacity: 0; } to { stroke-opacity: 1; } }`
      );
    }

    // Per-path start time applies as delay when not looping.
    const animationDelay = settings.loop ? 0 : startTime;
    const animations = [
      `${drawKeyframes} ${settings.loop ? loopDuration : timing.duration}s ${timing.easing} ${animationDelay}s ${settings.loop ? "infinite" : "1"} forwards`,
    ];
    if (settings.loop) {
      animations.push(
        `${visibilityKeyframes} ${loopDuration}s linear 0s infinite forwards`
      );
    } else {
      animations.push(
        `${visibilityKeyframes} 0.001s linear ${animationDelay}s forwards`
      );
    }

    if (settings.cornerBoost > 0 && item.curvature > 0) {
      const boostAmount = strokeWidth * settings.cornerBoost * item.curvature;
      const widthKeyframes = `stroke-width-${item.index}`;
      if (settings.loop) {
        const startPercent = ((startTime / loopDuration) * 100).toFixed(2);
        const midPercent = (
          ((startTime + timing.duration * 0.5) / loopDuration) *
          100
        ).toFixed(2);
        const activePercent = (
          ((startTime + timing.duration) / loopDuration) *
          100
        ).toFixed(2);
        keyframes.push(
          `@keyframes ${widthKeyframes} { 0% { stroke-width: ${strokeWidth}; } ${startPercent}% { stroke-width: ${strokeWidth}; } ${midPercent}% { stroke-width: ${(
            strokeWidth + boostAmount
          ).toFixed(3)}; } ${activePercent}% { stroke-width: ${strokeWidth}; } 100% { stroke-width: ${strokeWidth}; } }`
        );
      } else {
        keyframes.push(
          `@keyframes ${widthKeyframes} { 0%, 100% { stroke-width: ${strokeWidth}; } 50% { stroke-width: ${(
            strokeWidth + boostAmount
          ).toFixed(3)}; } }`
        );
      }
      animations.push(
        `${widthKeyframes} ${settings.loop ? loopDuration : timing.duration}s ease-in-out ${animationDelay}s ${settings.loop ? "infinite" : "1"} forwards`
      );
    }

    if (settings.fillReveal) {
      const fillKeyframes = `fill-reveal-${item.index}`;
      const fillDuration = Math.max(0.2, timing.duration * 0.2);
      const fillStartInCycle = startTime + timing.duration + 0.01;
      const fillStartTime = fillStartInCycle;

      target.style.fillOpacity = 0;
      if (settings.loop) {
        // For looped animations, calculate percentages based on loop duration
        const strokeEndPercent = ((fillStartInCycle / loopDuration) * 100);
        const fillStartPercent = (fillStartInCycle / loopDuration) * 100;
        const fillEndPercent = Math.min(
          100,
          ((fillStartInCycle + fillDuration) / loopDuration) * 100
        );
        keyframes.push(
          `@keyframes ${fillKeyframes} { 0% { fill-opacity: 0; } ${strokeEndPercent.toFixed(
            2
          )}% { fill-opacity: 0; } ${fillStartPercent.toFixed(
            2
          )}% { fill-opacity: 0; } ${fillEndPercent.toFixed(
            2
          )}% { fill-opacity: 1; } 100% { fill-opacity: 1; } }`
        );
        // When looping, fill animation starts immediately (delay handled in keyframes)
        animations.push(
          `${fillKeyframes} ${loopDuration}s linear 0s ${settings.loop ? "infinite" : "1"} forwards`
        );
      } else {
        keyframes.push(
          `@keyframes ${fillKeyframes} { from { fill-opacity: 0; } to { fill-opacity: 1; } }`
        );
        animations.push(
          `${fillKeyframes} ${fillDuration}s ${timing.easing} ${fillStartTime}s forwards`
        );
      }
    }

    target.style.animation = animations.join(", ");
    // Force loop/non-loop iteration count even if uploaded SVG contains !important overrides.
    target.style.setProperty(
      "animation-iteration-count",
      settings.loop ? "infinite" : "1",
      "important"
    );
  });

  style.textContent = keyframes.join("\n");
  svgElement.appendChild(style);
}

function applyFrameToSvg(svgElement, elements, metadata, settings, time) {
  ensureSvgBackground(svgElement);
  elements.forEach((element) => {
    element.style.animation = "none";
  });

  const sequentialPlan = buildSequentialTimingPlan(metadata, settings);
  const ordered = getOrderedMetadata(metadata);
  ordered.forEach((item) => {
    const target = elements[item.index];
    if (!target) {
      return;
    }

    if (!item.enabled || !Number.isFinite(item.length) || item.length <= 0) {
      target.style.strokeDasharray = "";
      target.style.strokeDashoffset = "";
      target.style.strokeOpacity = "";
      target.style.fillOpacity = "";
      return;
    }

    const strokeWidth = getStrokeWidthForItem(item, settings);
    target.style.stroke = getStrokeColor();
    target.style.strokeLinecap = "round";
    target.style.strokeLinejoin = "round";
    target.style.strokeWidth = strokeWidth;

    const timing = getTimingForItem(item, settings, sequentialPlan);
    const startTime = timing.startTime;
    const loopGap = settings.loop ? settings.loopDelay : 0;
    const loopDuration = settings.loop
      ? Math.max(
          settings.sequentialLoop && Number.isFinite(timing.cycleDuration)
            ? timing.cycleDuration
            : startTime + timing.duration + loopGap,
          0.0001
        )
      : Math.max(timing.duration, 0.0001);

    let drawProgress;
    if (timing.duration === 0) {
      if (settings.loop) {
        const cycleTime = time % loopDuration;
        drawProgress = cycleTime >= startTime ? 1 : 0;
      } else {
        drawProgress = time >= startTime ? 1 : 0;
      }
    } else if (settings.loop) {
      const cycleTime = time % loopDuration;
      if (cycleTime < startTime) {
        drawProgress = 0;
      } else {
        const elapsedInDraw = cycleTime - startTime;
        drawProgress = Math.min(Math.max(elapsedInDraw / timing.duration, 0), 1);
      }
    } else {
      drawProgress = Math.min(Math.max((time - startTime) / timing.duration, 0), 1);
    }
    const isVisible =
      settings.loop ? time % loopDuration >= startTime : time >= startTime;
    target.style.strokeOpacity = isVisible ? 1 : 0;
    const easedProgress = applyEasing(drawProgress, timing.easing);

    const offset =
      settings.direction === "reverse"
        ? item.length * easedProgress
        : item.length * (1 - easedProgress);

    target.style.strokeDasharray = item.length;
    target.style.strokeDashoffset = offset;

    if (settings.cornerBoost > 0 && item.curvature > 0) {
      const boostAmount = strokeWidth * settings.cornerBoost * item.curvature;
      const widthTimeline = applyEasing(drawProgress, "ease-in-out");
      const widthPulse = Math.max(0, 1 - Math.abs(widthTimeline * 2 - 1));
      target.style.strokeWidth = (strokeWidth + boostAmount * widthPulse).toFixed(3);
    } else {
      target.style.strokeWidth = strokeWidth;
    }

    if (settings.fillReveal) {
      const fillDuration = Math.max(0.2, timing.duration * 0.2);
      // Fill should start AFTER stroke animation completes
      let fillProgress;
      if (settings.loop) {
        const cycleTime = time % loopDuration;
        const fillStartInCycle = startTime + timing.duration + 0.01;
        fillProgress = Math.min(
          Math.max((cycleTime - fillStartInCycle) / fillDuration, 0),
          1
        );
      } else {
        const strokeEndTime = startTime + timing.duration;
        const fillStartTime = strokeEndTime + 0.01; // Small buffer to ensure stroke is complete
        fillProgress = Math.min(
          Math.max((time - fillStartTime) / fillDuration, 0),
          1
        );
        fillProgress = applyEasing(fillProgress, timing.easing);
      }
      target.style.fill = getFillColor(item.index);
      target.style.fillOpacity = fillProgress;
    } else {
      target.style.fillOpacity = "";
      target.style.fill = "none";
    }
  });
}

function getSvgRenderSize(svgElement, scale) {
  const viewBox = svgElement.getAttribute("viewBox");
  let width = parseFloat(svgElement.getAttribute("width"));
  let height = parseFloat(svgElement.getAttribute("height"));

  if ((!Number.isFinite(width) || !Number.isFinite(height)) && viewBox) {
    const parts = viewBox.split(/[\s,]+/).map((value) => parseFloat(value));
    if (parts.length === 4) {
      width = parts[2];
      height = parts[3];
    }
  }

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    width = 1000;
    height = 1000;
  }

  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    width,
    height,
    renderWidth: Math.max(1, Math.round(width * safeScale)),
    renderHeight: Math.max(1, Math.round(height * safeScale)),
  };
}

function computeTotalDuration(metadata, settings) {
  const sequentialPlan = buildSequentialTimingPlan(metadata, settings);
  if (sequentialPlan) {
    return sequentialPlan.enabledCount > 0
      ? Math.max(0, sequentialPlan.cycleDuration)
      : settings.duration;
  }

  let total = 0;
  let hasEnabled = false;

  const ordered = getOrderedMetadata(metadata);
  ordered.forEach((item) => {
    if (!item.enabled) {
      return;
    }
    hasEnabled = true;
    const timing = getTimingForItem(item, settings, null);
    const fillDuration = settings.fillReveal
      ? Math.max(0.2, timing.duration * 0.2)
      : 0;
    const loopGap = settings.loop ? settings.loopDelay : 0;
    const start = timing.startTime;
    const end = start + timing.duration + fillDuration + loopGap;
    total = Math.max(total, end);
  });

  return hasEnabled ? total : settings.duration;
}

function loadSvgImage(svgText) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to render SVG frame."));
    };
    img.src = url;
  });
}

async function getFfmpeg() {
  if (ffmpegState.instance) {
    return ffmpegState.instance;
  }

  if (!ffmpegState.loadingPromise) {
    // Show loading in export modal
    const exportLoadingContainer = document.getElementById("exportLoadingContainer");
    const exportModal = document.getElementById("exportModal");
    if (exportLoadingContainer && exportModal && !exportModal.classList.contains("hidden")) {
      exportLoadingContainer.style.display = "flex";
      showLoading(exportModal.querySelector(".modal-body"), "Loading encoder...");
    }
    
    ffmpegState.loadingPromise = (async () => {
      try {
        await ensureFfmpegScript();
        if (!window.FFmpegWASM || !window.FFmpegWASM.FFmpeg) {
          throw new Error("FFmpeg library failed to load. Try running via a local web server.");
        }
        const ffmpeg = new window.FFmpegWASM.FFmpeg();
        await ffmpeg.load({
          coreURL:
            "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js",
          wasmURL:
            "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm",
        });
        ffmpegState.instance = ffmpeg;
        
        // Hide loading after successful load
        if (exportLoadingContainer) {
          exportLoadingContainer.style.display = "none";
        }
        if (exportModal) {
          hideLoading(exportModal.querySelector(".modal-body"));
        }
        
        return ffmpeg;
      } catch (error) {
        // Hide loading on error
        if (exportLoadingContainer) {
          exportLoadingContainer.style.display = "none";
        }
        if (exportModal) {
          hideLoading(exportModal.querySelector(".modal-body"));
        }
        throw error;
      }
    })();
  }

  return ffmpegState.loadingPromise;
}

function applyAnimation() {
  const svgElement = svgPreview.querySelector("svg");
  if (!svgElement) {
    return;
  }

  const settings = readSettings();
  
  // Remove all animations and reset stroke-dashoffset to initial state
  const elements = Array.from(svgElement.querySelectorAll(geometrySelector));
  state.metadata.forEach((item) => {
    const element = elements[item.index];
    if (element) {
      element.style.animation = "none";
      // Reset stroke-dashoffset to initial value based on direction
      element.style.strokeDashoffset = settings.direction === "reverse" ? 0 : (item.length || 0);
    }
  });

  // Force a reflow to ensure the reset is applied
  void svgElement.offsetHeight;

  applyAnimationToSvg(svgElement, state.metadata, settings);
}

function buildPreview(svgElement) {
  svgPreview.innerHTML = "";
  svgPreview.appendChild(svgElement);
  showEditor();

  exportButton.disabled = false;
  if (exportButtonModal) exportButtonModal.disabled = false;
  uploadSvgButton.classList.remove("hidden");
  if (photoTraceBottomButton) photoTraceBottomButton.classList.add("hidden");
  if (sequentialLoopInput) {
    sequentialLoopInput.value = "true";
  }
  if (sequentialLoopButton) {
    sequentialLoopButton.classList.add("active");
    const toggleLabel = sequentialLoopButton.querySelector(".toggle-label");
    if (toggleLabel) {
      toggleLabel.textContent = "Enabled";
    }
  }
  stopPreviewShowcase();
  if (fullscreenButton) fullscreenButton.classList.remove("hidden");
  if (particlesBg) particlesBg.classList.add("hidden");

  const geometryElements = Array.from(
    svgElement.querySelectorAll(geometrySelector)
  );

  state.metadata = geometryElements.map((element, index) => {
    let length = 0;
    try {
      if (typeof element.getTotalLength === "function") {
        length = element.getTotalLength();
      }
    } catch (error) {
      length = 0;
    }
    const baseStrokeWidth = getBaseStrokeWidth(element);
    const curvature = computeCurvatureScore(element, length);

    return {
      index,
      tagName: element.tagName,
      length,
      baseStrokeWidth,
      curvature,
      order: index,
      enabled: true,
      sequentialSpeed: 1,
      startTime: 0,
      durationOverride: null,
      easingOverride: null,
    };
  });

  updatePathsList();
  
  // Animate controls panel in
  const panel = document.querySelector(".panel.controls-bar");
  if (panel) {
    // Check if we're in light mode for background color
    const isLight = document.body.classList.contains("light");
    const bgColorStart = isLight ? "rgba(240, 240, 240, 0)" : "rgba(15, 15, 15, 0)";
    const bgColorEnd = isLight ? "rgba(240, 240, 240, 0.7)" : "rgba(15, 15, 15, 0.7)";
    
    // Reset any existing animation state
    panel.classList.remove("animating-in");
    panel.removeAttribute("style");
    
    // Set initial disabled state
    panel.classList.add("is-disabled");
    
    // Disable all controls first
    const controls = panel.querySelectorAll('input:not([type="hidden"]), select, button');
    controls.forEach((el) => {
      if (el.id !== "photoFile" && el.id !== "photoFileButton") {
        el.disabled = true;
      }
    });
    
    // Use triple requestAnimationFrame to ensure initial state is fully applied
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Set initial state with inline styles using setProperty with important
          panel.style.setProperty("opacity", "0", "important");
          panel.style.setProperty("transform", "translateY(50px)", "important");
          panel.style.setProperty("background", bgColorStart, "important");
          panel.style.setProperty("pointer-events", "none", "important");
          panel.style.setProperty("transition", "none", "important");
          
          // Force reflow to ensure initial state is applied
          void panel.offsetHeight;
          
          // Remove disabled state
          panel.classList.remove("is-disabled");
          
          // Add animating-in class
          panel.classList.add("animating-in");
          
          // Force reflow
          void panel.offsetHeight;
          
          // Wait a frame, then set up transition and animate
          requestAnimationFrame(() => {
            // Remove transition: none
            panel.style.removeProperty("transition");
            
            // Set transition property with important to override CSS
            panel.style.setProperty("transition", "opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.2s, transform 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.2s, background 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.2s", "important");
            
            // Force reflow
            void panel.offsetHeight;
            
            // Wait another frame before changing values
            requestAnimationFrame(() => {
              // Remove important flags from opacity, transform, background so transition can work
              panel.style.removeProperty("opacity");
              panel.style.removeProperty("transform");
              panel.style.removeProperty("background");
              panel.style.removeProperty("pointer-events");
              
              // Force reflow
              void panel.offsetHeight;
              
              // Now set final values - transition should animate
              panel.style.opacity = "1";
              panel.style.transform = "translateY(0)";
              panel.style.background = bgColorEnd;
              panel.style.pointerEvents = "auto";
            });
          });
          
          // Enable controls immediately
          controls.forEach((el) => {
            if (el.id !== "photoFile" && el.id !== "photoFileButton") {
              el.disabled = false;
            }
          });
          const photoFileButton = document.getElementById("photoFileButton");
          const photoFileInput = document.getElementById("photoFile");
          if (photoFileButton) photoFileButton.disabled = false;
          if (photoFileInput) photoFileInput.disabled = false;
          
          // Clean up after animation completes
          setTimeout(() => {
            panel.classList.remove("animating-in");
            panel.style.removeProperty("transition");
          }, 800);
        });
      });
    });
  } else {
    setPanelControlsDisabled(false);
  }
  
  applyAnimation();
}

function stopPreviewShowcase() {
  previewShowcaseRunId += 1;
  previewShowcaseActive = false;
  if (previewShowcaseTimer) {
    clearTimeout(previewShowcaseTimer);
    previewShowcaseTimer = null;
  }
  if (previewShowcaseStage) {
    // Stop any playing videos
    const video = previewShowcaseStage.querySelector("video");
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    previewShowcaseStage.classList.remove("is-visible");
    previewShowcaseStage.classList.remove("is-fading-out");
  }
}

function queueNextPreviewShowcase(delayMs, runId) {
  if (!previewShowcaseActive || runId !== previewShowcaseRunId) {
    return;
  }
  if (previewShowcaseTimer) {
    clearTimeout(previewShowcaseTimer);
  }
  previewShowcaseTimer = setTimeout(() => {
    transitionPreviewShowcase(runId);
  }, delayMs);
}

function parseTimeTokenToMs(value) {
  if (!value || typeof value !== "string") {
    return 0;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }

  const explicit = trimmed.match(/^(-?\d*\.?\d+)(ms|s)$/i);
  if (explicit) {
    const amount = Number.parseFloat(explicit[1]);
    if (!Number.isFinite(amount)) {
      return 0;
    }
    return explicit[2].toLowerCase() === "s" ? amount * 1000 : amount;
  }

  const clockParts = trimmed.split(":").map((part) => part.trim());
  if (clockParts.length > 1 && clockParts.length <= 3) {
    const nums = clockParts.map((part) => Number.parseFloat(part));
    if (nums.every((num) => Number.isFinite(num))) {
      if (nums.length === 3) {
        return nums[0] * 3600000 + nums[1] * 60000 + nums[2] * 1000;
      }
      return nums[0] * 60000 + nums[1] * 1000;
    }
  }

  const numeric = Number.parseFloat(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric * 1000;
  }

  return 0;
}

function parseSmilClockListMs(value) {
  if (!value || typeof value !== "string") {
    return 0;
  }
  const tokens = value
    .split(";")
    .map((token) => token.trim())
    .filter(Boolean);
  const maxMs = tokens.reduce((max, token) => {
    const firstWord = token.split(/\s+/)[0];
    const ms = parseTimeTokenToMs(firstWord);
    return Math.max(max, ms);
  }, 0);
  return maxMs;
}

function getSmilAnimationEndMs(svgElement) {
  if (!svgElement) {
    return 0;
  }
  const animatedNodes = svgElement.querySelectorAll(
    "animate, animateTransform, animateMotion, animateColor, set"
  );
  let maxEndMs = 0;

  animatedNodes.forEach((node) => {
    const beginMs = parseSmilClockListMs(node.getAttribute("begin")) || 0;
    const durAttr = node.getAttribute("dur");
    const repeatDurAttr = node.getAttribute("repeatDur");
    const repeatCountAttr = node.getAttribute("repeatCount");
    const hasIndefinite =
      (repeatDurAttr && /indefinite/i.test(repeatDurAttr)) ||
      (repeatCountAttr && /indefinite/i.test(repeatCountAttr));
    if (hasIndefinite) {
      return;
    }

    const durMs = parseTimeTokenToMs(durAttr);
    const repeatDurMs = parseTimeTokenToMs(repeatDurAttr);
    let totalMs = 0;
    if (repeatDurMs > 0) {
      totalMs = repeatDurMs;
    } else if (durMs > 0) {
      const repeatCount = Number.parseFloat(repeatCountAttr || "1");
      const count = Number.isFinite(repeatCount) && repeatCount > 0 ? repeatCount : 1;
      totalMs = durMs * count;
    }
    maxEndMs = Math.max(maxEndMs, beginMs + totalMs);
  });

  return maxEndMs;
}

function nextAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function getCssAnimationEndMs(svgElement) {
  if (!svgElement || typeof svgElement.getAnimations !== "function") {
    return 0;
  }

  await nextAnimationFrame();
  await nextAnimationFrame();
  const animations = svgElement.getAnimations({ subtree: true });
  let maxEndMs = 0;

  animations.forEach((animation) => {
    if (!animation.effect || typeof animation.effect.getComputedTiming !== "function") {
      return;
    }
    const timing = animation.effect.getComputedTiming();
    if (!timing) {
      return;
    }

    if (Number.isFinite(timing.endTime) && timing.endTime > 0) {
      maxEndMs = Math.max(maxEndMs, timing.endTime);
      return;
    }

    // For looping animations, use one full cycle instead of skipping.
    if (timing.iterations === Infinity) {
      const raw = animation.effect.getTiming();
      const delay = Number.isFinite(raw.delay) ? Math.max(0, raw.delay) : 0;
      const duration = Number.isFinite(raw.duration) ? Math.max(0, raw.duration) : 0;
      const endDelay = Number.isFinite(raw.endDelay) ? Math.max(0, raw.endDelay) : 0;
      const cycleMs = delay + duration + endDelay;
      if (cycleMs > 0) {
        maxEndMs = Math.max(maxEndMs, cycleMs);
      }
    }
  });

  return maxEndMs;
}

async function mountPreviewShowcaseSvg(source, runId) {
  if (!previewShowcaseStage || !previewShowcaseActive || runId !== previewShowcaseRunId) {
    return null;
  }

  try {
    const response = await fetch(source, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "image/svg+xml");
    const svgElement = doc.querySelector("svg");
    if (!svgElement) {
      return null;
    }

    normalizeViewBox(svgElement);
    svgElement.classList.add("preview-showcase-svg");
    previewShowcaseStage.replaceChildren(document.importNode(svgElement, true));
    return previewShowcaseStage.querySelector("svg");
  } catch (error) {
    return null;
  }
}

async function mountPreviewShowcaseVideo(source, runId) {
  if (!previewShowcaseStage || !previewShowcaseActive || runId !== previewShowcaseRunId) {
    return null;
  }

  try {
    const videoElement = document.createElement("video");
    videoElement.src = source;
    videoElement.classList.add("preview-showcase-video");
    videoElement.setAttribute("playsinline", "");
    videoElement.setAttribute("muted", "");
    videoElement.setAttribute("autoplay", "");
    videoElement.muted = true; // Ensure muted is set as property too
    videoElement.playsInline = true; // Ensure playsInline is set as property too
    // Don't set loop - we want it to play once and then transition
    
    // Wait for video metadata to load
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error("Video metadata load timeout for:", source);
        reject(new Error("Video metadata load timeout"));
      }, 10000);
      
      const onLoadedMetadata = () => {
        clearTimeout(timeout);
        console.log("Video metadata loaded:", source, "duration:", videoElement.duration);
        resolve();
      };
      
      const onError = (e) => {
        clearTimeout(timeout);
        console.error("Video load error:", source, e, videoElement.error);
        reject(e);
      };
      
      videoElement.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
      videoElement.addEventListener("error", onError, { once: true });
      videoElement.addEventListener("loadstart", () => {
        console.log("Video load started:", source);
      }, { once: true });
      
      // Also listen for loadeddata to ensure more data is available
      videoElement.addEventListener("loadeddata", () => {
        console.log("Video data loaded:", source, "readyState:", videoElement.readyState);
      }, { once: true });
      
      videoElement.load();
    });

    // Ensure duration is available
    if (!videoElement.duration || !isFinite(videoElement.duration)) {
      console.warn("Video duration not available:", source);
    }

    // Add video to DOM first
    previewShowcaseStage.replaceChildren(videoElement);
    
    // Force a reflow to ensure video is in DOM
    void videoElement.offsetHeight;
    
    // Ensure video is visible and in viewport
    videoElement.style.display = "block";
    videoElement.style.visibility = "visible";
    
    // Reset video to beginning after DOM insertion and before any playback
    // Wait for seeked event to ensure the seek completes
    await new Promise((resolve) => {
      const onSeeked = () => {
        videoElement.removeEventListener("seeked", onSeeked);
        resolve();
      };
      videoElement.addEventListener("seeked", onSeeked, { once: true });
      videoElement.currentTime = 0;
      // Fallback timeout in case seeked doesn't fire
      setTimeout(() => {
        videoElement.removeEventListener("seeked", onSeeked);
        resolve();
      }, 500);
    });
    
    // Add event listeners to ensure video plays
    videoElement.addEventListener("loadeddata", () => {
      if (videoElement.paused && userHasInteracted) {
        videoElement.play().catch(err => console.warn("Video play on loadeddata failed:", err));
      }
    }, { once: true });
    
    videoElement.addEventListener("canplay", () => {
      if (videoElement.paused && userHasInteracted) {
        videoElement.play().catch(err => console.warn("Video play on canplay failed:", err));
      }
    }, { once: true });
    
    // Wait for video to have enough data to play
    if (videoElement.readyState < 3) {
      await new Promise((resolve) => {
        const onCanPlayThrough = () => {
          console.log("Video can play through, readyState:", videoElement.readyState);
          resolve();
        };
        videoElement.addEventListener("canplaythrough", onCanPlayThrough, { once: true });
        // Fallback to canplay if canplaythrough doesn't fire
        videoElement.addEventListener("canplay", () => {
          console.log("Video can play, readyState:", videoElement.readyState);
          resolve();
        }, { once: true });
        // Fallback timeout
        setTimeout(() => {
          console.log("Video readyState timeout, readyState:", videoElement.readyState);
          resolve();
        }, 3000);
      });
    }
    
    // Ensure video can actually play
    if (videoElement.readyState < 2) {
      console.warn("Video readyState still low:", videoElement.readyState, "- video may not play properly");
    }
    
    // Try to play the video with multiple attempts
    const tryPlay = async () => {
      // Ensure video is ready
      if (videoElement.readyState < 2) {
        await new Promise((resolve) => {
          videoElement.addEventListener("canplay", resolve, { once: true });
          setTimeout(resolve, 2000);
        });
      }
      
      // Multiple play attempts
      const attemptPlay = async (attemptNum = 1) => {
        try {
          if (videoElement.paused || videoElement.ended) {
            // Always reset to beginning before playing to ensure it starts from first frame
            videoElement.currentTime = 0;
            // Wait for seek to complete
            await new Promise((resolve) => {
              const onSeeked = () => {
                videoElement.removeEventListener("seeked", onSeeked);
                resolve();
              };
              videoElement.addEventListener("seeked", onSeeked, { once: true });
              // Fallback timeout
              setTimeout(() => {
                videoElement.removeEventListener("seeked", onSeeked);
                resolve();
              }, 300);
            });
            
            // Force play
            videoElement.muted = true;
            const playPromise = videoElement.play();
            if (playPromise !== undefined) {
              await playPromise;
            }
            
            // Wait and verify it's actually playing
            await new Promise(resolve => setTimeout(resolve, 300));
            
            if (videoElement.paused && !videoElement.ended) {
              throw new Error("Video play() resolved but video is still paused");
            }
            
            // Check if time is progressing
            const initialTime = videoElement.currentTime;
            await new Promise(resolve => setTimeout(resolve, 400));
            const laterTime = videoElement.currentTime;
            const isProgressing = Math.abs(laterTime - initialTime) > 0.01;
            
            console.log(`Video play() attempt ${attemptNum} - paused:`, videoElement.paused, "readyState:", videoElement.readyState, "currentTime:", videoElement.currentTime, "progressing:", isProgressing);
            
            if (!isProgressing && !videoElement.paused && !videoElement.ended && attemptNum < 3) {
              console.warn("Video not progressing, retrying...");
              videoElement.currentTime = 0;
              // Wait for seek to complete
              await new Promise((resolve) => {
                const onSeeked = () => {
                  videoElement.removeEventListener("seeked", onSeeked);
                  resolve();
                };
                videoElement.addEventListener("seeked", onSeeked, { once: true });
                setTimeout(() => {
                  videoElement.removeEventListener("seeked", onSeeked);
                  resolve();
                }, 300);
              });
              return attemptPlay(attemptNum + 1);
            }
            
            if (!isProgressing && !videoElement.paused && !videoElement.ended) {
              console.error("Video appears stuck after multiple attempts");
            }
          } else {
            console.log("Video already playing");
          }
        } catch (error) {
          console.warn(`Video play attempt ${attemptNum} failed:`, error.name, error.message);
          if (attemptNum < 3 && !userHasInteracted) {
            // Retry after delay
            await new Promise(resolve => setTimeout(resolve, 500));
            return attemptPlay(attemptNum + 1);
          }
          throw error;
        }
      };
      
      await attemptPlay();
    };
    
    await tryPlay();
    
    return videoElement;
  } catch (error) {
    console.error("Failed to mount video:", error, source);
    return null;
  }
}

async function showPreviewShowcaseSource(runId) {
  if (!previewShowcaseStage || !previewShowcaseActive || runId !== previewShowcaseRunId) {
    return;
  }

  let source = previewShowcaseSources[previewShowcaseIndex];
  
  // Use example4w.mp4 for light mode, example4.mp4 for dark mode
  if (source === "example4.mp4") {
    const isLight = document.body.classList.contains("light");
    source = isLight ? "example4w.mp4" : "example4.mp4";
  }
  
  const isVideo = source.endsWith(".mp4");
  
    console.log("Loading showcase source:", source, "isVideo:", isVideo, "index:", previewShowcaseIndex);
  
  let element = null;
  if (isVideo) {
    element = await mountPreviewShowcaseVideo(source, runId);
    console.log("Video mounted:", element ? "success" : "failed");
    if (element) {
      console.log("Video element:", {
        tagName: element.tagName,
        src: element.src,
        duration: element.duration,
        readyState: element.readyState,
        paused: element.paused,
        currentTime: element.currentTime
      });
    }
  } else {
    element = await mountPreviewShowcaseSvg(source, runId);
  }
  
  if (!previewShowcaseActive || runId !== previewShowcaseRunId) {
    return;
  }

  if (!element) {
    // If element failed to load, skip to next one
    console.warn("Failed to load showcase source:", source);
    previewShowcaseIndex = (previewShowcaseIndex + 1) % previewShowcaseSources.length;
    queueNextPreviewShowcase(previewShowcaseGapMs + previewShowcaseFadeMs, runId);
    return;
  }

  // Ensure stage is ready for fade in
  previewShowcaseStage.classList.remove("is-fading-out");
  
  // Use double RAF to ensure element is in DOM and styles are applied
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!previewShowcaseActive || runId !== previewShowcaseRunId || !previewShowcaseStage) {
        return;
      }
      // Force reflow
      void previewShowcaseStage.offsetHeight;
      previewShowcaseStage.classList.add("is-visible");
      console.log("Showcase visibility set, element:", element.tagName || element.nodeName);
      
      // Ensure video plays after visibility is set
      if (isVideo && element instanceof HTMLVideoElement) {
        const ensureVideoPlaying = async () => {
          // Force muted and playsInline
          element.muted = true;
          element.playsInline = true;
          
          // Multiple play attempts
          for (let attempt = 1; attempt <= 3; attempt++) {
            if (!element.paused && !element.ended) {
              console.log("Video already playing");
              break;
            }
            
            try {
              // Always reset to beginning before playing to ensure it starts from first frame
              element.currentTime = 0;
              // Wait for seek to complete
              await new Promise((resolve) => {
                const onSeeked = () => {
                  element.removeEventListener("seeked", onSeeked);
                  resolve();
                };
                element.addEventListener("seeked", onSeeked, { once: true });
                // Fallback timeout
                setTimeout(() => {
                  element.removeEventListener("seeked", onSeeked);
                  resolve();
                }, 300);
              });
              
              await element.play();
              
              // Wait and verify
              await new Promise(resolve => setTimeout(resolve, 200));
              
              if (!element.paused && !element.ended) {
                const initialTime = element.currentTime;
                await new Promise(resolve => setTimeout(resolve, 300));
                const laterTime = element.currentTime;
                const isProgressing = Math.abs(laterTime - initialTime) > 0.01;
                
                if (isProgressing) {
                  console.log(`Video playing after visibility set (attempt ${attempt}), currentTime:`, element.currentTime);
                  break;
                } else {
                  console.warn(`Video not progressing (attempt ${attempt}), retrying...`);
                  element.currentTime = 0;
                  // Wait for seek to complete
                  await new Promise((resolve) => {
                    const onSeeked = () => {
                      element.removeEventListener("seeked", onSeeked);
                      resolve();
                    };
                    element.addEventListener("seeked", onSeeked, { once: true });
                    setTimeout(() => {
                      element.removeEventListener("seeked", onSeeked);
                      resolve();
                    }, 300);
                  });
                }
              } else {
                throw new Error("Video still paused after play()");
              }
            } catch (err) {
              console.warn(`Video play attempt ${attempt} after visibility failed:`, err);
              
              if (attempt === 3) {
                // Final attempt failed - wait for user interaction if not already happened
                if (!userHasInteracted) {
                  const playOnInteraction = async () => {
                    if (!element.paused && !element.ended) return;
                    try {
                      // Reset to beginning before playing
                      element.currentTime = 0;
                      await new Promise((resolve) => {
                        const onSeeked = () => {
                          element.removeEventListener("seeked", onSeeked);
                          resolve();
                        };
                        element.addEventListener("seeked", onSeeked, { once: true });
                        setTimeout(() => {
                          element.removeEventListener("seeked", onSeeked);
                          resolve();
                        }, 300);
                      });
                      element.muted = true;
                      await element.play();
                      console.log("Video playing after user interaction");
                    } catch (err2) {
                      console.warn("Video play after interaction failed:", err2);
                    }
                  };
                  document.addEventListener("click", playOnInteraction, { once: true });
                  document.addEventListener("touchstart", playOnInteraction, { once: true });
                }
              } else {
                // Retry after delay
                await new Promise(resolve => setTimeout(resolve, 300));
              }
            }
          }
        };
        
        // Try immediately
        ensureVideoPlaying();
        
        // Also try after a short delay to catch any timing issues
        setTimeout(() => {
          if (element.paused && !element.ended) {
            ensureVideoPlaying();
          }
        }, 500);
      }
    });
  });
  
  let detectedEndMs = 0;
  if (isVideo && element instanceof HTMLVideoElement) {
    // Use video duration for MP4 files
    // Duration should be available after loadedmetadata event
    if (element.duration && isFinite(element.duration) && element.duration > 0) {
      detectedEndMs = element.duration * 1000; // Convert seconds to milliseconds
      console.log("Video duration detected:", detectedEndMs, "ms");
    } else {
      // If duration is still not available, use fallback
      console.warn("Video duration not available, using fallback:", element.duration, element.readyState);
      detectedEndMs = 0;
    }
  } else if (element instanceof SVGElement) {
    // Use animation detection for SVG files
    const cssEndMs = await getCssAnimationEndMs(element);
    const smilEndMs = getSmilAnimationEndMs(element);
    detectedEndMs = Math.max(cssEndMs, smilEndMs);
  }
  
  const holdMs = detectedEndMs > 0 ? detectedEndMs + 80 : previewShowcaseFallbackMs;
  queueNextPreviewShowcase(holdMs, runId);
}

function transitionPreviewShowcase(runId) {
  if (!previewShowcaseStage || !previewShowcaseActive || runId !== previewShowcaseRunId) {
    return;
  }
  // Pause any playing videos during transition
  const video = previewShowcaseStage.querySelector("video");
  if (video) {
    video.pause();
  }
  previewShowcaseStage.classList.add("is-fading-out");
  previewShowcaseStage.classList.remove("is-visible");
  if (previewShowcaseTimer) {
    clearTimeout(previewShowcaseTimer);
  }
  previewShowcaseTimer = setTimeout(() => {
    if (!previewShowcaseActive || runId !== previewShowcaseRunId) {
      return;
    }
    previewShowcaseIndex = (previewShowcaseIndex + 1) % previewShowcaseSources.length;
    showPreviewShowcaseSource(runId);
  }, previewShowcaseFadeMs + previewShowcaseGapMs);
}

function startPreviewShowcase() {
  if (!previewShowcaseStage || previewShowcaseActive) {
    return;
  }
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  if (previewShowcaseTimer) {
    clearTimeout(previewShowcaseTimer);
    previewShowcaseTimer = null;
  }

  previewShowcaseRunId += 1;
  previewShowcaseActive = true;
  previewShowcaseIndex = 0;
  previewShowcaseStage.classList.remove("is-visible");
  previewShowcaseStage.classList.remove("is-fading-out");
  showPreviewShowcaseSource(previewShowcaseRunId);
}

function handleSvgText(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svgElement = doc.querySelector("svg");

  if (!svgElement) {
    clearPreview();
    pathsList.classList.add("empty");
    pathsList.textContent = "Could not read SVG file.";
    return;
  }

  normalizeViewBox(svgElement);
  
  // Store original colors before processing
  storeOriginalColors(svgElement);
  
  state.baseSvgText = new XMLSerializer().serializeToString(svgElement);

  const previewSvg = document.importNode(svgElement, true);
  previewSvg.classList.add("preview-svg");
  previewSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  buildPreview(previewSvg);
}

function downloadAnimatedSvg() {
  if (!state.baseSvgText) {
    return;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(state.baseSvgText, "image/svg+xml");
  const svgElement = doc.querySelector("svg");
  if (!svgElement) {
    return;
  }

  svgElement.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const settings = readSettings();
  applyAnimationToSvg(svgElement, state.metadata, settings);

  const serialized = new XMLSerializer().serializeToString(svgElement);
  const blob = new Blob([serialized], { type: "image/svg+xml" });
  triggerBlobDownload(blob, "animated.svg");
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Large downloads can become corrupted if revoked immediately.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function exportMp4() {
  if (!state.baseSvgText) {
    return;
  }

  exportButton.disabled = true;
  if (exportButtonModal) {
    exportButtonModal.disabled = true;
    showButtonLoading(exportButtonModal);
  }
  
  // Show loading container and progress bar
  const exportLoadingContainer = document.getElementById("exportLoadingContainer");
  const exportProgressContainer = document.getElementById("exportProgressContainer");
  const exportModal = document.getElementById("exportModal");
  
  if (exportLoadingContainer) {
    exportLoadingContainer.style.display = "flex";
  }
  if (exportProgressContainer) {
    exportProgressContainer.style.display = "block";
  }
  
  if (location.protocol === "file:") {
    setStatus("MP4 export may fail on file://. Run a local server.");
  } else {
    setStatus("Loading encoder...");
  }

  try {
    const settings = readSettings();
    const mp4Settings = readMp4Settings();
    const parser = new DOMParser();
    const doc = parser.parseFromString(state.baseSvgText, "image/svg+xml");
    const svgElement = doc.querySelector("svg");
    if (!svgElement) {
      setStatus("Could not read SVG.");
      return;
    }

    normalizeViewBox(svgElement);
    ensureSvgBackground(svgElement);
    const animationStyle = svgElement.querySelector("#stroke-anim-style");
    if (animationStyle) {
      animationStyle.remove();
    }

    const { width, height, renderWidth, renderHeight } = getSvgRenderSize(
      svgElement,
      mp4Settings.scale
    );

    svgElement.setAttribute("width", `${width}`);
    svgElement.setAttribute("height", `${height}`);

    const totalDuration = computeTotalDuration(state.metadata, settings);
    const totalFrames = Math.max(1, Math.ceil(totalDuration * mp4Settings.fps));

    const canvas = document.createElement("canvas");
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    const context = canvas.getContext("2d");

    if (!context) {
      setStatus("Canvas is not supported in this browser.");
      return;
    }

    const elements = Array.from(svgElement.querySelectorAll(geometrySelector));
    const ffmpeg = await getFfmpeg();

    // Hide loading container, show progress
    if (exportLoadingContainer) {
      exportLoadingContainer.style.display = "none";
    }
    
    const exportBg = readExportBackground();
    setStatus(`Rendering ${totalFrames} frames...`);
    for (let frame = 0; frame < totalFrames; frame += 1) {
      const time = frame / mp4Settings.fps;
      applyFrameToSvg(svgElement, elements, state.metadata, settings, time);

      const serialized = new XMLSerializer().serializeToString(svgElement);
      const image = await loadSvgImage(serialized);
      if (exportBg === "transparent") {
        context.clearRect(0, 0, renderWidth, renderHeight);
      } else {
        context.fillStyle = exportBg === "black" ? "#000000" : "#ffffff";
        context.fillRect(0, 0, renderWidth, renderHeight);
      }
      context.drawImage(image, 0, 0, renderWidth, renderHeight);

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) {
        throw new Error("Failed to capture frame.");
      }

      const buffer = await blob.arrayBuffer();
      const frameName = `frame_${String(frame).padStart(4, "0")}.png`;
      await ffmpeg.writeFile(frameName, new Uint8Array(buffer));
      
      // Update progress
      if (exportProgressContainer) {
        updateProgress(exportProgressContainer, frame + 1, totalFrames);
      }
      setStatus(`Rendering ${frame + 1} / ${totalFrames} frames...`);
    }

    setStatus("Encoding MP4...");
    await ffmpeg.exec([
      "-framerate",
      `${mp4Settings.fps}`,
      "-i",
      "frame_%04d.png",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v",
      "libx264",
      "-profile:v",
      "baseline",
      "-level",
      "3.0",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "faststart",
      "output.mp4",
    ]);

    const data = await ffmpeg.readFile("output.mp4");
    const videoBlob = new Blob([data], { type: "video/mp4" });
    triggerBlobDownload(videoBlob, "animated.mp4");
    setStatus("MP4 exported.");
  } catch (error) {
    setStatus(`Export failed: ${error.message}`);
  } finally {
    exportButton.disabled = false;
    if (exportButtonModal) {
      exportButtonModal.disabled = false;
      hideButtonLoading(exportButtonModal);
    }
    if (exportLoadingContainer) {
      exportLoadingContainer.style.display = "none";
    }
    if (exportProgressContainer) {
      exportProgressContainer.style.display = "none";
    }
  }
}

async function exportGif() {
  if (!state.baseSvgText) {
    return;
  }

  exportButton.disabled = true;
  if (exportButtonModal) {
    exportButtonModal.disabled = true;
    showButtonLoading(exportButtonModal);
  }
  
  // Show loading container and progress bar
  const exportLoadingContainer = document.getElementById("exportLoadingContainer");
  const exportProgressContainer = document.getElementById("exportProgressContainer");
  
  if (exportLoadingContainer) {
    exportLoadingContainer.style.display = "flex";
  }
  if (exportProgressContainer) {
    exportProgressContainer.style.display = "block";
  }
  
  if (location.protocol === "file:") {
    setStatus("GIF export may fail on file://. Run a local server.");
  } else {
    setStatus("Loading encoder...");
  }

  try {
    const settings = readSettings();
    const mp4Settings = readMp4Settings();
    const parser = new DOMParser();
    const doc = parser.parseFromString(state.baseSvgText, "image/svg+xml");
    const svgElement = doc.querySelector("svg");
    if (!svgElement) {
      setStatus("Could not read SVG.");
      return;
    }

    normalizeViewBox(svgElement);
    ensureSvgBackground(svgElement);
    const animationStyle = svgElement.querySelector("#stroke-anim-style");
    if (animationStyle) {
      animationStyle.remove();
    }

    const { width, height, renderWidth, renderHeight } = getSvgRenderSize(
      svgElement,
      mp4Settings.scale
    );

    svgElement.setAttribute("width", `${width}`);
    svgElement.setAttribute("height", `${height}`);

    const totalDuration = computeTotalDuration(state.metadata, settings);
    const totalFrames = Math.max(1, Math.ceil(totalDuration * mp4Settings.fps));

    const canvas = document.createElement("canvas");
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    const context = canvas.getContext("2d");

    if (!context) {
      setStatus("Canvas is not supported in this browser.");
      return;
    }

    const elements = Array.from(svgElement.querySelectorAll(geometrySelector));
    const ffmpeg = await getFfmpeg();

    // Hide loading container, show progress
    if (exportLoadingContainer) {
      exportLoadingContainer.style.display = "none";
    }
    
    const exportBg = readExportBackground();
    setStatus(`Rendering ${totalFrames} frames...`);
    for (let frame = 0; frame < totalFrames; frame += 1) {
      const time = frame / mp4Settings.fps;
      applyFrameToSvg(svgElement, elements, state.metadata, settings, time);

      const serialized = new XMLSerializer().serializeToString(svgElement);
      const image = await loadSvgImage(serialized);
      if (exportBg === "transparent") {
        context.clearRect(0, 0, renderWidth, renderHeight);
      } else {
        context.fillStyle = exportBg === "black" ? "#000000" : "#ffffff";
        context.fillRect(0, 0, renderWidth, renderHeight);
      }
      context.drawImage(image, 0, 0, renderWidth, renderHeight);

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) {
        throw new Error("Failed to capture frame.");
      }

      const buffer = await blob.arrayBuffer();
      const frameName = `frame_${String(frame).padStart(4, "0")}.png`;
      await ffmpeg.writeFile(frameName, new Uint8Array(buffer));
      
      // Update progress
      if (exportProgressContainer) {
        updateProgress(exportProgressContainer, frame + 1, totalFrames);
      }
      setStatus(`Rendering ${frame + 1} / ${totalFrames} frames...`);
    }

    setStatus("Encoding GIF...");
    await ffmpeg.exec([
      "-framerate",
      `${mp4Settings.fps}`,
      "-i",
      "frame_%04d.png",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
      "-loop",
      settings.loop ? "0" : "-1",
      "output.gif",
    ]);

    const data = await ffmpeg.readFile("output.gif");
    const gifBlob = new Blob([data], { type: "image/gif" });
    triggerBlobDownload(gifBlob, "animated.gif");
    setStatus("GIF exported.");
  } catch (error) {
    setStatus(`Export failed: ${error.message}`);
  } finally {
    exportButton.disabled = false;
    if (exportButtonModal) {
      exportButtonModal.disabled = false;
      hideButtonLoading(exportButtonModal);
    }
    if (exportLoadingContainer) {
      exportLoadingContainer.style.display = "none";
    }
    if (exportProgressContainer) {
      exportProgressContainer.style.display = "none";
    }
  }
}

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    updateFileLabel(fileInput, svgFileName);
    return;
  }

  // Uploading a new SVG exits photo-trace mode.
  resetPhotoTrace();
  updateFileLabel(fileInput, svgFileName);
  
  // Show loading overlay when on landing
  if (viewLanding && !viewLanding.hidden) {
    showLoading(viewLanding, "Loading SVG...");
  }
  
  // Show skeleton in preview canvas
  const svgPreview = document.getElementById("svgPreview");
  if (svgPreview) {
    showSkeleton(svgPreview, "preview");
  }
  
  // Show skeleton in paths list
  if (pathsList) {
    showSkeleton(pathsList, "path-item");
    pathsList.innerHTML = "";
    // Add 3 skeleton items
    for (let i = 0; i < 3; i++) {
      const skeletonItem = document.createElement("div");
      skeletonItem.className = "skeleton-path-item";
      pathsList.appendChild(skeletonItem);
    }
  }
  
  const reader = new FileReader();
  reader.onload = () => {
    const sanitized = stripSvgFills(reader.result);
    handleSvgText(sanitized);
    
    // Hide loading states
    if (viewLanding) {
      hideLoading(viewLanding);
    }
    if (svgPreview) {
      hideSkeleton(svgPreview);
    }
    if (pathsList) {
      hideSkeleton(pathsList);
    }
  };
  reader.onerror = () => {
    // Hide loading states on error
    if (viewLanding) {
      hideLoading(viewLanding);
    }
    if (svgPreview) {
      hideSkeleton(svgPreview);
    }
    if (pathsList) {
      hideSkeleton(pathsList);
    }
    setStatus("Failed to read SVG file.");
  };
  reader.readAsText(file);
});

if (uploadSvgPrimary) {
  uploadSvgPrimary.addEventListener("click", () => {
    fileInput.click();
  });
}

svgPreview.addEventListener("click", () => {
  if (state.baseSvgText) {
    fileInput.click();
  }
});

const uploadSvgButton = document.getElementById("uploadSvgButton");
uploadSvgButton.classList.add("hidden");
uploadSvgButton.addEventListener("click", () => {
  fileInput.click();
});

if (photoTraceBottomButton) {
  photoTraceBottomButton.addEventListener("click", () => {
    photoInput.click();
  });
}

const sequentialLoopButton = document.getElementById("sequentialLoopButton");
if (sequentialLoopButton && sequentialLoopInput) {
  // Initialize button state
  const isEnabled = sequentialLoopInput.value === "true";
  sequentialLoopButton.classList.toggle("active", isEnabled);
  const toggleLabel = sequentialLoopButton.querySelector(".toggle-label");
  if (toggleLabel) {
    toggleLabel.textContent = isEnabled ? "Enabled" : "Disabled";
  }
  
  sequentialLoopButton.addEventListener("click", () => {
    const currentValue = sequentialLoopInput.value === "true";
    const newValue = !currentValue;
    sequentialLoopInput.value = newValue ? "true" : "false";
    sequentialLoopButton.classList.toggle("active", newValue);
    if (toggleLabel) {
      toggleLabel.textContent = newValue ? "Enabled" : "Disabled";
    }
    updatePathsList();
    applyAnimation();
  });
  
  // Update button state when input changes
  sequentialLoopInput.addEventListener("change", () => {
    const isEnabled = sequentialLoopInput.value === "true";
    sequentialLoopButton.classList.toggle("active", isEnabled);
    if (toggleLabel) {
      toggleLabel.textContent = isEnabled ? "Enabled" : "Disabled";
    }
    updatePathsList();
  });
}

const fullscreenButton = document.getElementById("fullscreenButton");
if (fullscreenButton) {
  // Keep fullscreen button visible so the click hits it (browsers require user gesture on the trigger element).
  // clearSvg() adds "hidden"; loading an SVG removes it so both states keep the button clickable when shown.

  function getFullscreenElement() {
    return document.fullscreenElement ||
           document.webkitFullscreenElement ||
           document.mozFullScreenElement ||
           document.msFullscreenElement;
  }

  function requestFullscreen(el) {
    if (el.requestFullscreen) return el.requestFullscreen();
    if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
    if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
    if (el.msRequestFullscreen) return el.msRequestFullscreen();
    return Promise.reject(new Error("Fullscreen not supported"));
  }

  function exitFullscreen() {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    if (document.mozCancelFullScreen) return document.mozCancelFullScreen();
    if (document.msExitFullscreen) return document.msExitFullscreen();
    return Promise.reject(new Error("Fullscreen exit not supported"));
  }

  function updateFullscreenButtonState() {
    if (getFullscreenElement()) {
      fullscreenButton.classList.add("active");
      document.body.classList.add("is-fullscreen");
    } else {
      fullscreenButton.classList.remove("active");
      document.body.classList.remove("is-fullscreen");
    }
  }

  fullscreenButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (getFullscreenElement()) {
      exitFullscreen().then(updateFullscreenButtonState).catch((err) => {
        console.error("Exit fullscreen failed:", err);
      });
      return;
    }
    const pane = document.querySelector(".editor-preview") || document.querySelector(".preview-pane.preview-pane--main");
    if (!pane) return;
    requestFullscreen(pane).then(updateFullscreenButtonState).catch((err) => {
      console.error("Enter fullscreen failed:", err);
      if (window.location.protocol === "file:") {
        console.warn("Fullscreen often requires the app to be served over HTTP (e.g. run a local server).");
      }
    });
  }, true);

  ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"].forEach((ev) => {
    document.addEventListener(ev, updateFullscreenButtonState);
  });

  document.addEventListener("fullscreenerror", () => updateFullscreenButtonState());
  document.addEventListener("webkitfullscreenerror", () => updateFullscreenButtonState());
  document.addEventListener("mozfullscreenerror", () => updateFullscreenButtonState());
  document.addEventListener("MSFullscreenError", () => updateFullscreenButtonState());
}

photoInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    updateFileLabel(photoInput, photoFileName);
    return;
  }

  // If an SVG is loaded, reset to the initial empty preview state before analyzing photo.
  if (state.baseSvgText) {
    state.baseSvgText = "";
    state.metadata = [];
    state.originalColors.clear();
    fileInput.value = "";
    updateFileLabel(fileInput, svgFileName);
    clearPreview();
  }

  updateFileLabel(photoInput, photoFileName);
  
  // Show loading state on photo upload button
  const photoFileButton = document.getElementById("photoFileButton");
  if (photoFileButton) {
    showButtonLoading(photoFileButton);
  }

  // Keep trace controls hidden while analysis is running.
  const photoTraceControls = document.querySelector(".photo-trace-controls");
  if (photoTraceControls) {
    photoTraceControls.classList.add("hidden");
  }
  
  // Show loading on preview empty area
  if (viewLanding && !viewLanding.hidden) {
    showLoading(viewLanding, "Loading photo...");
  }
  
  const reader = new FileReader();
  reader.onload = () => {
    state.lastPhotoDataUrl = reader.result;
    redoTraceButton.disabled = false;
    
    // Hide button loading state
    if (photoFileButton) {
      hideButtonLoading(photoFileButton);
    }
    
    // Hide loading on preview empty (runPhotoTrace will handle its own loading)
    if (viewLanding) {
      hideLoading(viewLanding);
    }

    runPhotoTrace(reader.result);
  };
  reader.onerror = () => {
    // Hide button loading state on error
    if (photoFileButton) {
      hideButtonLoading(photoFileButton);
    }
    // Hide loading on preview empty on error
    if (viewLanding) {
      hideLoading(viewLanding);
    }
    setStatus("Photo import failed: could not read file.");
  };
  reader.readAsDataURL(file);
});

// Ensure the file button triggers the file input and stays enabled
(function setupPhotoFileButton() {
  const photoFileButton = document.getElementById("photoFileButton");
  if (photoFileButton && photoInput) {
    // Explicitly ensure the button is not disabled
    photoFileButton.disabled = false;
    photoInput.disabled = false;
    
    // Remove disabled attribute if present
    photoFileButton.removeAttribute("disabled");
    photoInput.removeAttribute("disabled");
    
    photoFileButton.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      // Trigger the file input
      photoInput.click();
    });
    
    // Monitor and re-enable if something disables it
    const observer = new MutationObserver(function(mutations) {
      if (photoFileButton.disabled) {
        photoFileButton.disabled = false;
        photoFileButton.removeAttribute("disabled");
      }
      if (photoInput.disabled) {
        photoInput.disabled = false;
        photoInput.removeAttribute("disabled");
      }
    });
    
    observer.observe(photoFileButton, { attributes: true, attributeFilter: ['disabled'] });
    observer.observe(photoInput, { attributes: true, attributeFilter: ['disabled'] });
  } else {
    // Retry if elements aren't ready yet
    setTimeout(setupPhotoFileButton, 100);
  }
})();

redoTraceButton.addEventListener("click", () => {
  if (redoTraceButton) {
    showButtonLoading(redoTraceButton);
  }
  runPhotoTrace(state.lastPhotoDataUrl);
  // Note: Loading state will be hidden in runPhotoTrace's then/catch
});

const openPhotoTraceModal = () => {
  // Scroll to photo trace section if needed
  const photoTraceSection = document.querySelector('.photo-trace-section');
  if (photoTraceSection) {
    photoTraceSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
};

if (openTraceModalButton) {
  openTraceModalButton.addEventListener("click", openPhotoTraceModal);
}
if (openTraceModalAltButton) {
  openTraceModalAltButton.addEventListener("click", openPhotoTraceModal);
}

closeTraceModalButton.addEventListener("click", () => {
  photoTraceModal.classList.add("hidden");
});

photoTraceModal.addEventListener("click", (event) => {
  const target = event.target;
  if (target && target.getAttribute("data-close-modal") === "true") {
    photoTraceModal.classList.add("hidden");
  }
});

if (removePhotoTraceButton) {
  removePhotoTraceButton.addEventListener("click", () => {
    resetPhotoTrace();
    clearPreview();
  });
}

const openExportModal = () => {
  if (exportModalCloseTimer) {
    clearTimeout(exportModalCloseTimer);
    exportModalCloseTimer = null;
  }
  exportModal.classList.remove("hidden");
  requestAnimationFrame(() => {
    exportModal.classList.add("is-open");
    updateExportResolution();
    if (typeof updateExportBackgroundForFormat === "function") updateExportBackgroundForFormat();
  });
};

exportButton.addEventListener("click", openExportModal);

const openHowItWorksModal = () => {
  if (!howItWorksModal) return;
  howItWorksModal.classList.remove("hidden");
  requestAnimationFrame(() => {
    howItWorksModal.classList.add("is-open");
  });
};

const closeHowItWorksModal = () => {
  if (!howItWorksModal) return;
  howItWorksModal.classList.remove("is-open");
  setTimeout(() => {
    howItWorksModal.classList.add("hidden");
  }, 240);
};

if (openHowItWorksButton) {
  openHowItWorksButton.addEventListener("click", openHowItWorksModal);
}
if (closeHowItWorksModalButton) {
  closeHowItWorksModalButton.addEventListener("click", closeHowItWorksModal);
}
if (howItWorksModal) {
  howItWorksModal.addEventListener("click", (event) => {
    const target = event.target;
    if (target && target.getAttribute("data-close-modal") === "true") {
      closeHowItWorksModal();
    }
  });
}

const closeExportModal = () => {
  exportModal.classList.remove("is-open");
  if (exportModalCloseTimer) {
    clearTimeout(exportModalCloseTimer);
  }
  exportModalCloseTimer = setTimeout(() => {
    exportModal.classList.add("hidden");
    exportModalCloseTimer = null;
  }, 240);
};

let exportModalCloseTimer = null;

closeExportModalButton.addEventListener("click", closeExportModal);

exportModal.addEventListener("click", (event) => {
  const target = event.target;
  if (target && target.getAttribute("data-close-modal") === "true") {
    closeExportModal();
  }
});

if (exportButtonModal) {
  exportButtonModal.addEventListener("click", () => {
    const format = exportFormatInput && exportFormatInput.value;
    if (format === "mp4") {
      exportMp4();
    } else if (format === "gif") {
      exportGif();
    } else {
      downloadAnimatedSvg();
      closeExportModal();
    }
  });
}

// Wire export modal format buttons so MP4/GIF are actually selected
const exportFormatButtons = exportModal.querySelectorAll(".export-format-button");
exportFormatButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const value = btn.dataset.value;
    if (!value) return;
    if (exportFormatInput) exportFormatInput.value = value;
    exportFormatButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (value === "mp4" || value === "gif") {
      updateExportResolution();
    } else if (exportResolutionText) {
      exportResolutionText.textContent = "N/A (Animated SVG)";
    }
    updateExportBackgroundForFormat();
  });
});

// Wire export modal background buttons; disable Transparent when MP4 is selected
const exportBackgroundButtons = exportModal.querySelectorAll(".export-background-button");
const exportTransparentBtn = Array.from(exportBackgroundButtons).find((b) => b.dataset.value === "transparent");

function updateExportBackgroundForFormat() {
  const format = exportFormatInput && exportFormatInput.value;
  const isMp4 = format === "mp4";
  if (exportTransparentBtn) {
    exportTransparentBtn.disabled = isMp4;
    exportTransparentBtn.setAttribute("aria-disabled", isMp4 ? "true" : "false");
    if (isMp4 && exportBackgroundInput && exportBackgroundInput.value === "transparent") {
      exportBackgroundInput.value = "white";
      exportBackgroundButtons.forEach((b) => {
        b.classList.toggle("active", b.dataset.value === "white");
      });
    }
  }
}

if (exportBackgroundInput) {
  exportBackgroundButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const value = btn.dataset.value;
      if (value !== "black" && value !== "white" && value !== "transparent") return;
      exportBackgroundInput.value = value;
      exportBackgroundButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

toggleThemeButton.addEventListener("click", () => {
  const isDark = document.body.classList.contains("dark");
  applyTheme(isDark ? "light" : "dark");
});

const applyAnimationDebounced = debounce(applyAnimation, 80);
[
  durationInput,
  sequentialLoopInput,
  loopDelayInput,
  strokeScaleInput,
  cornerBoostInput,
].forEach((input) => {
  if (input) {
    input.addEventListener("input", applyAnimationDebounced);
  }
});

// Dynamic motion toggle button removed

if (directionButtons && directionButtons.length > 0) {
  directionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      directionButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      directionInput.value = button.dataset.value;
      applyAnimation();
    });
  });
}

const fillRevealToggle = document.getElementById("fillRevealToggle");
if (fillRevealToggle) {
  // Update toggle button state based on current value
  const updateFillRevealToggle = () => {
    const isEnabled = fillRevealInput.value === "true";
    fillRevealToggle.classList.toggle("active", isEnabled);
    const toggleLabel = fillRevealToggle.querySelector(".toggle-label");
    if (toggleLabel) {
      toggleLabel.textContent = isEnabled ? "Enabled" : "Disabled";
    }
  };
  
  // Initialize toggle state
  updateFillRevealToggle();
  
  fillRevealToggle.addEventListener("click", () => {
    const currentValue = fillRevealInput.value === "true";
    fillRevealInput.value = currentValue ? "false" : "true";
    updateFillRevealToggle();
    applyAnimation();
  });
}

// Handle custom easing dropdown
const easingToggle = document.getElementById("easingToggle");
const easingDropdownMenu = document.getElementById("easingDropdownMenu");
const easingDisplay = document.getElementById("easingDisplay");
const easingDropdownItems = easingDropdownMenu
  ? easingDropdownMenu.querySelectorAll(".easing-dropdown-item")
  : [];
const openEasingCurveEditor = document.getElementById("openEasingCurveEditor");
const closeEasingCurveEditor = document.getElementById("closeEasingCurveEditor");
const easingCurveEditor = document.getElementById("easingCurveEditor");
const easingCurvePath = document.getElementById("easingCurvePath");
const curveX1 = document.getElementById("curveX1");
const curveY1 = document.getElementById("curveY1");
const curveX2 = document.getElementById("curveX2");
const curveY2 = document.getElementById("curveY2");

function setEasingValue(value, label = null) {
  easingInput.value = value;
  easingDisplay.textContent = label || value;
  easingDropdownItems.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === value);
  });
  applyAnimation();
}

function renderCurvePath(x1, y1, x2, y2) {
  if (!easingCurvePath) {
    return;
  }
  const toX = (x) => 10 + x * 100;
  const toY = (y) => 110 - y * 100;
  easingCurvePath.setAttribute(
    "d",
    `M10 110 C ${toX(x1).toFixed(2)} ${toY(y1).toFixed(2)}, ${toX(x2).toFixed(2)} ${toY(y2).toFixed(2)}, 110 10`
  );
}

function syncCurveEditorFromEasing() {
  const bezier = parseCubicBezierEasing(easingInput.value) || [0.42, 0, 0.58, 1];
  if (curveX1) curveX1.value = bezier[0];
  if (curveY1) curveY1.value = bezier[1];
  if (curveX2) curveX2.value = bezier[2];
  if (curveY2) curveY2.value = bezier[3];
  renderCurvePath(bezier[0], bezier[1], bezier[2], bezier[3]);
}

function updateEasingFromCurveEditor() {
  const x1 = parseFloat(curveX1.value);
  const y1 = parseFloat(curveY1.value);
  const x2 = parseFloat(curveX2.value);
  const y2 = parseFloat(curveY2.value);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return;
  }
  renderCurvePath(x1, y1, x2, y2);
  const value = `cubic-bezier(${x1.toFixed(2)}, ${y1.toFixed(2)}, ${x2.toFixed(2)}, ${y2.toFixed(2)})`;
  setEasingValue(value, "custom curve");
}

if (easingToggle && easingDropdownMenu) {
  // Toggle dropdown
  easingToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isExpanded = easingToggle.getAttribute("aria-expanded") === "true";
    easingToggle.setAttribute("aria-expanded", !isExpanded);
    easingDropdownMenu.classList.toggle("show", !isExpanded);
  });

  // Handle item selection
  easingDropdownItems.forEach((item) => {
    item.addEventListener("click", () => {
      const value = item.dataset.value;
      const label = item.textContent.trim();
      setEasingValue(value, label);
      
      // Close dropdown
      easingToggle.setAttribute("aria-expanded", "false");
      easingDropdownMenu.classList.remove("show");
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!easingToggle.contains(e.target) && !easingDropdownMenu.contains(e.target)) {
      easingToggle.setAttribute("aria-expanded", "false");
      easingDropdownMenu.classList.remove("show");
    }
  });
}

if (openEasingCurveEditor && closeEasingCurveEditor && easingCurveEditor) {
  openEasingCurveEditor.addEventListener("click", (event) => {
    event.stopPropagation();
    syncCurveEditorFromEasing();
    easingCurveEditor.classList.remove("hidden");
  });

  closeEasingCurveEditor.addEventListener("click", () => {
    easingCurveEditor.classList.add("hidden");
  });

  [curveX1, curveY1, curveX2, curveY2].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", updateEasingFromCurveEditor);
  });

  document.addEventListener("click", (event) => {
    if (!easingCurveEditor.contains(event.target) && !openEasingCurveEditor.contains(event.target)) {
      easingCurveEditor.classList.add("hidden");
    }
  });
}

// Handle FPS dropdown in export modal
const fpsToggle = document.getElementById("fpsToggle");
const fpsDropdownMenu = document.getElementById("fpsDropdownMenu");
const fpsDisplay = document.getElementById("fpsDisplay");
const fpsDropdownItems = fpsDropdownMenu ? fpsDropdownMenu.querySelectorAll(".easing-dropdown-item") : [];

if (fpsToggle && fpsDropdownMenu) {
  // Toggle dropdown
  fpsToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isExpanded = fpsToggle.getAttribute("aria-expanded") === "true";
    fpsToggle.setAttribute("aria-expanded", !isExpanded);
    fpsDropdownMenu.classList.toggle("show", !isExpanded);
  });

  // Handle item selection
  fpsDropdownItems.forEach((item) => {
    item.addEventListener("click", () => {
      const value = item.dataset.value;
      const label = item.textContent.trim();
      
      // Update hidden input
      fpsInput.value = value;
      
      // Update display
      fpsDisplay.textContent = label;
      
      // Update active state
      fpsDropdownItems.forEach((btn) => btn.classList.remove("active"));
      item.classList.add("active");
      
      // Close dropdown
      fpsToggle.setAttribute("aria-expanded", "false");
      fpsDropdownMenu.classList.remove("show");
      
      // Update resolution display
      updateExportResolution();
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!fpsToggle.contains(e.target) && !fpsDropdownMenu.contains(e.target)) {
      fpsToggle.setAttribute("aria-expanded", "false");
      fpsDropdownMenu.classList.remove("show");
    }
  });
}

// Handle Export Format dropdown in export modal
const exportFormatToggle = document.getElementById("exportFormatToggle");
const exportFormatDropdownMenu = document.getElementById("exportFormatDropdownMenu");
const exportFormatDisplay = document.getElementById("exportFormatDisplay");
const exportFormatDropdownItems = exportFormatDropdownMenu ? exportFormatDropdownMenu.querySelectorAll(".easing-dropdown-item") : [];

if (exportFormatToggle && exportFormatDropdownMenu) {
  // Toggle dropdown
  exportFormatToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isExpanded = exportFormatToggle.getAttribute("aria-expanded") === "true";
    exportFormatToggle.setAttribute("aria-expanded", !isExpanded);
    exportFormatDropdownMenu.classList.toggle("show", !isExpanded);
  });

  // Handle item selection
  exportFormatDropdownItems.forEach((item) => {
    item.addEventListener("click", () => {
      const value = item.dataset.value;
      const label = item.textContent.trim();
      
      // Update hidden input
      exportFormatInput.value = value;
      
      // Update display
      exportFormatDisplay.textContent = label;
      
      // Update active state
      exportFormatDropdownItems.forEach((btn) => btn.classList.remove("active"));
      item.classList.add("active");
      
      // Close dropdown
      exportFormatToggle.setAttribute("aria-expanded", "false");
      exportFormatDropdownMenu.classList.remove("show");
      
      // Update resolution display (only for mp4 and gif)
      if (value === "mp4" || value === "gif") {
        updateExportResolution();
      }
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!exportFormatToggle.contains(e.target) && !exportFormatDropdownMenu.contains(e.target)) {
      exportFormatToggle.setAttribute("aria-expanded", "false");
      exportFormatDropdownMenu.classList.remove("show");
    }
  });
}

// Function to update export resolution display
function updateExportResolution() {
  if (!exportResolutionText || !state.baseSvgText) {
    if (exportResolutionText) {
      exportResolutionText.textContent = "No SVG loaded";
    }
    return;
  }

  const format = exportFormatInput && exportFormatInput.value;
  if (format !== "mp4" && format !== "gif") {
    if (exportResolutionText) {
      exportResolutionText.textContent = "N/A (Animated SVG)";
    }
    return;
  }

  try {
    const mp4Settings = readMp4Settings();
    const parser = new DOMParser();
    const doc = parser.parseFromString(state.baseSvgText, "image/svg+xml");
    const svgElement = doc.querySelector("svg");
    
    if (!svgElement) {
      exportResolutionText.textContent = "Unable to read SVG";
      return;
    }

    // Create a temporary copy to normalize
    const tempSvg = svgElement.cloneNode(true);
    normalizeViewBox(tempSvg);
    
    const { renderWidth, renderHeight } = getSvgRenderSize(tempSvg, mp4Settings.scale);
    exportResolutionText.textContent = `${renderWidth} × ${renderHeight} px`;
  } catch (error) {
    exportResolutionText.textContent = "Error calculating resolution";
  }
}

// Handle scale button clicks
if (scaleButtons && scaleButtons.length > 0) {
  scaleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      scaleButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      scaleInput.value = button.dataset.value;
      updateExportResolution();
    });
  });
}

// Update resolution when FPS changes (though FPS doesn't affect resolution, we update for consistency)
if (fpsDropdownItems && fpsDropdownItems.length > 0) {
  fpsDropdownItems.forEach((item) => {
    const originalClick = item.onclick;
    item.addEventListener("click", () => {
      if (originalClick) originalClick();
      updateExportResolution();
    });
  });
}

[
  photoStrokeWidthInput,
  photoThresholdInput,
  photoInvertInput,
  photoPathOmitInput,
  photoSimplifyInput,
  photoDilationInput,
  photoGapBridgeInput,
].forEach((input) => {
  input.addEventListener("input", () => {
    if (state.lastPhotoDataUrl) {
      runPhotoTrace(state.lastPhotoDataUrl);
    }
  });
});

document.querySelectorAll('input[type="range"]').forEach((input) => {
  updateRangeValue(input);
  updateRangeFill(input);
  input.addEventListener("input", () => {
    updateRangeValue(input);
    updateRangeFill(input);
  });
});

const savedTheme = localStorage.getItem("svg-stroke-theme");
const systemPrefersDark =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;
applyTheme(savedTheme ? savedTheme : systemPrefersDark ? "dark" : "light");

// Logo click handler - return to home screen
const appLogo = document.querySelector(".app-logo");
const logoSection = document.querySelector(".header-logo-section");
if (appLogo || logoSection) {
  const clickableElement = logoSection || appLogo;
  clickableElement.style.cursor = "pointer";
  clickableElement.addEventListener("click", (e) => {
    e.preventDefault();
    clearPreview();
  });
}
if (editorLogoLink) {
  editorLogoLink.addEventListener("click", (e) => {
    e.preventDefault();
    clearPreview();
  });
}
if (landingLogo) {
  landingLogo.addEventListener("click", (e) => e.preventDefault());
}

// Enable video playback after user interaction
const enableVideoPlayback = async () => {
  if (userHasInteracted) return;
  userHasInteracted = true;
  console.log("User interaction detected, enabling video playback");
  
  // Try to play any paused videos in the showcase
  const video = previewShowcaseStage?.querySelector("video");
  if (video) {
    try {
      // Always reset to beginning before playing
      video.currentTime = 0;
      await new Promise((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked, { once: true });
        setTimeout(() => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        }, 300);
      });
      if (video.paused || video.ended) {
        await video.play();
        // Verify it's playing
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!video.paused) {
          console.log("Video started playing after user interaction, currentTime:", video.currentTime);
        } else {
          console.warn("Video still paused after play() call");
        }
      }
    } catch (err) {
      console.warn("Video play after interaction failed:", err);
    }
  }
};

// Listen for user interaction events (use capture phase to catch early)
document.addEventListener("click", enableVideoPlayback, { once: true, capture: true });
document.addEventListener("touchstart", enableVideoPlayback, { once: true, capture: true });
document.addEventListener("keydown", enableVideoPlayback, { once: true, capture: true });

clearPreview();

// Hide photoFileName initially if it shows "No file chosen"
if (photoFileName && photoFileName.textContent === "No file chosen") {
  photoFileName.style.display = "none";
}

// Debug button to toggle disabled state
// Debug toggle button removed

if (sequentialLoopButton && sequentialLoopInput) {
  const isEnabled = sequentialLoopInput.value === "true";
  sequentialLoopButton.classList.toggle("active", isEnabled);
  const toggleLabel = sequentialLoopButton.querySelector(".toggle-label");
  if (toggleLabel) {
    toggleLabel.textContent = isEnabled ? "Enabled" : "Disabled";
  }
}

// Collapsible sections functionality
// Set up collapsible sections
(function setupCollapsibleSections() {
  // Paths section - find by checking if it contains #pathsList
  // Since photo trace is inside paths section, they share the same collapsible section
  const pathsList = document.getElementById('pathsList');
  const pathsSection = pathsList ? pathsList.closest('.collapsible-section') : null;
  
  if (pathsSection) {
    const pathsHeader = pathsSection.querySelector('.collapsible-header');
    if (pathsHeader) {
      // Remove any existing listeners by cloning
      const newHeader = pathsHeader.cloneNode(true);
      pathsHeader.parentNode.replaceChild(newHeader, pathsHeader);
      
      newHeader.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pathsSection.classList.toggle('expanded');
      });
      
      console.log('Paths collapsible section set up');
    }
  } else {
    // Retry if element not found yet
    setTimeout(setupCollapsibleSections, 100);
  }
})();

// Initialize export modal button state
if (exportButtonModal) exportButtonModal.disabled = true;

// Hide header initially when no SVG is uploaded
// Landing is visible by default (view-editor has [hidden] in HTML)
if (viewLanding) viewLanding.removeAttribute("hidden");
if (viewEditor) viewEditor.setAttribute("hidden", "");

// Create space particles with zoom effect
if (particlesBg) {
  const particleCount = 80;
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const maxDistance = Math.max(window.innerWidth, window.innerHeight) * 0.8;
  
  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement("div");
    particle.className = "particle";
    
    // Random angle for radial movement (all directions from center)
    const angle = Math.random() * Math.PI * 2;
    const startDistance = 50 + Math.random() * 150; // Start near center
    const endDistance = maxDistance; // End far from center
    
    // Starting position near center
    const startX = centerX + Math.cos(angle) * startDistance;
    const startY = centerY + Math.sin(angle) * startDistance;
    
    // Ending position far from center (same angle, further out)
    const endX = centerX + Math.cos(angle) * endDistance;
    const endY = centerY + Math.sin(angle) * endDistance;
    
    // Random size and speed
    const size = 0.8 + Math.random() * 1.2; // Smaller particles: 0.8-2px
    const duration = 8 + Math.random() * 12; // 8-20 seconds (slower)
    const delay = Math.random() * duration;
    
    particle.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      background: rgba(255, 255, 255, ${0.5 + Math.random() * 0.3});
      border-radius: 50%;
      left: ${startX}px;
      top: ${startY}px;
      pointer-events: none;
      transform: translate(-50%, -50%) scale(0.1);
      opacity: 0;
    `;
    
    // Create unique animation for each particle
    const animationName = `particle-zoom-${i}`;
    const style = document.createElement("style");
    style.textContent = `
      @keyframes ${animationName} {
        0% {
          transform: translate(-50%, -50%) scale(0.1);
          opacity: 0;
          left: ${startX}px;
          top: ${startY}px;
        }
        10% {
          opacity: 1;
        }
        90% {
          opacity: 1;
        }
        100% {
          transform: translate(-50%, -50%) scale(4);
          opacity: 0;
          left: ${endX}px;
          top: ${endY}px;
        }
      }
    `;
    document.head.appendChild(style);
    
    particle.style.animation = `${animationName} ${duration}s linear infinite`;
    particle.style.animationDelay = `${delay}s`;
    particlesBg.appendChild(particle);
  }
  
  // Add light mode style
  const lightStyle = document.createElement("style");
  lightStyle.textContent = `
    body.light .particle {
      background: rgba(0, 0, 0, 0.4) !important;
    }
  `;
  document.head.appendChild(lightStyle);
}
