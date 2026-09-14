const app = {
  cvReady: false,
  pages: [],
  currentEdit: null,
  canvas: null,
  ctx: null,
  dragPoint: null,
  dragRadius: 30,

  DIN_SIZES: {
    A3: [3508, 4961],
    A4: [2480, 3508],
    A5: [1748, 2480],
    A6: [1240, 1748]
  },

  init() {
    this.canvas = document.getElementById("editorCanvas");
    this.ctx = this.canvas.getContext("2d");

    this.canvas.addEventListener("mousedown", (e) => this.handleStart(e));
    this.canvas.addEventListener("mousemove", (e) => this.handleMove(e));
    this.canvas.addEventListener("mouseup", () => this.handleEnd());
    this.canvas.addEventListener("touchstart", (e) => this.handleStart(e.touches[0]));
    this.canvas.addEventListener("touchmove", (e) => { e.preventDefault(); this.handleMove(e.touches[0]); });
    this.canvas.addEventListener("touchend", () => this.handleEnd());

    this.updateStatus();
  },

  updateStatus() {
    const badge = document.getElementById("statusBadge");
    if (!navigator.onLine) {
      badge.textContent = "Offline";
      badge.className = "status-badge offline";
    } else if (this.cvReady) {
      badge.textContent = "Bereit";
      badge.className = "status-badge ready";
    }
  },

  onOpenCvReady() {
    this.cvReady = true;
    this.updateStatus();
    console.log("OpenCV.js geladen");
  },

  showProcessing(text) {
    document.getElementById("processing").style.display = "flex";
    document.getElementById("processingText").textContent = text;
  },

  hideProcessing() {
    document.getElementById("processing").style.display = "none";
  },

  startCamera() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.onchange = (e) => this.handleFileSelect(e);
    input.click();
  },

  addPage() {
    this.startCamera();
  },

  handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => this.loadImage(evt.target.result);
    reader.readAsDataURL(file);
  },

  loadImage(src) {
    const img = new Image();
    img.onload = () => {
      this.showProcessing("Erkenne Dokument...");
      setTimeout(() => this.autoDetect(img), 100);
    };
    img.src = src;
  },

  autoDetect(img) {
    if (!this.cvReady || !window.cv) {
      console.warn("OpenCV nicht bereit, überspringe Auto-Detect");
      this.hideProcessing();
      this.openEditor(img, [
        { x: 50, y: 50 },
        { x: img.width - 50, y: 50 },
        { x: img.width - 50, y: img.height - 50 },
        { x: 50, y: img.height - 50 }
      ]);
      return;
    }

    try {
      const cv = window.cv;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);

      const src = cv.imread(canvas);
      const workSize = 800;
      const scale = workSize / img.width;
      const scaledH = Math.round(img.height * scale);

      const resized = new cv.Mat();
      cv.resize(src, resized, new cv.Size(workSize, scaledH));

      const gray = new cv.Mat();
      cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);

      const blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      const edges = new cv.Mat();
      cv.Canny(blurred, edges, 50, 150);

      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      let docContour = null;
      let maxArea = 0;

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < 10000) continue;

        const peri = cv.arcLength(cnt, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

        if (approx.rows === 4 && area > maxArea) {
          maxArea = area;
          const pts = [];
          for (let j = 0; j < 4; j++) {
            pts.push({
              x: approx.data32S[j * 2] / scale,
              y: approx.data32S[j * 2 + 1] / scale
            });
          }
          docContour = this.orderPoints(pts);
          approx.delete();
        } else {
          approx.delete();
        }
      }

      src.delete(); resized.delete(); gray.delete();
      blurred.delete(); edges.delete(); contours.delete(); hierarchy.delete();

      if (!docContour) {
        docContour = [
          { x: 50, y: 50 },
          { x: img.width - 50, y: 50 },
          { x: img.width - 50, y: img.height - 50 },
          { x: 50, y: img.height - 50 }
        ];
      }

      this.hideProcessing();
      this.openEditor(img, docContour);

    } catch (err) {
      console.error("Auto-Detect Fehler:", err);
      this.hideProcessing();
      this.openEditor(img, [
        { x: 50, y: 50 },
        { x: img.width - 50, y: 50 },
        { x: img.width - 50, y: img.height - 50 },
        { x: 50, y: img.height - 50 }
      ]);
    }
  },

  orderPoints(pts) {
    const rect = [{}, {}, {}, {}];
    const s = pts.map((p) => p.x + p.y);
    const diff = pts.map((p) => p.y - p.x);
    rect[0] = pts[s.indexOf(Math.min(...s))];
    rect[2] = pts[s.indexOf(Math.max(...s))];
    rect[1] = pts[diff.indexOf(Math.min(...diff))];
    rect[3] = pts[diff.indexOf(Math.max(...diff))];
    return rect;
  },

  detectDIN(width, height) {
    const ratio = Math.max(width, height) / Math.min(width, height);
    const area = width * height;
    if (Math.abs(ratio - 1.414) < 0.2) {
      if (area > 30000000) return "A3";
      if (area > 15000000) return "A4";
      if (area > 8000000) return "A5";
      return "A6";
    }
    return "A4";
  },

  openEditor(img, corners) {
    this.currentEdit = {
      image: img,
      corners: corners,
      rotation: 0,
      detectedFormat: this.detectDIN(
        Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y),
        Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y)
      )
    };
    document.getElementById("dinSelect").value = "auto";
    document.getElementById("startScreen").style.display = "none";
    document.getElementById("editorScreen").style.display = "flex";
    this.drawEditor();
  },

  drawEditor() {
    if (!this.currentEdit) return;
    const container = document.getElementById("canvasContainer");
    const img = this.currentEdit.image;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    const scale = Math.min(containerW / img.width, containerH / img.height);

    this.canvas.width = img.width * scale;
    this.canvas.height = img.height * scale;
    this.displayScale = scale;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    const c = this.currentEdit.corners;
    ctx.moveTo(c[0].x * scale, c[0].y * scale);
    ctx.lineTo(c[1].x * scale, c[1].y * scale);
    ctx.lineTo(c[2].x * scale, c[2].y * scale);
    ctx.lineTo(c[3].x * scale, c[3].y * scale);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(c[0].x * scale, c[0].y * scale);
    ctx.lineTo(c[1].x * scale, c[1].y * scale);
    ctx.lineTo(c[2].x * scale, c[2].y * scale);
    ctx.lineTo(c[3].x * scale, c[3].y * scale);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();

    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c[0].x * scale, c[0].y * scale);
    ctx.lineTo(c[1].x * scale, c[1].y * scale);
    ctx.lineTo(c[2].x * scale, c[2].y * scale);
    ctx.lineTo(c[3].x * scale, c[3].y * scale);
    ctx.closePath();
    ctx.stroke();

    c.forEach((pt, i) => {
      const x = pt.x * scale;
      const y = pt.y * scale;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = "#3b82f6";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "white";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(["TL", "TR", "BR", "BL"][i], x, y);
    });
  },

  getMousePos(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = evt.clientX || (evt.touches && evt.touches[0].clientX);
    const clientY = evt.clientY || (evt.touches && evt.touches[0].clientY);
    return { x: clientX - rect.left, y: clientY - rect.top };
  },

  handleStart(evt) {
    if (!this.currentEdit) return;
    const pos = this.getMousePos(evt);
    const scale = this.displayScale;
    for (let i = 0; i < 4; i++) {
      const pt = this.currentEdit.corners[i];
      const dx = pos.x - pt.x * scale;
      const dy = pos.y - pt.y * scale;
      if (Math.hypot(dx, dy) < this.dragRadius * 1.5) {
        this.dragPoint = i;
        this.canvas.style.cursor = "grabbing";
        return;
      }
    }
  },

  handleMove(evt) {
    if (this.dragPoint === null || !this.currentEdit) return;
    const pos = this.getMousePos(evt);
    const scale = this.displayScale;
    this.currentEdit.corners[this.dragPoint] = {
      x: Math.max(0, Math.min(this.currentEdit.image.width, pos.x / scale)),
      y: Math.max(0, Math.min(this.currentEdit.image.height, pos.y / scale))
    };
    this.drawEditor();
  },

  handleEnd() {
    this.dragPoint = null;
    this.canvas.style.cursor = "default";
  },

  resetCorners() {
    if (!this.currentEdit) return;
    const img = this.currentEdit.image;
    this.currentEdit.corners = [
      { x: 50, y: 50 },
      { x: img.width - 50, y: 50 },
      { x: img.width - 50, y: img.height - 50 },
      { x: 50, y: img.height - 50 }
    ];
    this.drawEditor();
  },

  rotateImage() {
    if (!this.currentEdit) return;
    this.currentEdit.rotation = (this.currentEdit.rotation + 90) % 360;
    alert("Rotation wird beim Übernehmen angewendet");
  },

  onDinChange() {},

  cancelEdit() {
    this.currentEdit = null;
    document.getElementById("editorScreen").style.display = "none";
    document.getElementById("startScreen").style.display = "flex";
  },

  confirmPage() {
    if (!this.currentEdit) return;
    this.showProcessing("Transformiere & optimiere...");

    setTimeout(() => {
      try {
        const result = this.transformAndEnhance();
        this.pages.push({
          id: Date.now(),
          src: result.dataUrl,
          format: result.format,
          width: result.width,
          height: result.height
        });

        this.renderPagesStrip();
        this.currentEdit = null;
        document.getElementById("editorScreen").style.display = "none";
        document.getElementById("startScreen").style.display = "flex";
        document.getElementById("exportBar").style.display = "flex";
        this.hideProcessing();
      } catch (err) {
        console.error("Fehler in confirmPage:", err);
        this.hideProcessing();
        alert("Fehler bei Verarbeitung: " + err.message);
      }
    }, 100);
  },

  // ========== HAUPTFUNKTION MIT FALLBACK ==========
  transformAndEnhance() {
    const { image, corners, detectedFormat } = this.currentEdit;
    const mode = document.getElementById("modeSelect").value;
    const dinSelect = document.getElementById("dinSelect").value;
    const format = dinSelect === "auto" ? detectedFormat : dinSelect;
    const [targetW, targetH] = this.DIN_FORMATS[format];

    // Versuche zuerst OpenCV (beste Qualität)
    if (this.cvReady && window.cv && window.cv.imread) {
      try {
        return this.transformWithOpenCV(image, corners, targetW, targetH, format, mode);
      } catch (err) {
        console.warn("OpenCV-Pfad fehlgeschlagen, nutze Canvas-Fallback:", err);
      }
    }

    // Fallback: Canvas-only (immer funktioniert)
    return this.transformWithCanvas(image, corners, targetW, targetH, format, mode);
  },

  transformWithOpenCV(image, corners, targetW, targetH, format, mode) {
    const cv = window.cv;
    let src = null, srcTri = null, dstTri = null, M = null, dst = null, final = null;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);

      src = cv.imread(canvas);
      if (!src || src.empty()) throw new Error("Bild konnte nicht geladen werden");

      srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        corners[0].x, corners[0].y,
        corners[1].x, corners[1].y,
        corners[2].x, corners[2].y,
        corners[3].x, corners[3].y
      ]);

      dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0, targetW, 0, targetW, targetH, 0, targetH
      ]);

      M = cv.getPerspectiveTransform(srcTri, dstTri);
      dst = new cv.Mat();
      cv.warpPerspective(src, dst, M, new cv.Size(targetW, targetH), cv.INTER_CUBIC);

      if (!dst || dst.empty()) throw new Error("Transformation fehlgeschlagen");

      final = dst;
      if (mode === "scores") {
        final = this.enhanceScores(dst);
      } else if (mode === "document") {
        final = this.enhanceDocument(dst);
      }

      if (!final || final.empty()) throw new Error("Verbesserung fehlgeschlagen");

      const outCanvas = document.createElement("canvas");
      outCanvas.width = final.cols;
      outCanvas.height = final.rows;
      cv.imshow(outCanvas, final);

      return {
        dataUrl: outCanvas.toDataURL("image/jpeg", 0.95),
        format: format,
        width: targetW,
        height: targetH
      };
    } finally {
      if (src) src.delete();
      if (srcTri) srcTri.delete();
      if (dstTri) dstTri.delete();
      if (M) M.delete();
      if (dst) dst.delete();
      if (final && final !== dst) final.delete();
    }
  },

  // ========== CANVAS FALLBACK (kein OpenCV nötig) ==========
  transformWithCanvas(image, corners, targetW, targetH, format, mode) {
    // Bounding Box der Ecken berechnen
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxX = Math.min(image.width, Math.ceil(Math.max(...xs)));
    const maxY = Math.min(image.height, Math.ceil(Math.max(...ys)));
    const cropW = maxX - minX;
    const cropH = maxY - minY;

    // Quell-Canvas: Zuschneiden
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = cropW;
    srcCanvas.height = cropH;
    const srcCtx = srcCanvas.getContext("2d");
    srcCtx.drawImage(image, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

    // Ziel-Canvas: DIN-Größe
    const dstCanvas = document.createElement("canvas");
    dstCanvas.width = targetW;
    dstCanvas.height = targetH;
    const dstCtx = dstCanvas.getContext("2d");

    // Weißer Hintergrund (falls das Bild nicht ganz passt)
    dstCtx.fillStyle = "#ffffff";
    dstCtx.fillRect(0, 0, targetW, targetH);

    // Skalieren und zentrieren (proportional)
    const scale = Math.min(targetW / cropW, targetH / cropH);
    const drawW = cropW * scale;
    const drawH = cropH * scale;
    const drawX = (targetW - drawW) / 2;
    const drawY = (targetH - drawH) / 2;

    dstCtx.drawImage(srcCanvas, drawX, drawY, drawW, drawH);

    // Sanfte Bildverbesserung mit Canvas API
    if (mode === "scores" || mode === "document") {
      this.enhanceCanvas(dstCtx, targetW, targetH, mode);
    }

    return {
      dataUrl: dstCanvas.toDataURL("image/jpeg", 0.95),
      format: format,
      width: targetW,
      height: targetH
    };
  },

  enhanceCanvas(ctx, w, h, mode) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    if (mode === "document") {
      // Graustufen + Kontrast für reine Dokumente
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        // Kontrast + Helligkeit
        const val = Math.min(255, Math.max(0, (gray - 128) * 1.35 + 128 + 5));
        data[i] = data[i + 1] = data[i + 2] = val;
      }
    } else {
      // Noten-Modus: nur leichter Kontrast & Helligkeit pro Kanal
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const val = Math.min(255, Math.max(0, (data[i + c] - 128) * 1.25 + 128 + 8));
          data[i + c] = val;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  },

  // ========== OPENCV ENHANCEMENT (nur wenn verfügbar) ==========
  enhanceScores(imgMat) {
    const cv = window.cv;
    let adjusted = null, blurred = null, sharpened = null;
    try {
      adjusted = new cv.Mat();
      imgMat.convertTo(adjusted, cv.CV_8UC3, 1.25, 8);

      blurred = new cv.Mat();
      cv.GaussianBlur(adjusted, blurred, new cv.Size(0, 0), 1.5);

      sharpened = new cv.Mat();
      cv.addWeighted(adjusted, 1.2, blurred, -0.2, 0, sharpened);
      return sharpened;
    } catch (e) {
      if (adjusted) adjusted.delete();
      if (blurred) blurred.delete();
      throw e;
    } finally {
      if (adjusted && adjusted !== sharpened) adjusted.delete();
      if (blurred) blurred.delete();
    }
  },

  enhanceDocument(imgMat) {
    const cv = window.cv;
    let gray = null, adjusted = null, result = null;
    try {
      gray = new cv.Mat();
      cv.cvtColor(imgMat, gray, cv.COLOR_BGR2GRAY);

      adjusted = new cv.Mat();
      gray.convertTo(adjusted, cv.CV_8UC1, 1.35, 5);

      result = new cv.Mat();
      cv.cvtColor(adjusted, result, cv.COLOR_GRAY2BGR);
      return result;
    } catch (e) {
      if (gray) gray.delete();
      if (adjusted) adjusted.delete();
      throw e;
    } finally {
      if (gray && gray !== result) gray.delete();
      if (adjusted && adjusted !== result) adjusted.delete();
    }
  },

  renderPagesStrip() {
    const strip = document.getElementById("pagesStrip");
    const addBtn = strip.querySelector(".add-page-btn");
    strip.innerHTML = "";

    this.pages.forEach((page, idx) => {
      const div = document.createElement("div");
      div.className = "page-thumb";
      div.innerHTML = `
        <img src="${page.src}" onclick="app.previewPage(${idx})" loading="lazy">
        <span class="page-num">${idx + 1}</span>
        <span class="delete-btn" onclick="event.stopPropagation(); app.deletePage(${idx})">×</span>
      `;
      strip.appendChild(div);
    });

    strip.appendChild(addBtn);
  },

  deletePage(idx) {
    this.pages.splice(idx, 1);
    if (this.pages.length === 0) {
      document.getElementById("exportBar").style.display = "none";
    }
    this.renderPagesStrip();
  },

  previewPage(idx) {
    document.getElementById("previewImg").src = this.pages[idx].src;
    document.getElementById("previewModal").style.display = "flex";
  },

  closePreview() {
    document.getElementById("previewModal").style.display = "none";
  },

  clearAll() {
    if (!confirm("Alle Seiten löschen?")) return;
    this.pages = [];
    this.renderPagesStrip();
    document.getElementById("exportBar").style.display = "none";
  },

  // ========== PDF EXPORT MIT SPEICHERORT ==========
  async exportPDF() {
    if (this.pages.length === 0) return;
    this.showProcessing("Erzeuge PDF...");

    try {
      const { PDFDocument, PageSizes } = PDFLib;
      const pdfDoc = await PDFDocument.create();

      for (const page of this.pages) {
        const imgData = page.src.split(",")[1];
        const imgBytes = Uint8Array.from(atob(imgData), (c) => c.charCodeAt(0));
        const jpgImage = await pdfDoc.embedJpg(imgBytes);

        const sizeKey = page.format;
        const pageSize = PageSizes[sizeKey];
        const pdfPage = pdfDoc.addPage(pageSize);

        const pw = pageSize[0];
        const ph = pageSize[1];
        const scale = Math.min(pw / jpgImage.width, ph / jpgImage.height);
        const w = jpgImage.width * scale;
        const h = jpgImage.height * scale;
        const x = (pageSize[0] - w) / 2;
        const y = (pageSize[1] - h) / 2;

        pdfPage.drawImage(jpgImage, { x, y, width: w, height: h });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });

      // Speicherort auswählen (File System Access API)
      if ("showSaveFilePicker" in window) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: `Noten_${new Date().toISOString().slice(0, 10)}.pdf`,
            types: [{
              description: "PDF-Dateien",
              accept: { "application/pdf": [".pdf"] }
            }]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          this.hideProcessing();
          return;
        } catch (err) {
          if (err.name === "AbortError") {
            this.hideProcessing();
            return;
          }
          console.warn("File Picker fehlgeschlagen, nutze Fallback:", err);
        }
      }

      // Fallback: Normaler Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Noten_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.hideProcessing();

    } catch (err) {
      console.error(err);
      this.hideProcessing();
      alert("Fehler beim PDF-Export: " + err.message);
    }
  }
};

document.addEventListener("DOMContentLoaded", () => app.init());
