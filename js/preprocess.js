const CardPreprocess = (() => {
  const OPENCV_PATH = "./vendor/opencv.js";

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function fileExists(path) {
    try {
      let r = await fetch(path, { method: "HEAD", cache: "no-store" });
      if (r.ok) return true;
      r = await fetch(path, { method: "GET", cache: "no-store" });
      return r.ok;
    } catch {
      return false;
    }
  }

  async function waitForCv(timeoutMs = 20000) {
    const started = Date.now();

    if (window.OpenCVReady) {
      try {
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("OpenCV.js初期化タイムアウト")), timeoutMs)
        );
        const cvReady = await Promise.race([window.OpenCVReady, timeout]);
        if (cvReady?.Mat) return cvReady;
      } catch {
        // Fall through to polling. Some OpenCV builds set global cv directly.
      }
    }

    while (Date.now() - started < timeoutMs) {
      if (window.cv instanceof Promise) {
        try {
          const resolved = await window.cv;
          if (resolved?.Mat) {
            window.cv = resolved;
            window.__resolveOpenCVReady?.(resolved);
            return resolved;
          }
        } catch {}
      }
      if (window.cv?.Mat) {
        window.__resolveOpenCVReady?.(window.cv);
        return window.cv;
      }
      if (window.Module?.Mat) {
        window.cv = window.Module;
        window.__resolveOpenCVReady?.(window.cv);
        return window.cv;
      }
      await sleep(80);
    }
    throw new Error("OpenCV.jsを初期化できません。SETUP_OCR_FINAL.batを再実行してください。");
  }

  async function selfCheck() {
    const file = await fileExists(OPENCV_PATH);
    let runtime = false;
    if (file) {
      try {
        const c = await waitForCv(5000);
        runtime = !!c?.Mat;
      } catch {}
    }
    return { file, runtime, ready: file && runtime };
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

  return { selfCheck, waitForCv, correctPerspective, OPENCV_PATH };
})();