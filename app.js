const app = {
  cvReady: false,
  pages: [],
  currentEdit: null,
  canvas: null,
  ctx: null,
  dragPoint: null,
  dragRadius: 30,
  
  // DIN-Formate in Pixel bei 300 DPI
  DIN_SIZES: {
    A3: [3508, 4961],
    A4: [2480, 3508],
    A5: [1748, 2480],
    A6: [1240, 1748]
  },
  
  init() {
    this.canvas = document.getElementById('editorCanvas');
    this.ctx = this.canvas.getContext('2d');
    
    // Touch/Mouse Events für Ecken
    this.canvas.addEventListener('mousedown', e => this.handleStart(e));
    this.canvas.addEventListener('mousemove', e => this.handleMove(e));
    this.canvas.addEventListener('mouseup', () => this.handleEnd());
    this.canvas.addEventListener('touchstart', e => this.handleStart(e.touches[0]));
    this.canvas.addEventListener('touchmove', e => { e.preventDefault(); this.handleMove(e.touches[0]); });
    this.canvas.addEventListener('touchend', () => this.handleEnd());
    
    this.updateStatus();
  },
  
  updateStatus() {
    const badge = document.getElementById('statusBadge');
    if (!navigator.onLine) {
      badge.textContent = 'Offline';
      badge.className = 'status-badge offline';
    } else if (this.cvReady) {
      badge.textContent = 'Bereit';
      badge.className = 'status-badge ready';
    }
  },
  
  onOpenCvReady() {
    this.cvReady = true;
    this.updateStatus();
    console.log('OpenCV.js geladen');
  },
  
  showProcessing(text) {
    document.getElementById('processing').style.display = 'flex';
    document.getElementById('processingText').textContent = text;
  },
  
  hideProcessing() {
    document.getElementById('processing').style.display = 'none';
  },
  
  // ========== BILD AUFNAHME ==========
  
  startCamera() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = e => this.handleFileSelect(e);
    input.click();
  },
  
  addPage() {
    this.startCamera();
  },
  
  handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = evt => this.loadImage(evt.target.result);
    reader.readAsDataURL(file);
  },
  
  loadImage(src) {
    const img = new Image();
    img.onload = () => {
      this.showProcessing('Erkenne Dokument...');
      setTimeout(() => this.autoDetect(img), 100);
    };
    img.src = src;
  },
  
  // ========== AUTO DETECT (OpenCV) ==========
  
  autoDetect(img) {
    if (!this.cvReady) {
      alert('OpenCV wird noch geladen... bitte warten');
      this.hideProcessing();
      return;
    }
    
    try {
      const cv = window.cv;
      
      // Bild in Mat konvertieren
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      const src = cv.imread(canvas);
      const workSize = 800;
      const scale = workSize / img.width;
      const scaledH = Math.round(img.height * scale);
      
      const resized = new cv.Mat();
      cv.resize(src, resized, new cv.Size(workSize, scaledH));
      
      // Grayscale + Blur + Canny
      const gray = new cv.Mat();
      cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);
      
      const blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
      
      const edges = new cv.Mat();
      cv.Canny(blurred, edges, 50, 150);
      
      // Konturen
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      
      // Größte 4-Eck-Kontur finden
      let docContour = null;
      let maxArea = 0;
      
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < 10000) continue; // Zu klein
        
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
      
      // Cleanup
      src.delete(); resized.delete(); gray.delete(); 
      blurred.delete(); edges.delete(); contours.delete(); hierarchy.delete();
      
      // Fallback: Bildränder
      if (!docContour) {
        docContour = [
          {x: 50, y: 50},
          {x: img.width - 50, y: 50},
          {x: img.width - 50, y: img.height - 50},
          {x: 50, y: img.height - 50}
        ];
      }
      
      this.hideProcessing();
      this.openEditor(img, docContour);
      
    } catch (err) {
      console.error(err);
      this.hideProcessing();
      alert('Fehler bei Erkennung. Bitte manuell zuschneiden.');
      this.openEditor(img, [
        {x: 50, y: 50},
        {x: img.width - 50, y: 50},
        {x: img.width - 50, y: img.height - 50},
        {x: 50, y: img.height - 50}
      ]);
    }
  },
  
  orderPoints(pts) {
    // Sortiert: TL, TR, BR, BL
    const rect = [{}, {}, {}, {}];
    const s = pts.map(p => p.x + p.y);
    const diff = pts.map(p => p.y - p.x);
    
    rect[0] = pts[s.indexOf(Math.min(...s))]; // TL
    rect[2] = pts[s.indexOf(Math.max(...s))]; // BR
    rect[1] = pts[diff.indexOf(Math.min(...diff))]; // TR
    rect[3] = pts[diff.indexOf(Math.max(...diff))]; // BL
    
    return rect;
  },
  
  detectDIN(width, height) {
    const ratio = Math.max(width, height) / Math.min(width, height);
    const area = width * height;
    
    // DIN hat ~1.414, Unterscheidung über Fläche
    if (Math.abs(ratio - 1.414) < 0.2) {
      if (area > 30000000) return 'A3';
      if (area > 15000000) return 'A4';
      if (area > 8000000) return 'A5';
      return 'A6';
    }
    return 'A4';
  },
  
  // ========== EDITOR ==========
  
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
    
    // Auto-Format im Dropdown setzen
    const select = document.getElementById('dinSelect');
    select.value = 'auto';
    
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('editorScreen').style.display = 'flex';
    
    this.drawEditor();
  },
  
  drawEditor() {
    if (!this.currentEdit) return;
    
    const container = document.getElementById('canvasContainer');
    const img = this.currentEdit.image;
    
    // Canvas-Größe = Container-Größe, skaliert proportional
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    const scale = Math.min(containerW / img.width, containerH / img.height);
    
    this.canvas.width = img.width * scale;
    this.canvas.height = img.height * scale;
    this.displayScale = scale;
    
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Bild zeichnen
    ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
    
    // Overlay (dunkel außerhalb des Quads)
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Maske für Dokument-Bereich
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    const c = this.currentEdit.corners;
    ctx.moveTo(c[0].x * scale, c[0].y * scale);
    ctx.lineTo(c[1].x * scale, c[1].y * scale);
    ctx.lineTo(c[2].x * scale, c[2].y * scale);
    ctx.lineTo(c[3].x * scale, c[3].y * scale);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    
    // Bild nochmal nur im Bereich zeichnen (heller)
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
    
    // Linien
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c[0].x * scale, c[0].y * scale);
    ctx.lineTo(c[1].x * scale, c[1].y * scale);
    ctx.lineTo(c[2].x * scale, c[2].y * scale);
    ctx.lineTo(c[3].x * scale, c[3].y * scale);
    ctx.closePath();
    ctx.stroke();
    
    // Ecken
    c.forEach((pt, i) => {
      const x = pt.x * scale;
      const y = pt.y * scale;
      
      // Kreis
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#3b82f6';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Label
      ctx.fillStyle = 'white';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(['TL','TR','BR','BL'][i], x, y);
    });
  },
  
  // ========== INTERAKTION ==========
  
  getMousePos(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = evt.clientX || (evt.touches && evt.touches[0].clientX);
    const clientY = evt.clientY || (evt.touches && evt.touches[0].clientY);
    return {
      x: (clientX - rect.left),
      y: (clientY - rect.top)
    };
  },
  
  handleStart(evt) {
    if (!this.currentEdit) return;
    const pos = this.getMousePos(evt);
    const scale = this.displayScale;
    
    // Prüfe welcher Punkt getroffen
    for (let i = 0; i < 4; i++) {
      const pt = this.currentEdit.corners[i];
      const dx = pos.x - pt.x * scale;
      const dy = pos.y - pt.y * scale;
      if (Math.hypot(dx, dy) < this.dragRadius * 1.5) {
        this.dragPoint = i;
        this.canvas.style.cursor = 'grabbing';
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
    this.canvas.style.cursor = 'default';
  },
  
  resetCorners() {
    if (!this.currentEdit) return;
    const img = this.currentEdit.image;
    this.currentEdit.corners = [
      {x: 50, y: 50},
      {x: img.width - 50, y: 50},
      {x: img.width - 50, y: img.height - 50},
      {x: 50, y: img.height - 50}
    ];
    this.drawEditor();
  },
  
  rotateImage() {
    if (!this.currentEdit) return;
    this.currentEdit.rotation = (this.currentEdit.rotation + 90) % 360;
    // Einfacher Ansatz: Canvas rotieren und neu erkennen
    alert('Rotation wird beim Übernehmen angewendet');
  },
  
  onDinChange() {
    // Wird beim Übernehmen berücksichtigt
  },
  
  cancelEdit() {
    this.currentEdit = null;
    document.getElementById('editorScreen').style.display = 'none';
    document.getElementById('startScreen').style.display = 'flex';
  },
  
  // ========== TRANSFORM & ENHANCE ==========
  
  confirmPage() {
    if (!this.currentEdit) return;
    this.showProcessing('Transformiere & optimiere...');
    
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
        
        document.getElementById('editorScreen').style.display = 'none';
        document.getElementById('startScreen').style.display = 'flex';
        document.getElementById('exportBar').style.display = 'flex';
        this.hideProcessing();
        
      } catch (err) {
        console.error(err);
        this.hideProcessing();
        alert('Fehler bei Verarbeitung');
      }
    }, 100);
  },
  
  transformAndEnhance() {
    const cv = window.cv;
    const { image, corners, detectedFormat } = this.currentEdit;
    const mode = document.getElementById('modeSelect').value;
    const dinSelect = document.getElementById('dinSelect').value;
    const format = dinSelect === 'auto' ? detectedFormat : dinSelect;
    
    // Bild in Mat
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const src = cv.imread(canvas);
    
    // Zielgröße
    const [targetW, targetH] = this.DIN_SIZES[format];
    
    // Perspektiv-Transformation
    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y,
      corners[1].x, corners[1].y,
      corners[2].x, corners[2].y,
      corners[3].x, corners[3].y
    ]);
    
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      targetW, 0,
      targetW, targetH,
      0, targetH
    ]);
    
    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(targetW, targetH), cv.INTER_CUBIC);
    
    // Enhancement je nach Modus
    let final = dst;
    
    if (mode === 'scores') {
      final = this.enhanceScores(dst);
    } else if (mode === 'document') {
      final = this.enhanceDocument(dst);
    }
    // photo = keine Veränderung
    
    // In Canvas exportieren
    const outCanvas = document.createElement('canvas');
    outCanvas.width = final.cols;
    outCanvas.height = final.rows;
    cv.imshow(outCanvas, final);
    
    // Cleanup
    src.delete(); srcTri.delete(); dstTri.delete(); 
    M.delete(); dst.delete();
    if (final !== dst) final.delete();
    
    return {
      dataUrl: outCanvas.toDataURL('image/jpeg', 0.95),
      format: format,
      width: targetW,
      height: targetH
    };
  },
  
  enhanceScores(imgMat) {
    const cv = window.cv;
    
    // LAB Farbraum für besseren Kontrast
    const lab = new cv.Mat();
    cv.cvtColor(imgMat, lab, cv.COLOR_BGR2Lab);
    const labPlanes = new cv.MatVector();
    cv.split(lab, labPlanes);
    
    // CLAHE auf L-Kanal
    const clahe = cv.createCLAHE(2.0, new cv.Size(8, 8));
    const enhancedL = new cv.Mat();
    clahe.apply(labPlanes.get(0), enhancedL);
    labPlanes.set(0, enhancedL);
    
    const merged = new cv.Mat();
    cv.merge(labPlanes, merged);
    const result = new cv.Mat();
    cv.cvtColor(merged, result, cv.COLOR_Lab2BGR);
    
    // Leicht schärfen (Unsharp Mask)
    const blurred = new cv.Mat();
    cv.GaussianBlur(result, blurred, new cv.Size(0, 0), 3);
    const sharpened = new cv.Mat();
    cv.addWeighted(result, 1.5, blurred, -0.5, 0, sharpened);
    
    // Cleanup
    lab.delete(); labPlanes.delete(); enhancedL.delete();
    merged.delete(); result.delete(); blurred.delete();
    clahe.delete();
    
    return sharpened;
  },
  
  enhanceDocument(imgMat) {
    const cv = window.cv;
    
    const gray = new cv.Mat();
    cv.cvtColor(imgMat, gray, cv.COLOR_BGR2GRAY);
    
    const binary = new cv.Mat();
    cv.adaptiveThreshold(gray, binary, 255, 
      cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);
    
    const result = new cv.Mat();
    cv.cvtColor(binary, result, cv.COLOR_GRAY2BGR);
    
    gray.delete(); binary.delete();
    return result;
  },
  
  // ========== SEITEN-LEISTE ==========
  
  renderPagesStrip() {
    const strip = document.getElementById('pagesStrip');
    // Behalte den Add-Button
    const addBtn = strip.querySelector('.add-page-btn');
    strip.innerHTML = '';
    
    this.pages.forEach((page, idx) => {
      const div = document.createElement('div');
      div.className = 'page-thumb';
      div.innerHTML = `
        <img src="${page.src}" onclick="app.previewPage(${idx})">
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
      document.getElementById('exportBar').style.display = 'none';
    }
    this.renderPagesStrip();
  },
  
  previewPage(idx) {
    document.getElementById('previewImg').src = this.pages[idx].src;
    document.getElementById('previewModal').style.display = 'flex';
  },
  
  closePreview() {
    document.getElementById('previewModal').style.display = 'none';
  },
  
  clearAll() {
    if (!confirm('Alle Seiten löschen?')) return;
    this.pages = [];
    this.renderPagesStrip();
    document.getElementById('exportBar').style.display = 'none';
  },
  
  // ========== PDF EXPORT ==========
  
  async exportPDF() {
    if (this.pages.length === 0) return;
    this.showProcessing('Erzeuge PDF...');
    
    try {
      const { PDFDocument, PageSizes } = PDFLib;
      const pdfDoc = await PDFDocument.create();
      
      for (const page of this.pages) {
        // Bild laden
        const imgData = page.src.split(',')[1];
        const imgBytes = Uint8Array.from(atob(imgData), c => c.charCodeAt(0));
        
        // JPEG einbetten (Noten sind oft besser als JPEG als PNG bei dieser Qualität)
        const jpgImage = await pdfDoc.embedJpg(imgBytes);
        
        // Seitengröße
        const sizeKey = page.format; // A4, A3, etc.
        const pageSize = PageSizes[sizeKey];
        
        const pdfPage = pdfDoc.addPage(pageSize);
        
        // Bild skalieren um auf Seite zu passen (mit kleinem Rand)
        const margin = 0;
        const pw = pageSize[0] - margin * 2;
        const ph = pageSize[1] - margin * 2;
        const scale = Math.min(pw / jpgImage.width, ph / jpgImage.height);
        const w = jpgImage.width * scale;
        const h = jpgImage.height * scale;
        const x = (pageSize[0] - w) / 2;
        const y = (pageSize[1] - h) / 2;
        
        pdfPage.drawImage(jpgImage, { x, y, width: w, height: h });
      }
      
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      
      // Download
      const a = document.createElement('a');
      a.href = url;
      a.download = `Noten_${new Date().toISOString().slice(0,10)}.pdf`;
      a.click();
      
      // Teilen (wenn möglich)
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], a.download, { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'Gescannte Noten',
            files: [file]
          });
        }
      }
      
      URL.revokeObjectURL(url);
      this.hideProcessing();
      
    } catch (err) {
      console.error(err);
      this.hideProcessing();
      alert('Fehler beim PDF-Export');
    }
  }
};

// Init
document.addEventListener('DOMContentLoaded', () => app.init());