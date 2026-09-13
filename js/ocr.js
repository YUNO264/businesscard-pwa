
const LocalOCR = (() => {
  let worker = null;

  const FILES = {
    api: "./vendor/tesseract.min.js",
    worker: "./vendor/worker.min.js",
    coreDir: "./vendor/core/",
    jpn: "./tessdata/jpn.traineddata.gz",
    eng: "./tessdata/eng.traineddata.gz"
  };

  async function headOrGet(path) {
    try {
      let r = await fetch(path, { method: "HEAD", cache: "no-store" });
      if (r.ok) return { ok:true, status:r.status };
      r = await fetch(path, { method: "GET", cache: "no-store" });
      return { ok:r.ok, status:r.status };
    } catch (e) {
      return { ok:false, status:0, error:e.message };
    }
  }

  async function selfCheck() {
    const result = {};
    result.tesseractGlobal = typeof window.Tesseract !== "undefined";
    result.worker = await headOrGet(FILES.worker);
    result.jpn = await headOrGet(FILES.jpn);
    result.eng = await headOrGet(FILES.eng);

    // One of these core JS loaders will be selected depending on device capabilities.
    const coreBases = [
      "tesseract-core",
      "tesseract-core-simd",
      "tesseract-core-lstm",
      "tesseract-core-simd-lstm",
      "tesseract-core-relaxedsimd",
      "tesseract-core-relaxedsimd-lstm"
    ];
    result.core = {};
    for (const base of coreBases) {
      const js = await headOrGet(FILES.coreDir + base + ".wasm.js");
      const wasm = await headOrGet(FILES.coreDir + base + ".wasm");
      result.core[base] = { js: js.ok, wasm: wasm.ok, pair: js.ok && wasm.ok };
    }
    result.coreAny = Object.values(result.core).some(x => x.pair);
    result.ready = result.tesseractGlobal && result.worker.ok && result.jpn.ok && result.eng.ok && result.coreAny;
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
    onProgress?.({stage:"api", text:"Tesseract.js確認完了"});

    // Tesseract.js v7 API: createWorker(langs, oem, options)
    worker = await Tesseract.createWorker(["jpn","eng"], 1, {
      workerPath: FILES.worker,
      corePath: FILES.coreDir,
      langPath: "./tessdata",
      logger: m => {
        const text = progressText(m);
        let stage = "worker";
        if ((m.status || "").includes("language")) stage = "lang";
        if ((m.status || "").includes("recognizing")) stage = "recognize";
        onProgress?.({stage, text, raw:m});
      }
    });
    onProgress?.({stage:"worker", text:"Worker起動完了"});
    onProgress?.({stage:"lang", text:"日本語・英語データ読込完了"});
    return worker;
  }

  async function recognize(image, onProgress) {
    const w = await ensureWorker(onProgress);
    onProgress?.({stage:"recognize", text:"文字認識開始"});
    const ret = await w.recognize(image);
    const text = ret?.data?.text || "";
    onProgress?.({stage:"recognize", text:`文字認識完了（${text.trim().length}文字）`});
    return text;
  }

  function cleanPhone(v) {
    return (v || "").replace(/[‐‑‒–—―ー]/g, "-").replace(/\s+/g, " ").trim();
  }

  function splitNameCandidate(lines, excluded = new Set()) {
    // Conservative Japanese name guess: a short line with 2-8 JP chars and a visible space,
    // not company/dept/title/address/phone/mail.
    const jp = /^[一-龥々ぁ-んァ-ヶー\s]{2,12}$/;
    const bad = /(株式会社|有限会社|合同会社|部|課|室|本部|センター|〒|TEL|FAX|Mobile|E-?mail|@|取締役|社長|部長|課長|係長|主任)/i;
    for (const line of lines) {
      if (excluded.has(line) || bad.test(line)) continue;
      if (!jp.test(line)) continue;
      const parts = line.replace(/\s+/g, " ").trim().split(" ");
      if (parts.length === 2 && parts[0].length <= 5 && parts[1].length <= 5) {
        return {lastName:parts[0], firstName:parts[1]};
      }
    }
    return {lastName:"", firstName:""};
  }

  function extract(text) {
    const rawLines = text.split(/\r?\n/).map(x => x.replace(/[|｜]/g," ").replace(/\s+/g," ").trim()).filter(Boolean);
    const joined = rawLines.join("\n");

    const emails = [...joined.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)].map(m=>m[0]);
    const urls = [...joined.matchAll(/(?:https?:\/\/|www\.)[^\s]+/ig)].map(m=>m[0].replace(/[),.;]+$/,""));
    const postal = joined.match(/〒?\s*(\d{3})[-ー‐‑‒–—―]?\s*(\d{4})/);

    const phoneCandidates = [];
    for (const line of rawLines) {
      const ms = line.match(/(?:\+?\d[\d\-()‐‑‒–—―ー\s]{7,}\d)/g);
      if (ms) phoneCandidates.push(...ms.map(cleanPhone));
    }
    const uniquePhones = [...new Set(phoneCandidates)];
    const mobile = uniquePhones.find(p => /^(?:\+?81[-\s]?)?0?[789]0/.test(p.replace(/[()\s]/g,""))) || "";
    const phone = uniquePhones.find(p => p !== mobile) || uniquePhones[0] || "";

    const companyRe = /(株式会社|有限会社|合同会社|合資会社|Inc\.?|Corporation|Corp\.?|Co\.,?\s*Ltd\.?|Ltd\.?)/i;
    const company = rawLines.find(x => companyRe.test(x)) || "";

    const deptRe = /(本部|事業部|営業部|技術部|開発部|製造部|品質|生産技術|営業課|技術課|開発課|課|部|室|グループ|センター)/;
    const department = rawLines.find(x => deptRe.test(x) && x !== company && x.length <= 30) || "";

    const posRe = /(代表取締役|取締役|執行役員|社長|専務|常務|部長|次長|課長|係長|主任|主査|マネージャー|Manager|Director|Chief)/i;
    const position = rawLines.find(x => posRe.test(x) && x !== department) || "";

    const excluded = new Set([company, department, position]);
    const name = splitNameCandidate(rawLines, excluded);

    // Address heuristic: line around postal code, or prefecture/city markers.
    const addressRe = /(都|道|府|県).*(市|区|町|村)|市.+[町丁目]|区.+[町丁目]/;
    let address = rawLines.find(x => addressRe.test(x)) || "";
    if (!address && postal) {
      const i = rawLines.findIndex(x => x.includes(postal[0]) || x.includes(postal[1]));
      if (i >= 0 && rawLines[i+1]) address = rawLines[i+1];
    }

    return {
      company,
      lastName:name.lastName,
      firstName:name.firstName,
      department,
      position,
      phone,
      mobile,
      email:emails[0] || "",
      postalCode:postal ? `${postal[1]}-${postal[2]}` : "",
      address,
      website:urls[0] || "",
      rawText:text
    };
  }

  async function terminate() {
    if (worker) {
      try { await worker.terminate(); } catch {}
      worker = null;
    }
  }

  return { selfCheck, recognize, extract, terminate, FILES };
})();
