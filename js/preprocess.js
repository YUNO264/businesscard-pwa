const CardPreprocess = (() => {
  const LOCAL_OPENCV_PATH = "./vendor/opencv.js";
  const OPENCV_CDN_URLS = [
    "https://docs.opencv.org/4.13.0/opencv.js",
    "https://docs.opencv.org/4.12.0/opencv.js",
    "https://cdn.jsdelivr.net/npm/opencv-browser@1.0.0/opencv.js"
  ];

  let cvPromise = null;
  let loadedSource = "";

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function fileExists(path) {
    try {
      const r = await fetch(path, { method: "GET", cache: "no-store" });
      return r.ok;
    } catch {
      return false;
    }
  }

  function normalizeCv(value) {
    if (value?.Mat) return value;
    if (window.cv?.Mat) return window.cv;
    if (window.Module?.Mat) return window.Module;
    return null;
  }

  async function unwrapCv(timeoutMs = 30000) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      try {
        if (window.cv instanceof Promise) {
          const resolved = await window.cv;
          const normalized = normalizeCv(resolved);
          if (normalized) {
            window.cv = normalized;
            return normalized;
          }
        }

        const normalized = normalizeCv(window.cv) || normalizeCv(window.Module);
        if (normalized) return normalized;
      } catch {}

      await sleep(80);
    }

    throw new Error("OpenCV.jsは読み込まれましたが、cv.Matが初期化されませんでした。");
  }

  function injectScript(src, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(s => s.src === new URL(src, location.href).href);
      if (existing) {
        resolve();
        return;
      }

      const oldModule = window.Module || {};
      let runtimeResolved = false;

      const runtimePromise = new Promise(runtimeResolve => {
        const oldRuntime = oldModule.onRuntimeInitialized;
        window.Module = {
          ...oldModule,
          onRuntimeInitialized() {
            try { oldRuntime?.(); } catch {}
            runtimeResolved = true;
            runtimeResolve();
          }
        };
      });

      const script = document.createElement("script");
      script.src = src;
      script.async = true;

      const timer = setTimeout(() => {
        reject(new Error(`OpenCV.js読込タイムアウト: ${src}`));
      }, timeoutMs);

      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`OpenCV.js読込失敗: ${src}`));
      };

      script.onload = async () => {
        try {
          // Current official OpenCV builds may expose `cv` as a Promise.
          // Older builds use Module.onRuntimeInitialized.
          if (!runtimeResolved) {
            await Promise.race([runtimePromise, sleep(1200)]);
          }
          await unwrapCv(20000);
          clearTimeout(timer);
          resolve();
        } catch (e) {
          clearTimeout(timer);
          reject(e);
        }
      };

      document.head.appendChild(script);
    });
  }

  async function loadCv() {
    if (normalizeCv(window.cv) || normalizeCv(window.Module)) {
      return normalizeCv(window.cv) || normalizeCv(window.Module);
    }

    if (cvPromise) return cvPromise;

    cvPromise = (async () => {
      const candidates = [];

      if (await fileExists(LOCAL_OPENCV_PATH)) {
        candidates.push({ src: LOCAL_OPENCV_PATH, label: "local" });
      }

      for (const url of OPENCV_CDN_URLS) {
        candidates.push({ src: url, label: "CDN" });
      }

      let lastError = null;

      for (const candidate of candidates) {
        try {
          await injectScript(candidate.src);
          const c = await unwrapCv();
          loadedSource = candidate.label === "local"
            ? "local"
            : candidate.src;
          return c;
        } catch (e) {
          lastError = e;
          // Remove a failed external script so the next URL can be tried.
          for (const s of [...document.scripts]) {
            if (s.src === new URL(candidate.src, location.href).href) {
              try { s.remove(); } catch {}
            }
          }
          window.cv = undefined;
          // Preserve Module only as a fresh shell for the next retry.
          window.Module = {};
        }
      }

      throw lastError || new Error("OpenCV.jsを読み込めませんでした。");
    })();

    try {
      return await cvPromise;
    } catch (e) {
      cvPromise = null;
      throw e;
    }
  }

  async function waitForCv(timeoutMs = 30000) {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("OpenCV.js初期化タイムアウト")), timeoutMs)
    );
    return Promise.race([loadCv(), timeout]);
  }

  async function selfCheck(timeoutMs = 12000) {
    const localFile = await fileExists(LOCAL_OPENCV_PATH);

    try {
      const c = await waitForCv(timeoutMs);
      return {
        localFile,
        runtime: !!c?.Mat,
        source: loadedSource || (localFile ? "local" : "CDN"),
        fallbackReady: true,
        ready: !!c?.Mat
      };
    } catch (e) {
      return {
        localFile,
        runtime: false,
        source: loadedSource || "",
        fallbackReady: true,
        ready: false,
        error: e.message
      };
    }
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("画像を読み込めませんでした。"));
      img.src = dataUrl;
    });
  }

  function imageToCanvas(img) {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
    return canvas;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function polygonArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  }

  function orderCorners(points) {
    // TL = min(x+y), BR = max(x+y), TR = min(y-x), BL = max(y-x)
    const pts = points.map(p => ({ x: Number(p.x), y: Number(p.y) }));
    const bySum = [...pts].sort((a,b) => (a.x+a.y) - (b.x+b.y));
    const byDiff = [...pts].sort((a,b) => (a.y-a.x) - (b.y-b.x));
    const tl = bySum[0];
    const br = bySum[bySum.length - 1];
    const tr = byDiff[0];
    const bl = byDiff[byDiff.length - 1];

    const unique = new Set([tl,tr,br,bl].map(p => `${Math.round(p.x)}:${Math.round(p.y)}`));
    if (unique.size === 4) return [tl,tr,br,bl];

    // Fallback for extreme rotations.
    const ySorted = [...pts].sort((a,b) => a.y - b.y);
    const top = ySorted.slice(0,2).sort((a,b) => a.x - b.x);
    const bottom = ySorted.slice(2).sort((a,b) => a.x - b.x);
    return [top[0], top[1], bottom[1], bottom[0]];
  }

  function quadMetrics(ordered) {
    const [tl,tr,br,bl] = ordered;
    const top = distance(tl,tr);
    const bottom = distance(bl,br);
    const left = distance(tl,bl);
    const right = distance(tr,br);
    const width = Math.max(top,bottom);
    const height = Math.max(left,right);
    const ratio = Math.max(width,height) / Math.max(1, Math.min(width,height));
    const angle = Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180 / Math.PI;
    return { top,bottom,left,right,width,height,ratio,angle };
  }

  function contourPoints(mat) {
    const arr = mat.data32S;
    const pts = [];
    for (let i = 0; i < arr.length; i += 2) {
      pts.push({ x: arr[i], y: arr[i+1] });
    }
    return pts;
  }

  function candidateScore(points, imageArea) {
    const ordered = orderCorners(points);
    const area = polygonArea(ordered);
    const m = quadMetrics(ordered);
    const areaRatio = area / Math.max(1, imageArea);

    // Japanese business cards are often around 1.65:1, but portrait cards and
    // non-standard cards are allowed. Ratio is only a weak preference.
    const ratioPenalty = Math.min(0.35, Math.abs(Math.log(Math.max(1.01, m.ratio) / 1.65)) * 0.18);
    const areaScore = Math.min(1, areaRatio / 0.75);
    const sizeBalance = Math.min(m.top,m.bottom) / Math.max(1,Math.max(m.top,m.bottom))
                      * Math.min(m.left,m.right) / Math.max(1,Math.max(m.left,m.right));
    return {
      ordered,
      area,
      areaRatio,
      metrics: m,
      score: areaScore * 0.70 + sizeBalance * 0.20 + (1 - ratioPenalty) * 0.10
    };
  }


  function normalizeAngle90(angle) {
    let a = angle;
    while (a < -45) a += 90;
    while (a >= 45) a -= 90;
    return a;
  }

  async function estimateSkewAngleJS(dataUrl, onProgress) {
    const img = await loadImage(dataUrl);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;

    const maxSide = 760;
    const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
    const w = Math.max(80, Math.round(srcW * scale));
    const h = Math.max(80, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    const rgba = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);

    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
      gray[p] = Math.round(
        rgba[i] * 0.299 +
        rgba[i + 1] * 0.587 +
        rgba[i + 2] * 0.114
      );
    }

    onProgress?.("純JavaScriptで名刺・文字エッジの傾きを解析中…");

    const minAngle = -30;
    const maxAngle = 30;
    const binSize = 0.5;
    const bins = Math.round((maxAngle - minAngle) / binSize) + 1;
    const hist = new Float64Array(bins);

    const cx = w / 2;
    const cy = h / 2;
    const halfDiag = Math.max(1, Math.hypot(cx, cy));

    let edgeCount = 0;

    // Sobel gradient. Use a 2px stride to keep smartphone processing light.
    for (let y = 2; y < h - 2; y += 2) {
      for (let x = 2; x < w - 2; x += 2) {
        const i00 = gray[(y - 1) * w + (x - 1)];
        const i01 = gray[(y - 1) * w + x];
        const i02 = gray[(y - 1) * w + (x + 1)];
        const i10 = gray[y * w + (x - 1)];
        const i12 = gray[y * w + (x + 1)];
        const i20 = gray[(y + 1) * w + (x - 1)];
        const i21 = gray[(y + 1) * w + x];
        const i22 = gray[(y + 1) * w + (x + 1)];

        const gx = -i00 + i02 - 2 * i10 + 2 * i12 - i20 + i22;
        const gy = -i00 - 2 * i01 - i02 + i20 + 2 * i21 + i22;
        const mag = Math.hypot(gx, gy);

        // Ignore weak texture/noise.
        if (mag < 90) continue;

        let lineAngle = Math.atan2(gy, gx) * 180 / Math.PI + 90;
        lineAngle = normalizeAngle90(lineAngle);

        if (lineAngle < minAngle || lineAngle > maxAngle) continue;

        // Outer card edges are more important than text inside the card.
        const radial = Math.hypot(x - cx, y - cy) / halfDiag;
        const outerWeight = 0.65 + Math.min(1, radial) * 1.35;
        const weight = Math.min(900, mag) * outerWeight;

        const bin = Math.max(
          0,
          Math.min(bins - 1, Math.round((lineAngle - minAngle) / binSize))
        );
        hist[bin] += weight;
        edgeCount++;
      }
    }

    if (edgeCount < 80) {
      return {
        angle: 0,
        confidence: 0,
        edgeCount,
        message: "十分な輪郭エッジを検出できませんでした。"
      };
    }

    // Smooth angle histogram.
    const smooth = new Float64Array(bins);
    for (let i = 0; i < bins; i++) {
      let s = 0;
      let weight = 0;
      for (let k = -3; k <= 3; k++) {
        const j = i + k;
        if (j < 0 || j >= bins) continue;
        const wk = 4 - Math.abs(k);
        s += hist[j] * wk;
        weight += wk;
      }
      smooth[i] = s / Math.max(1, weight);
    }

    let best = 0;
    let second = 0;
    let bestIdx = 0;

    for (let i = 0; i < bins; i++) {
      const v = smooth[i];
      if (v > best) {
        second = best;
        best = v;
        bestIdx = i;
      } else if (v > second && Math.abs(i - bestIdx) > 5) {
        second = v;
      }
    }

    const angle = minAngle + bestIdx * binSize;
    const confidence = best > 0 ? Math.max(0, Math.min(1, (best - second) / best + 0.35)) : 0;

    return {
      angle,
      confidence,
      edgeCount,
      message: `推定傾き ${angle.toFixed(1)}°`
    };
  }

  async function rotateImageJS(dataUrl, angleDeg) {
    const img = await loadImage(dataUrl);
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;

    if (Math.abs(angleDeg) < 0.15) {
      return dataUrl;
    }

    const rad = -angleDeg * Math.PI / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const dw = Math.ceil(sw * cos + sh * sin);
    const dh = Math.ceil(sw * sin + sh * cos);

    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, dw, dh);
    ctx.translate(dw / 2, dh / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -sw / 2, -sh / 2);

    return canvas.toDataURL("image/jpeg", 0.94);
  }

  async function correctDeskewJS(dataUrl, onProgress) {
    const est = await estimateSkewAngleJS(dataUrl, onProgress);

    // Very low confidence: leave the original intact rather than rotate incorrectly.
    if (est.confidence < 0.18 || Math.abs(est.angle) < 0.35) {
      return {
        corrected: false,
        method: "js-deskew",
        dataUrl,
        angle: est.angle,
        confidence: est.confidence,
        message: Math.abs(est.angle) < 0.35
          ? "傾きは小さいため回転補正なしでOCRします。"
          : "傾き推定の信頼度が低いため元画像でOCRします。"
      };
    }

    onProgress?.(`純JavaScriptで ${est.angle.toFixed(1)}° の傾きを補正中…`);
    const rotated = await rotateImageJS(dataUrl, est.angle);

    return {
      corrected: true,
      method: "js-deskew",
      dataUrl: rotated,
      angle: est.angle,
      confidence: est.confidence,
      message: `OpenCVを使用せず純JavaScriptで傾きを ${est.angle.toFixed(1)}° 補正しました。`
    };
  }

  async function correctCardImage(dataUrl, onProgress) {
    let openCvError = "";

    // Try OpenCV first for 4-point perspective correction.
    try {
      const cvCheck = await selfCheck(9000);
      if (cvCheck.ready) {
        const result = await correctPerspective(dataUrl, onProgress);
        if (result?.corrected) {
          result.method = "opencv-perspective";
          return result;
        }
      } else {
        openCvError = cvCheck.error || "OpenCV runtime unavailable";
      }
    } catch (e) {
      openCvError = e?.message || String(e);
    }

    // Guaranteed browser-only fallback: no CDN library required.
    const fallback = await correctDeskewJS(dataUrl, onProgress);
    fallback.openCvError = openCvError;
    return fallback;
  }

  async function correctPerspective(dataUrl, onProgress) {
    const cv = await waitForCv();
    const img = await loadImage(dataUrl);
    const canvas = imageToCanvas(img);

    onProgress?.("名刺外周を検出中…");

    let src, gray, blur, edges, closed, kernel, contours, hierarchy;
    let best = null;
    let fallbackContour = null;
    let fallbackArea = 0;

    try {
      src = cv.imread(canvas);
      gray = new cv.Mat();
      blur = new cv.Mat();
      edges = new cv.Mat();
      closed = new cv.Mat();

      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0, 0, cv.BORDER_DEFAULT);
      cv.Canny(blur, edges, 45, 140);

      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5,5));
      cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);

      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      const imageArea = src.cols * src.rows;

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = Math.abs(cv.contourArea(cnt, false));

        if (area > fallbackArea && area > imageArea * 0.08 && area < imageArea * 0.995) {
          if (fallbackContour) fallbackContour.delete();
          fallbackContour = cnt.clone();
          fallbackArea = area;
        }

        if (area < imageArea * 0.16 || area > imageArea * 0.985) {
          cnt.delete();
          continue;
        }

        const peri = cv.arcLength(cnt, true);
        const epsilons = [0.012, 0.018, 0.025, 0.035];
        for (const eps of epsilons) {
          const approx = new cv.Mat();
          cv.approxPolyDP(cnt, approx, eps * peri, true);
          if (approx.rows === 4) {
            const pts = contourPoints(approx);
            const candidate = candidateScore(pts, imageArea);
            if (
              candidate.areaRatio >= 0.16 &&
              candidate.metrics.ratio >= 1.15 &&
              candidate.metrics.ratio <= 2.6 &&
              (!best || candidate.score > best.score)
            ) {
              best = candidate;
            }
          }
          approx.delete();
        }
        cnt.delete();
      }

      // If a clean four-corner polygon was not found, use the minimum-area
      // rectangle of the largest plausible outer contour. This still corrects tilt.
      if (!best && fallbackContour) {
        const rr = cv.minAreaRect(fallbackContour);
        const vertices = cv.RotatedRect.points(rr);
        const pts = vertices.map(p => ({x:p.x, y:p.y}));
        const candidate = candidateScore(pts, imageArea);
        if (candidate.areaRatio >= 0.14) {
          best = candidate;
          best.rotationOnlyFallback = true;
        }
      }

      if (!best) {
        return {
          corrected: false,
          dataUrl,
          message: "名刺外周を十分に検出できなかったため、元画像でOCRします。"
        };
      }

      const [tl,tr,br,bl] = best.ordered;
      const m = best.metrics;
      let targetW = Math.max(320, Math.round(Math.max(m.top, m.bottom)));
      let targetH = Math.max(190, Math.round(Math.max(m.left, m.right)));

      // Avoid unnecessarily huge OCR images.
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(targetW,targetH));
      targetW = Math.max(1, Math.round(targetW * scale));
      targetH = Math.max(1, Math.round(targetH * scale));

      onProgress?.("外周4点から回転・台形歪みを補正中…");

      const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        tl.x,tl.y, tr.x,tr.y, br.x,br.y, bl.x,bl.y
      ]);
      const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,0, targetW-1,0, targetW-1,targetH-1, 0,targetH-1
      ]);
      const matrix = cv.getPerspectiveTransform(srcPts, dstPts);
      const dst = new cv.Mat();

      cv.warpPerspective(
        src,
        dst,
        matrix,
        new cv.Size(targetW,targetH),
        cv.INTER_CUBIC,
        cv.BORDER_REPLICATE,
        new cv.Scalar()
      );

      const out = document.createElement("canvas");
      out.width = targetW;
      out.height = targetH;
      cv.imshow(out, dst);
      const correctedUrl = out.toDataURL("image/jpeg", 0.93);

      srcPts.delete();
      dstPts.delete();
      matrix.delete();
      dst.delete();

      const angle = ((m.angle + 90) % 180 + 180) % 180 - 90;
      const perspectiveDelta = Math.max(
        Math.abs(m.top - m.bottom) / Math.max(1,Math.max(m.top,m.bottom)),
        Math.abs(m.left - m.right) / Math.max(1,Math.max(m.left,m.right))
      );

      return {
        corrected: true,
        dataUrl: correctedUrl,
        angle,
        perspectiveDelta,
        corners: best.ordered,
        width: targetW,
        height: targetH,
        rotationOnlyFallback: !!best.rotationOnlyFallback,
        message: best.rotationOnlyFallback
          ? `名刺外周を回転補正しました（推定傾き ${angle.toFixed(1)}°）。`
          : `名刺外周を基準に回転・台形補正しました（推定傾き ${angle.toFixed(1)}°）。`
      };
    } finally {
      [src,gray,blur,edges,closed,kernel,hierarchy].forEach(x => { try { x?.delete(); } catch {} });
      try { contours?.delete(); } catch {}
      try { fallbackContour?.delete(); } catch {}
    }
  }

  return { selfCheck, waitForCv, correctPerspective, correctDeskewJS, correctCardImage, LOCAL_OPENCV_PATH, OPENCV_CDN_URLS };
})();