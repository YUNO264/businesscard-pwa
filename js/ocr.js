const LocalOCR = (() => {
  let worker = null;
  let sourceMode = null;

  const CDN = {
    api: "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js",
    worker: "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js",
    core: "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0",
    lang: "https://tessdata.projectnaptha.com/4.0.0"
  };

  const LOCAL = {
    api: "./vendor/tesseract.min.js",
    worker: "./vendor/worker.min.js",
    core: "./vendor/core",
    lang: "./tessdata"
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); reject(new Error(`読込失敗: ${src}`)); };
      document.head.appendChild(s);
    });
  }

  async function localAssetsExist() {
    try {
      const r = await fetch(LOCAL.api, { cache: "no-store" });
      return r.ok && (r.headers.get("content-type") || "").includes("javascript");
    } catch { return false; }
  }

  async function ensureApi(onProgress) {
    if (window.Tesseract) return;
    onProgress?.({ status: "OCRエンジン確認中", progress: 0 });
    const hasLocal = await localAssetsExist();
    if (hasLocal) {
      try {
        await loadScript(LOCAL.api);
        sourceMode = "local";
        return;
      } catch (_) {}
    }
    onProgress?.({ status: "OCRエンジン初回取得中", progress: 0 });
    await loadScript(CDN.api);
    sourceMode = "cdn";
  }

  async function ensureWorker(onProgress) {
    if (worker) return worker;
    await ensureApi(onProgress);
    const p = sourceMode === "local" ? LOCAL : CDN;
    worker = await Tesseract.createWorker(["jpn", "eng"], 1, {
      workerPath: p.worker,
      corePath: p.core,
      langPath: p.lang,
      logger: m => onProgress?.(m)
    });
    return worker;
  }

  async function recognize(file, onProgress) {
    const w = await ensureWorker(onProgress);
    const result = await w.recognize(file);
    return result.data.text || "";
  }

  function extract(text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
    const phones = text.match(/(?:\+?\d[\d\-()\s]{7,}\d)/g) || [];
    const postal = text.match(/〒?\s*(\d{3})[-ー](\d{4})/);
    const urls = text.match(/https?:\/\/[^\s]+|(?:www\.)[^\s]+/ig) || [];
    const companyWords = /(株式会社|有限会社|合同会社|Inc\.?|Corporation|Corp\.?|Co\.,?\s*Ltd\.?|Ltd\.?)/i;
    const deptWords = /(部|課|室|グループ|センター|本部|営業|技術|開発|品質|生産技術)/;
    const posWords = /(社長|部長|課長|係長|主任|主査|マネージャー|Manager|Director|Chief)/i;

    const company = lines.find(x => companyWords.test(x)) || "";
    const department = lines.find(x => deptWords.test(x) && x !== company) || "";
    const position = lines.find(x => posWords.test(x)) || "";

    return {
      company, department, position,
      phone: phones[0] ? phones[0].replace(/\s+/g," ").trim() : "",
      mobile: phones.find(p => /090|080|070/.test(p.replace(/\D/g,""))) || "",
      email: emails[0] || "",
      postalCode: postal ? `${postal[1]}-${postal[2]}` : "",
      website: urls[0] || "",
      rawText: text
    };
  }

  function mode() { return sourceMode || "未初期化"; }
  return { recognize, extract, mode };
})();
