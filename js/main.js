// ============================================================
// YOUTUBE PLAYER — a convenience embed only. Browsers block any page
// from reading the audio stream of a cross-origin YouTube iframe, so
// this section is intentionally NOT wired into the visualizer below.
// ============================================================
const ytForm = document.getElementById("yt-form");
const ytUrlInput = document.getElementById("yt-url");
const ytError = document.getElementById("yt-error");
const ytEmbedEmpty = document.getElementById("yt-embed-empty");
const ytPlayerEl = document.getElementById("yt-player");

function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

ytForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = extractYouTubeId(ytUrlInput.value.trim());
  if (!id) {
    ytError.classList.remove("hidden");
    return;
  }
  ytError.classList.add("hidden");
  ytEmbedEmpty.classList.add("hidden");
  const iframe = document.createElement("iframe");
  iframe.src = `https://www.youtube.com/embed/${id}?autoplay=1`;
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
  iframe.allowFullscreen = true;
  iframe.title = "Reproductor de YouTube";
  ytPlayerEl.innerHTML = "";
  ytPlayerEl.appendChild(iframe);
});

// ============================================================
// AUDIO VISUALIZER — real frequency analysis via the Web Audio API,
// driven entirely by a locally chosen file (no cross-origin limits here).
// ============================================================
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileError = document.getElementById("file-error");
const playerControls = document.getElementById("player-controls");
const fileNameEl = document.getElementById("file-name");
const audioEl = document.getElementById("audio-el");
const canvas = document.getElementById("viz-canvas");
const ctx = canvas.getContext("2d");

const btnPlay = document.getElementById("btn-play");
const iconPlay = document.getElementById("icon-play");
const iconPause = document.getElementById("icon-pause");
const seekEl = document.getElementById("seek");
const timeCurrentEl = document.getElementById("time-current");
const timeDurationEl = document.getElementById("time-duration");

const vizStyleEl = document.getElementById("viz-style");
const volumeEl = document.getElementById("volume");
const speedEl = document.getElementById("speed");
const speedValueEl = document.getElementById("speed-value");
const sensitivityEl = document.getElementById("sensitivity");

let audioCtx = null;
let analyser = null;
let gainNode = null;
let sourceNode = null;
let freqData = null;
let timeData = null;
let rafId = null;
let isSeeking = false;

function setupWebAudioGraph() {
  if (audioCtx) return; // only build the graph once per page load
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sourceNode = audioCtx.createMediaElementSource(audioEl);
  gainNode = audioCtx.createGain();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.82;
  freqData = new Uint8Array(analyser.frequencyBinCount);
  timeData = new Uint8Array(analyser.fftSize);

  sourceNode.connect(gainNode);
  gainNode.connect(analyser);
  analyser.connect(audioCtx.destination);
  gainNode.gain.value = parseFloat(volumeEl.value);
}

function loadFile(file) {
  if (!file || !file.type.startsWith("audio/")) {
    fileError.classList.remove("hidden");
    return;
  }
  fileError.classList.add("hidden");
  const url = URL.createObjectURL(file);
  audioEl.src = url;
  fileNameEl.textContent = file.name;
  playerControls.classList.remove("hidden");
  // the canvas was 0x0 while its container had display:none — now that
  // it's visible, re-measure so the internal bitmap matches the CSS size
  resizeCanvasForDPR();
  audioEl.load();
}

dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

// ---------- transport ----------
btnPlay.addEventListener("click", async () => {
  setupWebAudioGraph();
  if (audioCtx.state === "suspended") await audioCtx.resume();

  if (audioEl.paused) {
    await audioEl.play();
  } else {
    audioEl.pause();
  }
});

audioEl.addEventListener("play", () => {
  iconPlay.classList.add("hidden");
  iconPause.classList.remove("hidden");
  if (!rafId) draw();
});

audioEl.addEventListener("pause", () => {
  iconPlay.classList.remove("hidden");
  iconPause.classList.add("hidden");
});

audioEl.addEventListener("loadedmetadata", () => {
  seekEl.max = audioEl.duration;
  timeDurationEl.textContent = formatTime(audioEl.duration);
});

audioEl.addEventListener("timeupdate", () => {
  if (isSeeking) return;
  seekEl.value = audioEl.currentTime;
  timeCurrentEl.textContent = formatTime(audioEl.currentTime);
});

audioEl.addEventListener("ended", () => {
  iconPlay.classList.remove("hidden");
  iconPause.classList.add("hidden");
});

seekEl.addEventListener("input", () => {
  isSeeking = true;
  timeCurrentEl.textContent = formatTime(parseFloat(seekEl.value));
});
seekEl.addEventListener("change", () => {
  audioEl.currentTime = parseFloat(seekEl.value);
  isSeeking = false;
});

