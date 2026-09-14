const LocalOCR = (() => {
  const workers = { horizontal: null, vertical: null };
  const progressListeners = { horizontal: null, vertical: null };

  const FILES = {
    api: "./vendor/tesseract.min.js",
    worker: "./vendor/worker.min.js",
    coreDir: "./vendor/core/",
    jpn: "./tessdata/jpn.traineddata.gz",
    jpnVert: "./tessdata/jpn_vert.traineddata.gz",
    eng: "./tessdata/eng.traineddata.gz"
  };

  const CORE_BASES = [
    "tesseract-core-lstm",
    "tesseract-core-simd-lstm",
    "tesseract-core-relaxedsimd-lstm"
  ];

  const TYPES = [
    "company","name","department","position","address","phone","mobile","fax","email","website","other"
  ];

  async function headOrGet(path) {
    try {
      let r = await fetch(path, { method: "HEAD", cache: "no-store" });
      if (r.ok) return { ok: true, status: r.status };
      r = await fetch(path, { method: "GET", cache: "no-store" });
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, status: 0, error: e.message };
    }
  }

  async function selfCheck() {
    const result = {};
    result.tesseractGlobal = typeof window.Tesseract !== "undefined";
    result.worker = await headOrGet(FILES.worker);
    result.jpn = await headOrGet(FILES.jpn);
    result.jpnVert = await headOrGet(FILES.jpnVert);
    result.eng = await headOrGet(FILES.eng);
    result.core = {};
    for (const base of CORE_BASES) {
      const js = await headOrGet(FILES.coreDir + base + ".wasm.js");
      const wasm = await headOrGet(FILES.coreDir + base + ".wasm");
      result.core[base] = { js: js.ok, wasm: wasm.ok, pair: js.ok && wasm.ok };
    }
    result.coreAll = CORE_BASES.every(base => result.core[base]?.pair);
    result.ready = result.tesseractGlobal && result.worker.ok && result.jpn.ok && result.jpnVert.ok && result.eng.ok && result.coreAll;
    return result;
  }

  function progressText(m) {
    const map = {
      "loading tesseract core": "Tesseract core読込中",
      "loaded tesseract core": "Tesseract core読込完了",
      "initializing tesseract": "Tesseract初期化中",
      "initialized tesseract": "Tesseract初期化完了",
      "loading language traineddata": "言語データ読込中",
      "loaded language traineddata": "言語データ読込完了",
      "initializing api": "OCR API初期化中",
      "initialized api": "OCR API初期化完了",
      "recognizing text": "文字認識中"
    };
    let t = map[m.status] || m.status || "処理中";
    if (typeof m.progress === "number") t += ` ${Math.round(m.progress * 100)}%`;
    return t;
  }

  async function ensureWorker(onProgress, mode = "horizontal") {
    if (typeof window.Tesseract === "undefined") {
      throw new Error("Tesseract.js本体が読み込まれていません。vendor/tesseract.min.jsを確認してください。");
    }

    const vertical = mode === "vertical";
    progressListeners[mode] = onProgress || null;

    if (!workers[mode]) {
      onProgress?.({ stage: "api", text: vertical ? "Tesseract.js確認完了（縦書き）" : "Tesseract.js確認完了（横書き）" });
      const langs = vertical ? ["jpn_vert", "eng"] : ["jpn", "eng"];

      workers[mode] = await Tesseract.createWorker(langs, 1, {
        workerPath: FILES.worker,
        corePath: FILES.coreDir,
        langPath: "./tessdata",
        logger: m => {
          const text = progressText(m);
          let stage = "worker";
          if ((m.status || "").includes("language")) stage = "lang";
          if ((m.status || "").includes("recognizing")) stage = "recognize";
          progressListeners[mode]?.({
            stage,
            text: `${vertical ? "縦書き" : "横書き"}: ${text}`,
            raw: m
          });
        }
      });

      if (vertical) {
        await workers[mode].setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.AUTO,
          preserve_interword_spaces: "1",
          textord_tabfind_force_vertical_text: "1",
          textord_tabfind_vertical_horizontal_mix: "1"
        });
      } else {
        await workers[mode].setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.AUTO,
          preserve_interword_spaces: "1"
        });
      }

      onProgress?.({
        stage: "worker",
        text: vertical ? "縦書きWorker起動完了" : "横書きWorker起動完了（自動レイアウト解析）"
      });
      onProgress?.({
        stage: "lang",
        text: vertical ? "縦書き日本語・英語データ読込完了" : "日本語・英語データ読込完了"
      });
    }

    progressListeners[mode] = onProgress || null;
    return workers[mode];
  }

  function median(values) {
    if (!values.length) return 0;
    const a = [...values].sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function unionBBox(items) {
    return items.reduce((b, item) => {
      const x = item.bbox || item;
      return {
        x0: Math.min(b.x0, x.x0), y0: Math.min(b.y0, x.y0),
        x1: Math.max(b.x1, x.x1), y1: Math.max(b.y1, x.y1)
      };
    }, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  }

  function bboxHeight(b) { return Math.max(1, b.y1 - b.y0); }
  function bboxWidth(b) { return Math.max(1, b.x1 - b.x0); }
  function centerY(b) { return (b.y0 + b.y1) / 2; }
  function centerX(b) { return (b.x0 + b.x1) / 2; }

  function horizontalOverlap(a, b) {
    const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    return overlap / Math.max(1, Math.min(bboxWidth(a), bboxWidth(b)));
  }

  function flattenWords(blocks) {
    const words = [];
    for (const block of blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          for (const word of line.words || []) {
            const text = String(word.text || "").trim();
            if (!text || !word.bbox) continue;
            if (Number.isFinite(word.confidence) && word.confidence < 18 && !/[0-9A-Za-z一-龥ぁ-んァ-ヶ]/.test(text)) continue;
            words.push({
              text,
              confidence: Number(word.confidence || 0),
              bbox: { ...word.bbox },
              h: bboxHeight(word.bbox),
              w: bboxWidth(word.bbox)
            });
          }
        }
      }
    }
    return words;
  }

  function verticalOverlap(a, b) {
    const overlap = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    return overlap / Math.max(1, Math.min(bboxHeight(a), bboxHeight(b)));
  }

  function isHardBoundary(nextText, currentText) {
    const contact = /^(?:〒|TEL\b|FAX\b|MOBILE\b|携帯|E-?MAIL\b|MAIL\b|WEB\b|URL\b|HTTPS?:|WWW\.|北海道|東京都|京都府|大阪府|.{2,3}県)/i;
    const pos = /^(?:代表取締役|取締役|執行役員|社長|専務|常務|部長|次長|課長|係長|主任|主査|マネージャー|Manager|Director|Chief)$/i;
    const dept = /(本部|事業部|営業部|技術部|開発部|製造部|品質保証部|生産技術部|営業課|技術課|開発課|課|部|室|グループ|センター)$/;
    if (contact.test(nextText) && !contact.test(currentText)) return true;
    if (pos.test(nextText) && dept.test(currentText)) return true;
    return false;
  }


  // Robustly divide horizontal OCR tokens into visual lines.
  // Important: do NOT use the growing union bbox as the row anchor.
  // A growing bbox can bridge two nearby lines and then X-sorting interleaves them.
  function clusterWordsIntoHorizontalRows(words) {
    if (!words?.length) return [];

    const medH = Math.max(8, median(words.map(w => w.h || bboxHeight(w.bbox))));
    const candidates = [...words].sort((a, b) =>
      centerY(a.bbox) - centerY(b.bbox) || a.bbox.x0 - b.bbox.x0
    );

    const rows = [];

    for (const word of candidates) {
      const cy = centerY(word.bbox);
      const wh = Math.max(1, word.h || bboxHeight(word.bbox));

      let best = null;
      let bestDist = Infinity;

      for (const row of rows) {
        const rowH = Math.max(1, row.medianHeight || medH);
        const dist = Math.abs(cy - row.centerY);

        // Keep the tolerance narrower than one text height.
        // This prevents two separate printed lines from chaining into one row.
        const tolerance = Math.max(
          5,
          Math.min(medH * 0.62, Math.max(wh, rowH) * 0.70)
        );

        if (dist <= tolerance && dist < bestDist) {
          best = row;
          bestDist = dist;
        }
      }

      if (!best) {
        rows.push({
          words: [word],
          centerY: cy,
          medianHeight: wh,
          bbox: { ...word.bbox }
        });
      } else {
        best.words.push(word);
        best.centerY = median(best.words.map(w => centerY(w.bbox)));
        best.medianHeight = median(best.words.map(w => w.h || bboxHeight(w.bbox)));
        best.bbox = unionBBox(best.words);
      }
    }

    rows.sort((a, b) => a.centerY - b.centerY);

    for (const row of rows) {
      row.words.sort((a, b) =>
        a.bbox.x0 - b.bbox.x0 ||
        centerY(a.bbox) - centerY(b.bbox) ||
        a.bbox.x1 - b.bbox.x1
      );
    }

    return rows;
  }

  function compactJapaneseSpaces(text) {
    // OCR often inserts artificial spaces between Japanese characters/words.
    // For business-card field values, remove all horizontal whitespace:
    // half-width space, full-width space, tab, NBSP, etc.
    return String(text || "")
      .replace(/[ \t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, "")
      .trim();
  }


  function wordsToHorizontalReading(words) {
    const rows = clusterWordsIntoHorizontalRows(words);
    const orderedWords = [];
    const rowTexts = [];

    for (const row of rows) {
      orderedWords.push(...row.words);
      rowTexts.push(compactJapaneseSpaces(joinWords(row.words.map(w => w.text))));
    }

    // A grouped business-card field is read row 1 left->right, then row 2 left->right.
    // Japanese adjacent rows are concatenated without introducing artificial spaces.
    return {
      rows,
      words: orderedWords,
      text: compactJapaneseSpaces(rowTexts.join(""))
    };
  }


  // Font-size grouping.
  //
  // Japanese OCR bounding boxes fluctuate strongly for short tokens such as
  // "車" and "社". Splitting on a single token therefore causes company names
  // such as "トヨタ自動車株式会社" to be fragmented.
  //
  // v4.3.7 rule:
  //  - A moderate size change must continue for at least TWO consecutive OCR tokens.
  //  - A single token only triggers a split when the size change is extreme.
  //  - One-character Japanese tokens are treated as especially unreliable.
  const FONT_SIZE_PERSIST_RATIO = 1.38;
  const FONT_SIZE_PERSIST_MIN_PX = 4;
  const FONT_SIZE_SINGLE_STRONG_RATIO = 1.85;
  const FONT_SIZE_SINGLE_STRONG_MIN_PX = 8;

  function horizontalFontSize(word) {
    return Math.max(1, word.h || bboxHeight(word.bbox));
  }

  function verticalFontSize(word) {
    return Math.max(1, word.w || bboxWidth(word.bbox));
  }

  function normalizedTokenText(word) {
    return compactJapaneseSpaces(word?.text || "");
  }

  function isShortJapaneseToken(word) {
    const t = normalizedTokenText(word);
    return /^[一-龥々〆ヵヶぁ-んァ-ヶー]{1,2}$/.test(t);
  }

  function sizeChangeFromBase(base, value, ratioLimit, diffLimit) {
    const ratio = Math.max(base, value) / Math.max(1, Math.min(base, value));
    const diff = Math.abs(base - value);
    return ratio >= ratioLimit && diff >= diffLimit;
  }

  function sameSizeDirection(base, a, b) {
    return (a < base && b < base) || (a > base && b > base);
  }

  function shouldSplitByFontSizeSequence(
    chunk,
    sequence,
    index,
    orientation = "horizontal"
  ) {
    if (!chunk?.length || !sequence?.[index]) return false;

    const metric = orientation === "vertical" ? verticalFontSize : horizontalFontSize;
    const sizes = chunk.map(metric).filter(Number.isFinite);
    if (!sizes.length) return false;

    const base = Math.max(1, median(sizes));
    const currentWord = sequence[index];
    const current = Math.max(1, metric(currentWord));

    const moderate = sizeChangeFromBase(
      base,
      current,
      FONT_SIZE_PERSIST_RATIO,
      FONT_SIZE_PERSIST_MIN_PX
    );

    if (!moderate) return false;

    // Extremely large changes may represent a true heading/body boundary even
    // when only one OCR token follows. Keep a higher threshold for short
    // Japanese tokens because their bbox height is unstable.
    const strongRatio = isShortJapaneseToken(currentWord)
      ? 2.05
      : FONT_SIZE_SINGLE_STRONG_RATIO;

    if (
      sizeChangeFromBase(
        base,
        current,
        strongRatio,
        FONT_SIZE_SINGLE_STRONG_MIN_PX
      )
    ) {
      return true;
    }

    // Moderate difference: require the NEXT token to show the same size regime.
    const followingWord = sequence[index + 1];
    if (!followingWord) return false;

    const following = Math.max(1, metric(followingWord));
    const followingChanged = sizeChangeFromBase(
      base,
      following,
      FONT_SIZE_PERSIST_RATIO,
      FONT_SIZE_PERSIST_MIN_PX
    );

    if (!followingChanged) return false;
    if (!sameSizeDirection(base, current, following)) return false;

    // If both current and following tokens are very short Japanese fragments,
    // require one more confirmation when available.
    if (isShortJapaneseToken(currentWord) && isShortJapaneseToken(followingWord)) {
      const thirdWord = sequence[index + 2];
      if (!thirdWord) return false;

      const third = Math.max(1, metric(thirdWord));
      const thirdChanged = sizeChangeFromBase(
        base,
        third,
        FONT_SIZE_PERSIST_RATIO,
        FONT_SIZE_PERSIST_MIN_PX
      );

      return thirdChanged && sameSizeDirection(base, current, third);
    }

    return true;
  }

  // Backward-compatible helper used by older diagnostics/tests.
  function shouldSplitByFontSize(chunk, nextWord, orientation = "horizontal") {
    return shouldSplitByFontSizeSequence(chunk, [nextWord], 0, orientation);
  }

  function groupWordsHorizontal(words) {
    if (!words.length) return { regions: [], width: 1, height: 1 };
    const page = unionBBox(words);
    const pageWidth = Math.max(1, page.x1);
    const pageHeight = Math.max(1, page.y1);
    const medH = Math.max(8, median(words.map(w => w.h)));

    const rows = clusterWordsIntoHorizontalRows(words);

    const rawRegions = [];
    let id = 1;
    for (const row of rows.sort((a, b) => a.bbox.y0 - b.bbox.y0)) {
      const rowWords = row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      const rowMedH = Math.max(8, median(rowWords.map(w => w.h)));
      let chunk = [];
      const flush = () => {
        if (!chunk.length) return;

        const reading = wordsToHorizontalReading(chunk);
        const orderedChunk = reading.words;
        const bbox = unionBBox(orderedChunk);

        rawRegions.push({
          id: `r${id++}`,
          text: reading.text,
          words: orderedChunk.map(w => ({
            text: w.text,
            bbox: { ...w.bbox },
            confidence: w.confidence
          })),
          bbox,
          confidence: Math.round(
            orderedChunk.reduce((s, w) => s + w.confidence, 0) /
            Math.max(1, orderedChunk.length)
          ),
          avgHeight: orderedChunk.reduce((s, w) => s + w.h, 0) /
            Math.max(1, orderedChunk.length),
          lineCount: reading.rows.length
        });
        chunk = [];
      };

      for (let wordIndex = 0; wordIndex < rowWords.length; wordIndex++) {
        const word = rowWords[wordIndex];
        if (!chunk.length) { chunk.push(word); continue; }
        const prev = chunk[chunk.length - 1];
        const gap = word.bbox.x0 - prev.bbox.x1;
        const currentText = joinWords(chunk.map(w => w.text));
        const hard = isHardBoundary(word.text, currentText);
        const gapLimit = Math.max(rowMedH * 2.25, pageWidth * 0.045, 30);
        const semanticGap = Math.max(rowMedH * 0.45, 8);
        const fontSizeChanged = shouldSplitByFontSizeSequence(chunk, rowWords, wordIndex, "horizontal");

        if (
          gap > gapLimit ||
          (hard && gap > semanticGap) ||
          fontSizeChanged
        ) {
          flush();
        }

        chunk.push(word);
      }
      flush();
    }

    const regions = rawRegions.map(r => {
      if (!r.words?.length) {
        return { ...r, type: "other", autoType: "other", score: 0 };
      }

      const reading = wordsToHorizontalReading(
        r.words.map(w => ({
          ...w,
          h: bboxHeight(w.bbox),
          w: bboxWidth(w.bbox)
        }))
      );

      return {
        ...r,
        text: reading.text,
        words: reading.words.map(w => ({
          text: w.text,
          bbox: { ...w.bbox },
          confidence: w.confidence
        })),
        lineCount: reading.rows.length,
        type: "other",
        autoType: "other",
        score: 0
      };
    });

    return { regions, width: pageWidth, height: pageHeight, medianHeight: medH };
  }

  function groupWordsVertical(words) {
    if (!words.length) return { regions: [], width: 1, height: 1 };
    const page = unionBBox(words);
    const pageWidth = Math.max(1, page.x1);
    const pageHeight = Math.max(1, page.y1);
    const medW = Math.max(8, median(words.map(w => w.w)));

    const columns = [];
    const candidates = [...words].sort((a, b) =>
      centerX(b.bbox) - centerX(a.bbox) || a.bbox.y0 - b.bbox.y0
    );

    for (const word of candidates) {
      let best = null;
      let bestDist = Infinity;
      for (const col of columns) {
        const cb = col.bbox;
        const dist = Math.abs(centerX(word.bbox) - centerX(cb));
        if ((horizontalOverlap(word.bbox, cb) >= 0.30 || dist <= medW * 0.72) && dist < bestDist) {
          best = col;
          bestDist = dist;
        }
      }
      if (!best) {
        columns.push({ words: [word], bbox: { ...word.bbox } });
      } else {
        best.words.push(word);
        best.bbox = unionBBox(best.words);
      }
    }

    const rawRegions = [];
    let id = 1;

    for (const col of columns.sort((a, b) => b.bbox.x1 - a.bbox.x1)) {
      const colWords = col.words.sort((a, b) => a.bbox.y0 - b.bbox.y0);
      const colMedW = Math.max(8, median(colWords.map(w => w.w)));
      let chunk = [];

      const flush = () => {
        if (!chunk.length) return;
        const bbox = unionBBox(chunk);
        rawRegions.push({
          id: `v${id++}`,
          text: joinVerticalWords(chunk.map(w => w.text)),
          words: chunk.map(w => ({ text: w.text, bbox: { ...w.bbox }, confidence: w.confidence })),
          bbox,
          confidence: Math.round(chunk.reduce((s, w) => s + w.confidence, 0) / chunk.length),
          avgHeight: chunk.reduce((s, w) => s + w.h, 0) / chunk.length,
          avgWidth: chunk.reduce((s, w) => s + w.w, 0) / chunk.length,
          orientation: "vertical"
        });
        chunk = [];
      };

      for (let wordIndex = 0; wordIndex < colWords.length; wordIndex++) {
        const word = colWords[wordIndex];
        if (!chunk.length) {
          chunk.push(word);
          continue;
        }
        const prev = chunk[chunk.length - 1];
        const gap = word.bbox.y0 - prev.bbox.y1;
        const gapLimit = Math.max(colMedW * 2.2, pageHeight * 0.040, 28);
        const fontSizeChanged = shouldSplitByFontSizeSequence(chunk, colWords, wordIndex, "vertical");

        if (gap > gapLimit || fontSizeChanged) {
          flush();
        }

        chunk.push(word);
      }
      flush();
    }

    return {
      regions: rawRegions.map(r => ({ ...r, type: "other", autoType: "other", score: 0 })),
      width: pageWidth,
      height: pageHeight,
      medianWidth: medW
    };
  }

  function joinVerticalWords(parts) {
    return compactJapaneseSpaces(
      parts.join("")
        .replace(/[‐‑‒–—―ー]{2,}/g, "-")
    );
  }

  function joinWords(parts) {
    return parts.join(" ")
      .replace(/\s+([,.:;])/g, "$1")
      .replace(/([〒@/\-])\s+/g, "$1")
      .replace(/\s+([@/\-])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  const RX = {
    company: /(株式会社|有限会社|合同会社|合資会社|合名会社|Inc\.?|Corporation|Corp\.?|Co\.?\s*,?\s*Ltd\.?|Ltd\.?|Company|製作所|工業株式会社|工業有限会社)/i,
    department: /(本部|事業部|営業部|技術部|開発部|製造部|品質保証部|品質管理部|生産技術部|総務部|管理部|購買部|調達部|営業課|技術課|開発課|製造課|生産技術課|品質課|課|部|室|グループ|センター|チーム)$/,
    position: /(代表取締役|取締役|執行役員|社長|副社長|専務|常務|工場長|部長|次長|課長|係長|班長|主任|主査|リーダー|マネージャー|Manager|Director|Chief|President)/i,
    postal: /〒?\s*\d{3}[-‐‑‒–—―ー]?\s*\d{4}/,
    address: /(北海道|東京都|京都府|大阪府|.{2,3}県).*(市|区|郡|町|村)|(?:市|区|郡).*(?:町|丁目|番地|番|号)/,
    email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    url: /(?:https?:\/\/|www\.)[^\s]+|[A-Z0-9.-]+\.(?:com|jp|co\.jp|net|org)(?:\/[^\s]*)?/i,
    mobile: /(?:\+?81[-\s]?)?0?[789]0[-\s]?\d{4}[-\s]?\d{4}/,
    phone: /(?:\+?\d[\d\-()‐‑‒–—―ー\s]{7,}\d)/,
    faxLabel: /\bFAX\b|ファクス|ファックス/i,
    phoneLabel: /\bTEL\b|電話/i,
    mobileLabel: /\bMOBILE\b|携帯/i,
    webLabel: /\bWEB\b|URL/i
  };

  function classifyRegion(region, page, medRegionHeight) {
    const text = region.text.replace(/｜/g, "|").trim();
    const t = text.normalize("NFKC");
    const yRatio = region.bbox.y0 / Math.max(1, page.height);
    const xCenter = (region.bbox.x0 + region.bbox.x1) / 2 / Math.max(1, page.width);
    const relH = region.avgHeight / Math.max(1, medRegionHeight);
    const scores = Object.fromEntries(TYPES.map(k => [k, 0]));

    if (RX.email.test(t)) scores.email += 14;
    if (RX.url.test(t) || RX.webLabel.test(t)) scores.website += 10;
    if (RX.faxLabel.test(t)) scores.fax += 13;
    if (RX.mobileLabel.test(t) || RX.mobile.test(t)) scores.mobile += 12;
    if (RX.phoneLabel.test(t) && !RX.faxLabel.test(t)) scores.phone += 11;
    if (RX.phone.test(t) && !RX.email.test(t)) scores.phone += 4;

    if (RX.postal.test(t)) scores.address += 12;
    if (RX.address.test(t)) scores.address += 7;
    if (/(都|道|府|県|市|区|郡|町|村|丁目|番地)/.test(t)) scores.address += 3;

    if (RX.company.test(t)) scores.company += 13;
    if (yRatio < 0.38) scores.company += 1;
    if (relH > 1.25 && yRatio < 0.5) scores.company += 2;

    if (RX.position.test(t)) scores.position += 11;
    if (RX.department.test(t) && !RX.position.test(t)) scores.department += 10;
    if (/(本部|事業部|グループ|センター|チーム)/.test(t) && !RX.position.test(t)) scores.department += 4;

    const noObvious = !RX.company.test(t) && !RX.department.test(t) && !RX.position.test(t) &&
      !RX.postal.test(t) && !RX.address.test(t) && !RX.email.test(t) && !RX.url.test(t) &&
      !RX.phone.test(t) && !RX.phoneLabel.test(t) && !RX.faxLabel.test(t);
    const jpNameLike = /^[一-龥々ぁ-んァ-ヶー\s・]{2,14}$/.test(t);
    const latinNameLike = /^[A-Za-z][A-Za-z .'-]{2,30}$/.test(t);
    if (noObvious && (jpNameLike || latinNameLike)) {
      scores.name += 4;
      if (relH > 1.15) scores.name += 4;
      if (relH > 1.45) scores.name += 2;
      if (xCenter > 0.15 && xCenter < 0.85) scores.name += 1;
      if (t.split(/\s+/).length === 2) scores.name += 2;
    }

    // Strong semantic categories suppress accidental alternatives.
    if (scores.email >= 10) return { type: "email", score: scores.email };
    if (scores.website >= 10) return { type: "website", score: scores.website };
    if (scores.fax >= 10) return { type: "fax", score: scores.fax };
    if (scores.mobile >= 10) return { type: "mobile", score: scores.mobile };
    if (scores.address >= 10) return { type: "address", score: scores.address };
    if (scores.company >= 10) return { type: "company", score: scores.company };
    if (scores.position >= 10) return { type: "position", score: scores.position };
    if (scores.department >= 10) return { type: "department", score: scores.department };
    if (scores.phone >= 8) return { type: "phone", score: scores.phone };

    let type = "other", score = 0;
    for (const [k, v] of Object.entries(scores)) {
      if (v > score) { type = k; score = v; }
    }
    if (score < 4) { type = "other"; score = 0; }
    return { type, score };
  }

  function classifyRegions(regions, page) {
    const medH = Math.max(1, median(regions.map(r => r.avgHeight)));
    return regions.map(r => {
      const c = classifyRegion(r, page, medH);
      return { ...r, type: c.type, autoType: c.type, score: c.score };
    });
  }

  // Convert 2D OCR regions into human reading order.
  // Regions are first clustered into visual rows using vertical overlap / center distance,
  // then rows are ordered top-to-bottom and each row left-to-right.
  // This avoids the common two-column failure where a slightly higher right-hand region
  // is incorrectly read before the left-hand region on the same visual row.
  function sortedByVisualHorizontal(regions) {
    if (!regions?.length) return [];

    const items = regions.map(r => ({ ...r, bbox: { ...r.bbox } }));
    const heights = items.map(r => Math.max(1, r.bbox.y1 - r.bbox.y0));
    const medH = Math.max(8, median(heights));

    const rows = [];
    const candidates = [...items].sort((a, b) =>
      centerY(a.bbox) - centerY(b.bbox) || a.bbox.x0 - b.bbox.x0
    );

    for (const region of candidates) {
      let bestRow = null;
      let bestScore = -Infinity;

      for (const row of rows) {
        const rb = row.bbox;
        const overlap = verticalOverlap(region.bbox, rb);
        const centerDist = Math.abs(centerY(region.bbox) - centerY(rb));
        const regionH = Math.max(1, region.bbox.y1 - region.bbox.y0);
        const rowH = Math.max(1, rb.y1 - rb.y0);
        const tolerance = Math.max(medH * 0.72, Math.min(regionH, rowH) * 0.62);

        // Same visual line if boxes overlap vertically enough, or their centers are close.
        if (overlap >= 0.28 || centerDist <= tolerance) {
          const score = overlap * 100 - centerDist;
          if (score > bestScore) {
            bestScore = score;
            bestRow = row;
          }
        }
      }

      if (!bestRow) {
        rows.push({ regions: [region], bbox: { ...region.bbox } });
      } else {
        bestRow.regions.push(region);
        bestRow.bbox = unionBBox(bestRow.regions);
      }
    }

    // Stable top-to-bottom row order. For nearly equal row tops, use row center.
    rows.sort((a, b) => {
      const dy = a.bbox.y0 - b.bbox.y0;
      if (Math.abs(dy) > medH * 0.35) return dy;
      return centerY(a.bbox) - centerY(b.bbox);
    });

    const ordered = [];
    let readingOrder = 1;
    for (const row of rows) {
      row.regions.sort((a, b) => a.bbox.x0 - b.bbox.x0 || a.bbox.x1 - b.bbox.x1);
      for (const region of row.regions) {
        ordered.push({ ...region, readingOrder: readingOrder++ });
      }
    }
    return ordered;
  }


  function sortedByVisualVertical(regions) {
    if (!regions?.length) return [];

    const items = regions.map(r => ({ ...r, bbox: { ...r.bbox } }));
    const widths = items.map(r => Math.max(1, r.bbox.x1 - r.bbox.x0));
    const medW = Math.max(8, median(widths));

    const columns = [];
    const candidates = [...items].sort((a, b) =>
      centerX(b.bbox) - centerX(a.bbox) || a.bbox.y0 - b.bbox.y0
    );

    for (const region of candidates) {
      let bestCol = null;
      let bestScore = -Infinity;

      for (const col of columns) {
        const cb = col.bbox;
        const overlap = horizontalOverlap(region.bbox, cb);
        const centerDist = Math.abs(centerX(region.bbox) - centerX(cb));
        const regionW = Math.max(1, region.bbox.x1 - region.bbox.x0);
        const colW = Math.max(1, cb.x1 - cb.x0);
        const tolerance = Math.max(medW * 0.80, Math.min(regionW, colW) * 0.72);

        if (overlap >= 0.24 || centerDist <= tolerance) {
          const score = overlap * 100 - centerDist;
          if (score > bestScore) {
            bestScore = score;
            bestCol = col;
          }
        }
      }

      if (!bestCol) {
        columns.push({ regions: [region], bbox: { ...region.bbox } });
      } else {
        bestCol.regions.push(region);
        bestCol.bbox = unionBBox(bestCol.regions);
      }
    }

    columns.sort((a, b) => {
      const dx = b.bbox.x1 - a.bbox.x1;
      if (Math.abs(dx) > medW * 0.35) return dx;
      return centerX(b.bbox) - centerX(a.bbox);
    });

    const ordered = [];
    let readingOrder = 1;
    for (const col of columns) {
      col.regions.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.y1 - b.bbox.y1);
      for (const region of col.regions) {
        ordered.push({ ...region, readingOrder: readingOrder++, orientation: "vertical" });
      }
    }
    return ordered;
  }

  function sortedByVisual(regions, orientation = "horizontal") {
    return orientation === "vertical"
      ? sortedByVisualVertical(regions)
      : sortedByVisualHorizontal(regions);
  }

  function extractEmail(s) {
    return (s.match(RX.email) || [""])[0];
  }

  function extractUrl(s) {
    const m = s.match(RX.url);
    return m ? m[0].replace(/[),.;]+$/, "") : "";
  }

  function normalizePhone(s) {
    const m = s.match(RX.phone);
    if (!m) return "";
    return m[0].replace(/[‐‑‒–—―ー]/g, "-").replace(/\s+/g, "").trim();
  }

  function cleanAddress(s) {
    return s.replace(RX.postal, "").replace(/^(?:住所|所在地)[:：]?\s*/i, "").replace(/\s+/g, " ").trim();
  }

  function splitName(s) {
    const text = s.replace(/^(?:氏名|Name)[:：]?\s*/i, "").trim();
    let p = text.split(/[\s　]+/).filter(Boolean);
    if (p.length >= 2) return { lastName: p[0], firstName: p.slice(1).join(" ") };
    return { lastName: text, firstName: "" };
  }

  function choose(regions, type) {
    const list = regions.filter(r => r.type === type);
    if (!list.length) return null;
    return [...list].sort((a, b) => b.score - a.score || b.avgHeight - a.avgHeight || a.bbox.y0 - b.bbox.y0)[0];
  }

  function fieldsFromRegions(regions, orientation = "horizontal") {
    const visual = sortedByVisual(regions, orientation);
    const companyR = choose(visual, "company");
    const nameR = choose(visual, "name");
    const dept = compactJapaneseSpaces(visual.filter(r => r.type === "department").map(r => r.text).join(""));
    const pos = compactJapaneseSpaces(visual.filter(r => r.type === "position").map(r => r.text).join(""));
    const addressRegs = visual.filter(r => r.type === "address");
    const addressText = addressRegs.map(r => r.text).join(" ").trim();
    const postal = (addressText.match(RX.postal) || [""])[0].replace(/^〒\s*/, "").replace(/[‐‑‒–—―ー]/g, "-").replace(/\s+/g, "");
    const phoneR = visual.find(r => r.type === "phone");
    const mobileR = visual.find(r => r.type === "mobile");
    const emailR = visual.find(r => r.type === "email");
    const webR = visual.find(r => r.type === "website");
    const name = nameR ? splitName(nameR.text) : { lastName: "", firstName: "" };

    return {
      company: companyR?.text || "",
      lastName: name.lastName,
      firstName: name.firstName,
      department: dept,
      position: pos,
      phone: phoneR ? normalizePhone(phoneR.text) : "",
      mobile: mobileR ? normalizePhone(mobileR.text) : "",
      email: emailR ? extractEmail(emailR.text) : "",
      postalCode: postal,
      address: cleanAddress(addressText),
      website: webR ? extractUrl(webR.text) : ""
    };
  }

  function qualityMetrics(layout) {
    const words = layout.words || [];
    const regions = layout.regions || [];
    const avgConfidence = words.length
      ? words.reduce((s, w) => s + Number(w.confidence || 0), 0) / words.length
      : 0;
    const strongTypes = new Set(
      regions.filter(r => r.type && r.type !== "other").map(r => r.type)
    ).size;
    const singleCharRatio = words.length
      ? words.filter(w => String(w.text || "").replace(/\s/g, "").length <= 1).length / words.length
      : 1;
    const tallWordRatio = words.length
      ? words.filter(w => bboxHeight(w.bbox) > bboxWidth(w.bbox) * 1.55).length / words.length
      : 0;

    const textLen = String(layout.text || "").replace(/\s/g, "").length;
    const score =
      avgConfidence * 0.55 +
      Math.min(28, strongTypes * 5.5) +
      Math.min(12, textLen / 8) -
      Math.max(0, singleCharRatio - 0.72) * 20;

    return { score, avgConfidence, strongTypes, singleCharRatio, tallWordRatio, textLen };
  }

  async function recognizeOne(image, orientation, onProgress) {
    const w = await ensureWorker(onProgress, orientation);
    const label = orientation === "vertical" ? "縦書き" : "横書き";
    onProgress?.({ stage: "recognize", text: `${label}: 座標付き文字認識開始` });

    const ret = await w.recognize(image, {}, { text: true, blocks: true });
    const text = ret?.data?.text || "";
    const blocks = ret?.data?.blocks || [];
    const words = flattenWords(blocks);
    const grouped = orientation === "vertical"
      ? groupWordsVertical(words)
      : groupWordsHorizontal(words);

    const page = { width: grouped.width, height: grouped.height };
    const classified = classifyRegions(grouped.regions, page);
    const regions = sortedByVisual(classified, orientation);
    const fields = fieldsFromRegions(regions, orientation);

    const layout = { text, blocks, words, regions, fields, page, orientation };
    layout.quality = qualityMetrics(layout);

    onProgress?.({
      stage: "recognize",
      text: `${label}: 文字認識完了（${words.length}語 / ${regions.length}領域 / 信頼度${Math.round(layout.quality.avgConfidence)}%）`
    });
    return layout;
  }

  function shouldTryVertical(horizontal) {
    const q = horizontal.quality || qualityMetrics(horizontal);
    return (
      q.avgConfidence < 72 ||
      q.strongTypes < 3 ||
      q.tallWordRatio > 0.28 ||
      q.singleCharRatio > 0.62
    );
  }

  async function recognizeLayout(image, onProgress, requestedMode = "auto") {
    if (requestedMode === "horizontal") {
      return recognizeOne(image, "horizontal", onProgress);
    }
    if (requestedMode === "vertical") {
      return recognizeOne(image, "vertical", onProgress);
    }

    const horizontal = await recognizeOne(image, "horizontal", onProgress);

    if (!shouldTryVertical(horizontal)) {
      horizontal.autoDecision = "horizontal-only";
      return horizontal;
    }

    onProgress?.({
      stage: "recognize",
      text: "縦書きの可能性を検出。縦書きOCRでも比較中…"
    });

    const vertical = await recognizeOne(image, "vertical", onProgress);

    const h = horizontal.quality;
    const v = vertical.quality;
    const chooseVertical =
      v.score > h.score + 4 ||
      (h.strongTypes < 2 && v.strongTypes > h.strongTypes && v.score >= h.score - 2) ||
      (h.tallWordRatio > 0.40 && v.avgConfidence > h.avgConfidence + 3);

    const selected = chooseVertical ? vertical : horizontal;
    selected.autoDecision = chooseVertical ? "vertical" : "horizontal";
    selected.alternativeQuality = chooseVertical ? h : v;
    return selected;
  }

  // Coordinate-free fallback used only after a user manually edits the OCR raw text.
  function extract(text) {
    const lines = text.split(/\r?\n/).map(x => x.replace(/[|｜]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    const pseudo = lines.map((t, i) => ({
      id: `t${i + 1}`, text: t, words: [],
      bbox: { x0: 0, y0: i * 30, x1: Math.max(100, t.length * 16), y1: i * 30 + 24 },
      confidence: 100, avgHeight: 24, type: "other", autoType: "other", score: 0
    }));
    const width = Math.max(1, ...pseudo.map(r => r.bbox.x1));
    const height = Math.max(1, pseudo.length * 30);
    const regions = classifyRegions(pseudo, { width, height });
    return { ...fieldsFromRegions(regions, "horizontal"), regions, orientation: "horizontal" };
  }

  async function terminate() {
    for (const mode of ["horizontal", "vertical"]) {
      if (workers[mode]) {
        try { await workers[mode].terminate(); } catch {}
        workers[mode] = null;
      }
    }
  }

  return {
    selfCheck, recognizeLayout, extract, fieldsFromRegions, sortedByVisual, sortedByVisualHorizontal, sortedByVisualVertical, wordsToHorizontalReading, shouldSplitByFontSize, shouldSplitByFontSizeSequence, terminate, FILES, CORE_BASES, TYPES
  };
})();
