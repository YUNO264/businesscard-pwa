const LocalOCR = (() => {
  let worker = null;

  const FILES = {
    api: "./vendor/tesseract.min.js",
    worker: "./vendor/worker.min.js",
    coreDir: "./vendor/core/",
    jpn: "./tessdata/jpn.traineddata.gz",
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
    result.eng = await headOrGet(FILES.eng);
    result.core = {};
    for (const base of CORE_BASES) {
      const js = await headOrGet(FILES.coreDir + base + ".wasm.js");
      const wasm = await headOrGet(FILES.coreDir + base + ".wasm");
      result.core[base] = { js: js.ok, wasm: wasm.ok, pair: js.ok && wasm.ok };
    }
    result.coreAll = CORE_BASES.every(base => result.core[base]?.pair);
    result.ready = result.tesseractGlobal && result.worker.ok && result.jpn.ok && result.eng.ok && result.coreAll;
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

  async function ensureWorker(onProgress) {
    if (worker) return worker;
    if (typeof window.Tesseract === "undefined") {
      throw new Error("Tesseract.js本体が読み込まれていません。vendor/tesseract.min.jsを確認してください。");
    }
    onProgress?.({ stage: "api", text: "Tesseract.js確認完了" });
    worker = await Tesseract.createWorker(["jpn", "eng"], 1, {
      workerPath: FILES.worker,
      corePath: FILES.coreDir,
      langPath: "./tessdata",
      logger: m => {
        const text = progressText(m);
        let stage = "worker";
        if ((m.status || "").includes("language")) stage = "lang";
        if ((m.status || "").includes("recognizing")) stage = "recognize";
        onProgress?.({ stage, text, raw: m });
      }
    });
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      preserve_interword_spaces: "1"
    });
    onProgress?.({ stage: "worker", text: "Worker起動完了（自動レイアウト解析）" });
    onProgress?.({ stage: "lang", text: "日本語・英語データ読込完了" });
    return worker;
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

  function groupWords(words) {
    if (!words.length) return { regions: [], width: 1, height: 1 };
    const page = unionBBox(words);
    const pageWidth = Math.max(1, page.x1);
    const pageHeight = Math.max(1, page.y1);
    const medH = Math.max(8, median(words.map(w => w.h)));

    const rows = [];
    for (const word of [...words].sort((a, b) => centerY(a.bbox) - centerY(b.bbox) || a.bbox.x0 - b.bbox.x0)) {
      let best = null;
      let bestDist = Infinity;
      for (const row of rows) {
        const rb = row.bbox;
        const dist = Math.abs(centerY(word.bbox) - centerY(rb));
        if ((verticalOverlap(word.bbox, rb) >= 0.42 || dist <= medH * 0.58) && dist < bestDist) {
          best = row; bestDist = dist;
        }
      }
      if (!best) {
        rows.push({ words: [word], bbox: { ...word.bbox } });
      } else {
        best.words.push(word);
        best.bbox = unionBBox(best.words);
      }
    }

    const rawRegions = [];
    let id = 1;
    for (const row of rows.sort((a, b) => a.bbox.y0 - b.bbox.y0)) {
      const rowWords = row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      const rowMedH = Math.max(8, median(rowWords.map(w => w.h)));
      let chunk = [];
      const flush = () => {
        if (!chunk.length) return;
        const bbox = unionBBox(chunk);
        rawRegions.push({
          id: `r${id++}`,
          text: joinWords(chunk.map(w => w.text)),
          words: chunk.map(w => ({ text: w.text, bbox: { ...w.bbox }, confidence: w.confidence })),
          bbox,
          confidence: Math.round(chunk.reduce((s, w) => s + w.confidence, 0) / chunk.length),
          avgHeight: chunk.reduce((s, w) => s + w.h, 0) / chunk.length
        });
        chunk = [];
      };

      for (const word of rowWords) {
        if (!chunk.length) { chunk.push(word); continue; }
        const prev = chunk[chunk.length - 1];
        const gap = word.bbox.x0 - prev.bbox.x1;
        const currentText = joinWords(chunk.map(w => w.text));
        const hard = isHardBoundary(word.text, currentText);
        const gapLimit = Math.max(rowMedH * 2.25, pageWidth * 0.045, 30);
        const semanticGap = Math.max(rowMedH * 0.45, 8);
        if (gap > gapLimit || (hard && gap > semanticGap)) flush();
        chunk.push(word);
      }
      flush();
    }

    // Merge very close fragments that belong to the same visual unit, while never bridging large horizontal gaps.
    const regions = rawRegions.map(r => ({ ...r, type: "other", autoType: "other", score: 0 }));
    return { regions, width: pageWidth, height: pageHeight, medianHeight: medH };
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

  function sortedByVisual(regions) {
    return [...regions].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
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

  function fieldsFromRegions(regions) {
    const visual = sortedByVisual(regions);
    const companyR = choose(visual, "company");
    const nameR = choose(visual, "name");
    const dept = visual.filter(r => r.type === "department").map(r => r.text).join(" ").trim();
    const pos = visual.filter(r => r.type === "position").map(r => r.text).join(" ").trim();
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

  async function recognizeLayout(image, onProgress) {
    const w = await ensureWorker(onProgress);
    onProgress?.({ stage: "recognize", text: "座標付き文字認識開始" });
    const ret = await w.recognize(image, {}, { text: true, blocks: true });
    const text = ret?.data?.text || "";
    const blocks = ret?.data?.blocks || [];
    const words = flattenWords(blocks);
    const grouped = groupWords(words);
    const page = { width: grouped.width, height: grouped.height };
    const regions = classifyRegions(grouped.regions, page);
    const fields = fieldsFromRegions(regions);
    onProgress?.({ stage: "recognize", text: `座標付き文字認識完了（${words.length}語 / ${regions.length}領域）` });
    return { text, blocks, words, regions, fields, page };
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
    return { ...fieldsFromRegions(regions), regions };
  }

  async function terminate() {
    if (worker) {
      try { await worker.terminate(); } catch {}
      worker = null;
    }
  }

  return {
    selfCheck, recognizeLayout, extract, fieldsFromRegions, terminate, FILES, CORE_BASES, TYPES
  };
})();
