
const LocalOCR = (() => {
  let worker = null;

  function available() {
    return typeof window.Tesseract !== "undefined";
  }

  async function ensureWorker(onProgress) {
    if (worker) return worker;
    if (!available()) {
      throw new Error("Tesseract.jsが未配置です。READMEのOCR設定を確認してください。");
    }
    worker = await Tesseract.createWorker(["jpn","eng"], 1, {
      workerPath: "./vendor/worker.min.js",
      corePath: "./vendor/",
      langPath: "./tessdata/",
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
      company,
      department,
      position,
      phone: phones[0] ? phones[0].replace(/\s+/g," ").trim() : "",
      mobile: phones.find(p => /090|080|070/.test(p.replace(/\D/g,""))) || "",
      email: emails[0] || "",
      postalCode: postal ? `${postal[1]}-${postal[2]}` : "",
      website: urls[0] || "",
      rawText: text
    };
  }

  return { available, recognize, extract };
})();