function formatTime(sec) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ---------- editor controls ----------
volumeEl.addEventListener("input", () => {
  if (gainNode) gainNode.gain.value = parseFloat(volumeEl.value);
});
speedEl.addEventListener("input", () => {
  const v = parseFloat(speedEl.value);
  audioEl.playbackRate = v;
  speedValueEl.textContent = `${v.toFixed(2)}×`;
});

// ---------- canvas rendering ----------
function resizeCanvasForDPR() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvasForDPR);

function draw() {
  rafId = requestAnimationFrame(draw);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.clearRect(0, 0, w, h);

  if (!analyser) return;
  const sensitivity = parseFloat(sensitivityEl.value);
  const style = vizStyleEl.value;

  if (style === "wave") {
    analyser.getByteTimeDomainData(timeData);
    drawWave(w, h, sensitivity);
  } else if (style === "circle") {
    analyser.getByteFrequencyData(freqData);
    drawCircle(w, h, sensitivity);
  } else if (style === "mirror") {
    analyser.getByteFrequencyData(freqData);
    drawBars(w, h, sensitivity, true);
  } else {
    analyser.getByteFrequencyData(freqData);
    drawBars(w, h, sensitivity, false);
  }
}

function barColor(t) {
  // t: 0 (low bars) -> 1 (tall bars), sweep from brass through burgundy to bright red
  const r1 = 199, g1 = 154, b1 = 82;   // brass
  const r2 = 228, g2 = 40, b2 = 60;    // burgundy
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

function drawBars(w, h, sensitivity, mirror) {
  const usableBins = Math.floor(freqData.length * 0.75); // trim the near-silent top end
  const barCount = Math.min(64, usableBins);
  const step = Math.floor(usableBins / barCount);
  const gap = 3;
  const barWidth = w / barCount - gap;

  for (let i = 0; i < barCount; i++) {
    const v = freqData[i * step] / 255;
    const boosted = Math.min(1, v * sensitivity);
    const barH = boosted * (mirror ? h * 0.42 : h * 0.88);
    const x = i * (barWidth + gap);

    ctx.fillStyle = barColor(boosted);
    ctx.shadowColor = barColor(boosted);
    ctx.shadowBlur = 6;

    if (mirror) {
      const mid = h / 2;
      roundRectTop(x, mid - barH, barWidth, barH);
      roundRectBottom(x, mid, barWidth, barH);
    } else {
      roundRectTop(x, h - barH, barWidth, barH);
    }
  }
  ctx.shadowBlur = 0;
}

function roundRectTop(x, y, w, h) {
  const r = Math.min(4, w / 2);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

function roundRectBottom(x, y, w, h) {
  const r = Math.min(4, w / 2);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + h - r);
  ctx.arcTo(x, y + h, x + r, y + h, r);
  ctx.lineTo(x + w - r, y + h);
  ctx.arcTo(x + w, y + h, x + w, y + h - r, r);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fill();
}

function drawWave(w, h, sensitivity) {
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#FF4D67";
  ctx.shadowColor = "#E4283C";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  const sliceWidth = w / timeData.length;
  let x = 0;
  for (let i = 0; i < timeData.length; i++) {
    const norm = (timeData[i] - 128) / 128; // -1..1
    const y = h / 2 + norm * (h / 2) * sensitivity * 0.85;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawCircle(w, h, sensitivity) {
  const cx = w / 2;
  const cy = h / 2;
  const baseRadius = Math.min(w, h) * 0.18;
  const usableBins = Math.floor(freqData.length * 0.7);
  const barCount = 72;
  const step = Math.floor(usableBins / barCount);
  const angleStep = (Math.PI * 2) / barCount;

  for (let i = 0; i < barCount; i++) {
    const v = freqData[i * step] / 255;
    const boosted = Math.min(1, v * sensitivity);
    const len = boosted * baseRadius * 1.6;
    const angle = i * angleStep - Math.PI / 2;

    const x1 = cx + Math.cos(angle) * baseRadius;
    const y1 = cy + Math.sin(angle) * baseRadius;
    const x2 = cx + Math.cos(angle) * (baseRadius + len);
    const y2 = cy + Math.sin(angle) * (baseRadius + len);

    ctx.strokeStyle = barColor(boosted);
    ctx.shadowColor = barColor(boosted);
    ctx.shadowBlur = 6;
    ctx.lineWidth = 3.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.arc(cx, cy, baseRadius * 0.82, 0, Math.PI * 2);
  ctx.fillStyle = "#17171B";
  ctx.fill();
  ctx.strokeStyle = "rgba(228,40,60,0.4)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// initial sizing
resizeCanvasForDPR();
