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

// ---------- audio editor refs ----------
const editorPanel = document.getElementById("editor-panel");
const trimCanvas = document.getElementById("trim-canvas");
const trimCtx = trimCanvas.getContext("2d");
const trimStartEl = document.getElementById("trim-start");
const trimEndEl = document.getElementById("trim-end");
const btnResetTrim = document.getElementById("btn-reset-trim");
const fadeInEl = document.getElementById("fade-in");
const fadeOutEl = document.getElementById("fade-out");
const reverseToggle = document.getElementById("reverse-toggle");
const normalizeToggle = document.getElementById("normalize-toggle");
const eqBassEl = document.getElementById("eq-bass");
const eqMidEl = document.getElementById("eq-mid");
const eqTrebleEl = document.getElementById("eq-treble");
const eqBassValueEl = document.getElementById("eq-bass-value");
const eqMidValueEl = document.getElementById("eq-mid-value");
const eqTrebleValueEl = document.getElementById("eq-treble-value");
const btnExport = document.getElementById("btn-export");
const exportStatusEl = document.getElementById("export-status");

let originalBuffer = null; // decoded AudioBuffer of the loaded file, used for editing
let bassFilter = null, midFilter = null, trebleFilter = null;
let trimDragTarget = null; // "start" | "end" | null, while dragging on the trim canvas

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

  // 3-band EQ, live — the same filters are re-created (with the same
  // gain values) during export, so what you hear while previewing is
  // what ends up in the downloaded file
  bassFilter = audioCtx.createBiquadFilter();
  bassFilter.type = "lowshelf";
  bassFilter.frequency.value = 200;
  midFilter = audioCtx.createBiquadFilter();
  midFilter.type = "peaking";
  midFilter.frequency.value = 1000;
  midFilter.Q.value = 0.7;
  trebleFilter = audioCtx.createBiquadFilter();
  trebleFilter.type = "highshelf";
  trebleFilter.frequency.value = 4000;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.82;
  freqData = new Uint8Array(analyser.frequencyBinCount);
  timeData = new Uint8Array(analyser.fftSize);

  sourceNode.connect(gainNode);
  gainNode.connect(bassFilter);
  bassFilter.connect(midFilter);
  midFilter.connect(trebleFilter);
  trebleFilter.connect(analyser);
  analyser.connect(audioCtx.destination);
  gainNode.gain.value = parseFloat(volumeEl.value);

  bassFilter.gain.value = parseFloat(eqBassEl.value);
  midFilter.gain.value = parseFloat(eqMidEl.value);
  trebleFilter.gain.value = parseFloat(eqTrebleEl.value);
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

  // decode a separate copy for editing — the <audio> element handles
  // playback/visualization, this buffer is what gets sliced and exported
  setupWebAudioGraph();
  exportStatusEl.textContent = "";
  exportStatusEl.className = "mono export-status";
  file.arrayBuffer()
    .then((buf) => audioCtx.decodeAudioData(buf))
    .then((decoded) => {
      originalBuffer = decoded;
      trimStartEl.value = "0";
      trimEndEl.value = decoded.duration.toFixed(2);
      trimStartEl.max = decoded.duration.toFixed(2);
      trimEndEl.max = decoded.duration.toFixed(2);
      editorPanel.classList.remove("hidden");
      resizeTrimCanvasForDPR();
      drawTrimWaveform();
    })
    .catch(() => {
      // editing needs a decodable buffer; playback/visualizer still work
      // fine even if this fails, so we just leave the editor panel hidden
      editorPanel.classList.add("hidden");
    });
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

// ---------- EQ (live preview) ----------
eqBassEl.addEventListener("input", () => {
  if (bassFilter) bassFilter.gain.value = parseFloat(eqBassEl.value);
  eqBassValueEl.textContent = `${eqBassEl.value} dB`;
});
eqMidEl.addEventListener("input", () => {
  if (midFilter) midFilter.gain.value = parseFloat(eqMidEl.value);
  eqMidValueEl.textContent = `${eqMidEl.value} dB`;
});
eqTrebleEl.addEventListener("input", () => {
  if (trebleFilter) trebleFilter.gain.value = parseFloat(eqTrebleEl.value);
  eqTrebleValueEl.textContent = `${eqTrebleEl.value} dB`;
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

// ============================================================
// TRIM WAVEFORM — a static peaks overview of the whole file, with the
// selected [start, end] region highlighted. Click or drag to adjust
// whichever endpoint is closer.
// ============================================================
function resizeTrimCanvasForDPR() {
  const dpr = window.devicePixelRatio || 1;
  const rect = trimCanvas.getBoundingClientRect();
  trimCanvas.width = rect.width * dpr;
  trimCanvas.height = rect.height * dpr;
  trimCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", () => {
  if (originalBuffer) { resizeTrimCanvasForDPR(); drawTrimWaveform(); }
});

function drawTrimWaveform() {
  if (!originalBuffer) return;
  const w = trimCanvas.clientWidth;
  const h = trimCanvas.clientHeight;
  trimCtx.clearRect(0, 0, w, h);

  // peaks, downsampled across the canvas width
  const data = originalBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / w));
  trimCtx.fillStyle = "#3a3a42";
  for (let x = 0; x < w; x++) {
    let min = 1, max = -1;
    const base = x * step;
    for (let i = 0; i < step; i++) {
      const v = data[base + i] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const yMin = (1 - (max + 1) / 2) * h;
    const yMax = (1 - (min + 1) / 2) * h;
    trimCtx.fillRect(x, yMin, 1, Math.max(1, yMax - yMin));
  }

  // selected-region highlight
  const dur = originalBuffer.duration;
  const start = Math.max(0, Math.min(dur, parseFloat(trimStartEl.value) || 0));
  const end = Math.max(start, Math.min(dur, parseFloat(trimEndEl.value) || dur));
  const xStart = (start / dur) * w;
  const xEnd = (end / dur) * w;

  trimCtx.fillStyle = "rgba(228,40,60,0.16)";
  trimCtx.fillRect(xStart, 0, xEnd - xStart, h);
  trimCtx.fillStyle = "#FF4D67";
  trimCtx.fillRect(xStart - 1.5, 0, 3, h);
  trimCtx.fillRect(xEnd - 1.5, 0, 3, h);
}

function trimPointFromEvent(e) {
  const rect = trimCanvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  return (x / rect.width) * originalBuffer.duration;
}

trimCanvas.addEventListener("mousedown", (e) => {
  if (!originalBuffer) return;
  const t = trimPointFromEvent(e);
  const start = parseFloat(trimStartEl.value) || 0;
  const end = parseFloat(trimEndEl.value) || originalBuffer.duration;
  trimDragTarget = Math.abs(t - start) <= Math.abs(t - end) ? "start" : "end";
  updateTrimFromDrag(t);
});
window.addEventListener("mousemove", (e) => {
  if (!trimDragTarget || !originalBuffer) return;
  updateTrimFromDrag(trimPointFromEvent(e));
});
window.addEventListener("mouseup", () => { trimDragTarget = null; });

function updateTrimFromDrag(t) {
  if (trimDragTarget === "start") {
    const end = parseFloat(trimEndEl.value) || originalBuffer.duration;
    trimStartEl.value = Math.min(t, end).toFixed(2);
  } else {
    const start = parseFloat(trimStartEl.value) || 0;
    trimEndEl.value = Math.max(t, start).toFixed(2);
  }
  drawTrimWaveform();
}

trimStartEl.addEventListener("input", drawTrimWaveform);
trimEndEl.addEventListener("input", drawTrimWaveform);
btnResetTrim.addEventListener("click", () => {
  if (!originalBuffer) return;
  trimStartEl.value = "0";
  trimEndEl.value = originalBuffer.duration.toFixed(2);
  drawTrimWaveform();
});

// ============================================================
// EXPORT — slice, reverse, fade, EQ (offline render), normalize, then
// encode to a standard 16-bit PCM WAV file for download. The original
// file/buffer is never modified; this always produces a new file.
// ============================================================
function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const bufferArr = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bufferArr);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let ch = 0; ch < numCh; ch++) channels.push(buffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([bufferArr], { type: "audio/wav" });
}

btnExport.addEventListener("click", async () => {
  if (!originalBuffer) return;
  btnExport.disabled = true;
  exportStatusEl.className = "mono export-status";
  exportStatusEl.textContent = "Procesando…";

  try {
    const sr = originalBuffer.sampleRate;
    const numCh = originalBuffer.numberOfChannels;
    const dur = originalBuffer.duration;
    const start = Math.max(0, Math.min(dur, parseFloat(trimStartEl.value) || 0));
    const end = Math.max(start + 0.01, Math.min(dur, parseFloat(trimEndEl.value) || dur));
    const startSample = Math.floor(start * sr);
    const endSample = Math.floor(end * sr);
    const sliceLen = Math.max(1, endSample - startSample);

    // 1. slice
    const sliced = audioCtx.createBuffer(numCh, sliceLen, sr);
    for (let ch = 0; ch < numCh; ch++) {
      const src = originalBuffer.getChannelData(ch).subarray(startSample, endSample);
      sliced.copyToChannel(new Float32Array(src), ch);
    }

    // 2. reverse
    if (reverseToggle.checked) {
      for (let ch = 0; ch < numCh; ch++) {
        const data = sliced.getChannelData(ch);
        data.reverse();
        sliced.copyToChannel(data, ch);
      }
    }

    // 3. fades
    const fadeInSamples = Math.min(sliceLen, Math.floor((parseFloat(fadeInEl.value) || 0) * sr));
    const fadeOutSamples = Math.min(sliceLen, Math.floor((parseFloat(fadeOutEl.value) || 0) * sr));
    for (let ch = 0; ch < numCh; ch++) {
      const data = sliced.getChannelData(ch);
      for (let i = 0; i < fadeInSamples; i++) data[i] *= i / fadeInSamples;
      for (let i = 0; i < fadeOutSamples; i++) data[sliceLen - 1 - i] *= i / fadeOutSamples;
      sliced.copyToChannel(data, ch);
    }

    // 4. EQ, rendered offline with the same filter settings as the live preview
    const offlineCtx = new OfflineAudioContext(numCh, sliceLen, sr);
    const src = offlineCtx.createBufferSource();
    src.buffer = sliced;
    const bass = offlineCtx.createBiquadFilter();
    bass.type = "lowshelf"; bass.frequency.value = 200; bass.gain.value = parseFloat(eqBassEl.value);
    const mid = offlineCtx.createBiquadFilter();
    mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.7; mid.gain.value = parseFloat(eqMidEl.value);
    const treble = offlineCtx.createBiquadFilter();
    treble.type = "highshelf"; treble.frequency.value = 4000; treble.gain.value = parseFloat(eqTrebleEl.value);
    src.connect(bass); bass.connect(mid); mid.connect(treble); treble.connect(offlineCtx.destination);
    src.start(0);
    const rendered = await offlineCtx.startRendering();

    // 5. normalize
    if (normalizeToggle.checked) {
      let peak = 0;
      for (let ch = 0; ch < numCh; ch++) {
        const data = rendered.getChannelData(ch);
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
      }
      if (peak > 0.0001) {
        const scale = 0.98 / peak;
        for (let ch = 0; ch < numCh; ch++) {
          const data = rendered.getChannelData(ch);
          for (let i = 0; i < data.length; i++) data[i] *= scale;
          rendered.copyToChannel(data, ch);
        }
      }
    }

    // 6. encode + download
    const wavBlob = audioBufferToWav(rendered);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement("a");
    a.href = url;
    const baseName = (fileNameEl.textContent || "audio").replace(/\.[^.]+$/, "");
    a.download = `${baseName}-editado.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    exportStatusEl.textContent = "¡Listo! Descarga iniciada.";
    exportStatusEl.className = "mono export-status success";
  } catch (err) {
    exportStatusEl.textContent = "No se ha podido exportar. Prueba con otro archivo.";
    exportStatusEl.className = "mono export-status";
  } finally {
    btnExport.disabled = false;
  }
});
