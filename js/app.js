
const App = (() => {
  const DEFAULT_CATEGORIES = [
    "設備メーカー","工具メーカー","商社","加工業者","ソフトウェア","測定機メーカー","大学・研究機関","その他"
  ];

  let currentImageData = null;
  let currentOcrImageData = null;
  let currentImageFile = null;
  let currentOcrRegions = [];
  let currentOcrOrientation = "horizontal";
  let cards = [];
  let categories = [...DEFAULT_CATEGORIES];

  const $ = id => document.getElementById(id);
  const removeOcrSpacesPreserveLines = text =>
    String(text || "")
      .split(/\r?\n/)
      .map(line => line.replace(/[ \t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, ""))
      .join("\n");


  async function init() {
    await CardDB.open();
    categories = await CardDB.getSetting("categories", DEFAULT_CATEGORIES);
    $("defaultSaveImage").checked = await CardDB.getSetting("defaultSaveImage", false);
    bind();
    populateCategories();
    await refresh();
    show("viewList");
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch(console.error);
    }
  }

  function bind() {
    $("btnNew").onclick = newCard;
    $("navNew").onclick = newCard;
    $("navCards").onclick = () => show("viewList");
    $("btnBack").onclick = () => show("viewList");
    $("btnSettingsBack").onclick = () => show("viewList");
    $("navSettings").onclick = openSettings;

    $("searchInput").addEventListener("input", renderList);
    $("categoryFilter").addEventListener("change", renderList);
    $("sortSelect").addEventListener("change", renderList);

    $("cardForm").addEventListener("submit", saveCard);
    $("btnDelete").onclick = deleteCurrent;
    $("imageInput").addEventListener("change", handleImage);
    $("btnOCR").onclick = runOCR;
    $("btnReanalyze").onclick = reanalyzeRaw;
    $("btnApplyRegions").onclick = applyRegionsToForm;
    $("btnResetRegions").onclick = resetRegionTypes;
    $("btnOcrCheck").onclick = runOcrSelfCheck;

    $("btnExportCsv").onclick = async () => Backup.exportCSV(await CardDB.getAllCards());
    $("btnExportJson").onclick = async () => Backup.exportJSON(await CardDB.getAllCards(), await CardDB.getAllSettings());
    $("importJson").addEventListener("change", restoreJSON);
    $("btnSaveSettings").onclick = saveSettings;
    $("btnDeleteAll").onclick = deleteAll;
  }

  function show(id) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    $(id).classList.add("active");
    $("navCards").classList.toggle("nav-active", id === "viewList");
    $("navSettings").classList.toggle("nav-active", id === "viewSettings");
    window.scrollTo(0,0);
  }

  async function refresh() {
    cards = await CardDB.getAllCards();
    renderList();
  }

  function populateCategories() {
    const opts = categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    $("category").innerHTML = `<option value="">未分類</option>${opts}`;
    $("categoryFilter").innerHTML = `<option value="">すべての分類</option>${opts}`;
    $("categorySettings").value = categories.join("\n");
  }

  function normalize(s) {
    return String(s ?? "").normalize("NFKC").toLowerCase();
  }

  function searchable(c) {
    return normalize([
      c.company,c.companyKana,c.lastName,c.firstName,c.nameKana,c.department,c.position,
      c.phone,c.mobile,c.email,c.postalCode,c.address,c.website,c.category,
      ...(c.tags || []),c.memo
    ].join(" "));
  }

  function renderList() {
    const words = normalize($("searchInput").value).split(/\s+/).filter(Boolean);
    const cat = $("categoryFilter").value;
    let list = cards.filter(c => (!cat || c.category === cat) && words.every(w => searchable(c).includes(w)));

    switch ($("sortSelect").value) {
      case "company_asc":
        list.sort((a,b) => normalize(a.company).localeCompare(normalize(b.company),"ja")); break;
      case "name_asc":
        list.sort((a,b) => normalize((a.lastName||"")+(a.firstName||"")).localeCompare(normalize((b.lastName||"")+(b.firstName||"")),"ja")); break;
      default:
        list.sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }

    $("summary").textContent = `${list.length}件 / 全${cards.length}件`;
    $("emptyState").classList.toggle("hidden", list.length !== 0);
    $("cardList").innerHTML = list.map(c => {
      const fullName = `${c.lastName || ""} ${c.firstName || ""}`.trim() || "氏名未登録";
      const meta = [c.department,c.position,c.category].filter(Boolean).join(" / ");
      return `<article class="card-item">
        <button data-id="${c.id}">
          <div class="card-name">${escapeHtml(fullName)}</div>
          <div class="card-company">${escapeHtml(c.company || "会社名未登録")}</div>
          ${meta ? `<div class="card-meta">${escapeHtml(meta)}</div>` : ""}
          <div class="tags">${(c.tags||[]).slice(0,8).map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join("")}</div>
        </button>
      </article>`;
    }).join("");

    document.querySelectorAll(".card-item button").forEach(b => b.onclick = () => editCard(b.dataset.id));
  }

  function newCard() {
    $("cardForm").reset();
    $("cardId").value = "";
    $("editTitle").textContent = "名刺登録";
    $("btnDelete").classList.add("hidden");
    $("imagePreview").classList.add("hidden");
    $("imagePreview").src = "";
    currentImageData = null;
    currentOcrImageData = null;
    currentImageFile = null;
    $("autoCardCorrection").checked = true;
    $("correctionStatus").textContent = "補正待機中";
    $("correctedPreview").src = "";
    $("correctedPreviewWrap").classList.add("hidden");
    $("saveImage").checked = $("defaultSaveImage").checked;
    $("ocrStatus").textContent = "待機中";
    $("ocrRawText").value = "";
    $("btnReanalyze").classList.add("hidden");
    currentOcrRegions = [];
    currentOcrOrientation = "horizontal";
    if ($("ocrDirection")) $("ocrDirection").value = "auto";
    if ($("ocrModeUsed")) $("ocrModeUsed").textContent = "";
    renderOcrRegions();
    resetOcrSteps();
    show("viewEdit");
  }

  async function editCard(id) {
    const c = await CardDB.getCard(id);
    if (!c) return;
    $("cardId").value = c.id;
    $("company").value = c.company || "";
    $("companyKana").value = c.companyKana || "";
    $("lastName").value = c.lastName || "";
    $("firstName").value = c.firstName || "";
    $("nameKana").value = c.nameKana || "";
    $("department").value = c.department || "";
    $("position").value = c.position || "";
    $("phone").value = c.phone || "";
    $("mobile").value = c.mobile || "";
    $("email").value = c.email || "";
    $("postalCode").value = c.postalCode || "";
    $("address").value = c.address || "";
    $("website").value = c.website || "";
    $("category").value = c.category || "";
    $("tags").value = (c.tags || []).join(", ");
    $("memo").value = c.memo || "";
    $("ocrRawText").value = c.ocrRawText || "";
    $("btnReanalyze").classList.toggle("hidden", !$("ocrRawText").value);
    currentOcrRegions = Array.isArray(c.ocrRegions) ? c.ocrRegions.map(r => ({...r, bbox:{...r.bbox}})) : [];
    currentOcrOrientation = c.ocrOrientation || "horizontal";
    if ($("ocrDirection")) $("ocrDirection").value = c.ocrRequestedMode || "auto";
    if ($("ocrModeUsed")) $("ocrModeUsed").textContent =
      currentOcrRegions.length ? `保存済みOCR方向: ${currentOcrOrientation === "vertical" ? "縦書き" : "横書き"}` : "";
    renderOcrRegions();
    $("saveImage").checked = !!c.imageData;
    currentImageData = c.imageData || null;
    currentOcrImageData = c.imageData || null;
    currentImageFile = null;
    $("autoCardCorrection").checked = c.ocrCorrectionEnabled !== false;
    $("correctionStatus").textContent = c.ocrCorrectionApplied
      ? "保存済み画像は外周補正済みです。"
      : "保存済み画像";
    $("correctedPreview").src = "";
    $("correctedPreviewWrap").classList.add("hidden");
    if (currentImageData) {
      $("imagePreview").onload = () => drawOcrOverlay(currentOcrRegions);
      $("imagePreview").src = currentImageData;
      $("imagePreview").classList.remove("hidden");
    } else {
      $("imagePreview").classList.add("hidden");
      $("imagePreview").src = "";
    }
    $("editTitle").textContent = "名刺編集";
    $("btnDelete").classList.remove("hidden");
    show("viewEdit");
  }

  async function saveCard(e) {
    e.preventDefault();
    const now = new Date().toISOString();
    const id = $("cardId").value || crypto.randomUUID();
    const existing = $("cardId").value ? await CardDB.getCard(id) : null;
    const card = {
      id,
      company: $("company").value.trim(),
      companyKana: $("companyKana").value.trim(),
      lastName: $("lastName").value.trim(),
      firstName: $("firstName").value.trim(),
      nameKana: $("nameKana").value.trim(),
      department: $("department").value.trim(),
      position: $("position").value.trim(),
      phone: $("phone").value.trim(),
      mobile: $("mobile").value.trim(),
      email: $("email").value.trim(),
      postalCode: $("postalCode").value.trim(),
      address: $("address").value.trim(),
      website: $("website").value.trim(),
      category: $("category").value,
      tags: $("tags").value.split(/[,\n、]/).map(x => x.trim()).filter(Boolean),
      memo: $("memo").value.trim(),
      ocrRawText: $("ocrRawText").value.trim(),
      ocrOrientation: currentOcrOrientation,
      ocrRequestedMode: $("ocrDirection")?.value || "auto",
      ocrCorrectionEnabled: $("autoCardCorrection")?.checked !== false,
      ocrCorrectionApplied: !!currentOcrImageData && currentOcrImageData !== currentImageData,
      ocrRegions: currentOcrRegions.map(r => ({
        id:r.id, text:r.text, bbox:{...r.bbox}, confidence:r.confidence,
        avgHeight:r.avgHeight, type:r.type, autoType:r.autoType, score:r.score
      })),
      imageData: $("saveImage").checked ? (currentOcrImageData || currentImageData) : null,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    const duplicate = cards.find(c => c.id !== id && (
      (card.email && normalize(c.email) === normalize(card.email)) ||
      (card.mobile && digits(c.mobile) && digits(c.mobile) === digits(card.mobile)) ||
      (card.phone && digits(c.phone) && digits(c.phone) === digits(card.phone)) ||
      (card.company && card.lastName && card.firstName &&
       normalize(c.company) === normalize(card.company) &&
       normalize(c.lastName) === normalize(card.lastName) &&
       normalize(c.firstName) === normalize(card.firstName))
    ));
    if (duplicate && !confirm(`似た名刺が登録されています。\n${duplicate.company || ""} ${duplicate.lastName || ""} ${duplicate.firstName || ""}\n\nそれでも保存しますか？`)) return;

    await CardDB.putCard(card);
    await refresh();
    show("viewList");
  }

  async function deleteCurrent() {
    const id = $("cardId").value;
    if (!id) return;
    if (!confirm("この名刺を削除しますか？")) return;
    await CardDB.deleteCard(id);
    await refresh();
    show("viewList");
  }

  function handleImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    currentImageFile = file;
    const reader = new FileReader();
    reader.onload = async ev => {
      currentImageData = await resizeImage(ev.target.result, 1600, 0.88);
      currentOcrImageData = null;
      $("correctionStatus").textContent = "補正待機中";
      $("correctedPreview").src = "";
      $("correctedPreviewWrap").classList.add("hidden");
      $("imagePreview").src = currentImageData;
      $("imagePreview").classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  }

  function resizeImage(dataUrl, maxSide, quality) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = dataUrl;
    });
  }

  const OCR_TYPE_LABELS = {
    company:"会社", name:"氏名", department:"部署", position:"役職", address:"住所",
    phone:"電話", mobile:"携帯", fax:"FAX", email:"メール", website:"Web", other:"その他"
  };

  function renderOcrRegions() {
    const panel = $("ocrLayoutPanel");
    if (!currentOcrRegions.length) {
      panel.classList.add("hidden");
      $("ocrRegionList").innerHTML = "";
      const canvas = $("ocrCanvas");
      canvas.width = 1; canvas.height = 1;
      return;
    }
    panel.classList.remove("hidden");
    const options = Object.entries(OCR_TYPE_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join("");
    currentOcrRegions = LocalOCR.sortedByVisual(currentOcrRegions, currentOcrOrientation);
    $("ocrRegionList").innerHTML = currentOcrRegions
      .map(r => `<div class="ocr-region-row" data-region="${r.id}">
        <div class="ocr-reading-order">${r.readingOrder ?? ""}</div>
        <select class="ocr-region-type">${options}</select>
        <div class="ocr-region-text">${escapeHtml(r.text)}</div>
        <div class="ocr-region-meta">信頼度 ${Math.round(r.confidence || 0)}%</div>
      </div>`).join("");

    document.querySelectorAll(".ocr-region-row").forEach(row => {
      const r = currentOcrRegions.find(x => x.id === row.dataset.region);
      const sel = row.querySelector("select");
      sel.value = r?.type || "other";
      sel.onchange = () => {
        if (r) r.type = sel.value;
        drawOcrOverlay(currentOcrRegions);
      };
    });
    drawOcrOverlay(currentOcrRegions);
  }

  function drawOcrOverlay(regions) {
    const canvas = $("ocrCanvas");
    if (!regions?.length || !(currentOcrImageData || currentImageData)) {
      canvas.classList.add("hidden");
      return;
    }
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const scale = Math.max(1, canvas.width / 900);
      ctx.lineWidth = Math.max(2, 2 * scale);
      ctx.font = `${Math.max(15, 16 * scale)}px sans-serif`;
      ctx.textBaseline = "top";
      for (const r of regions) {
        const b = r.bbox;
        ctx.strokeStyle = "#0066cc";
        ctx.fillStyle = "rgba(0,102,204,0.10)";
        ctx.strokeRect(b.x0, b.y0, Math.max(1,b.x1-b.x0), Math.max(1,b.y1-b.y0));
        ctx.fillRect(b.x0, b.y0, Math.max(1,b.x1-b.x0), Math.max(1,b.y1-b.y0));
        const label = `${r.readingOrder ?? ""} ${OCR_TYPE_LABELS[r.type] || "その他"}`.trim();
        const w = ctx.measureText(label).width + 10 * scale;
        const h = Math.max(19, 20 * scale);
        const ly = Math.max(0, b.y0 - h);
        ctx.fillStyle = "rgba(0,102,204,0.88)";
        ctx.fillRect(b.x0, ly, w, h);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, b.x0 + 5 * scale, ly + 1 * scale);
      }
      canvas.classList.remove("hidden");
    };
    img.src = currentOcrImageData || currentImageData;
  }

  function applyRegionsToForm() {
    if (!currentOcrRegions.length) return;
    const fields = LocalOCR.fieldsFromRegions(currentOcrRegions, currentOcrOrientation);
    applyExtracted(fields, true);
    $("ocrStatus").textContent = "修正した分類をフォームへ反映しました。内容を確認してください。";
  }

  function resetRegionTypes() {
    currentOcrRegions = currentOcrRegions.map(r => ({...r, type:r.autoType || "other"}));
    renderOcrRegions();
    const fields = LocalOCR.fieldsFromRegions(currentOcrRegions, currentOcrOrientation);
    applyExtracted(fields, true);
    $("ocrStatus").textContent = "自動分類に戻しました。";
  }

  function resetOcrSteps() {
    document.querySelectorAll("#ocrSteps [data-step]").forEach(el => {
      const label = el.textContent.replace(/^[✓▶✕○]\s*/, "");
      el.textContent = `○ ${label}`;
      el.classList.remove("running","done","error");
    });
  }

  function setOcrStep(step, state, text=null) {
    const el = document.querySelector(`#ocrSteps [data-step="${step}"]`);
    if (!el) return;
    const base = text || el.textContent.replace(/^[✓▶✕○]\s*/, "");
    el.classList.remove("running","done","error");
    if (state === "done") {
      el.textContent = `✓ ${base}`; el.classList.add("done");
    } else if (state === "running") {
      el.textContent = `▶ ${base}`; el.classList.add("running");
    } else if (state === "error") {
      el.textContent = `✕ ${base}`; el.classList.add("error");
    } else {
      el.textContent = `○ ${base}`;
    }
  }

  function applyExtracted(x, overwrite=false) {
    const put = (id, value) => {
      if (!value) return;
      if (overwrite || !$(id).value.trim()) $(id).value = value;
    };
    put("company", x.company);
    put("lastName", x.lastName);
    put("firstName", x.firstName);
    put("department", x.department);
    put("position", x.position);
    put("phone", x.phone);
    put("mobile", x.mobile);
    put("email", x.email);
    put("postalCode", x.postalCode);
    put("address", x.address);
    put("website", x.website);
  }

  async function reanalyzeRaw() {
    const text = $("ocrRawText").value.trim();
    if (!text) {
      alert("OCR全文がありません。");
      return;
    }
    setOcrStep("analyze","running","OCR全文を再解析中（座標なし）");
    const x = LocalOCR.extract(text);
    currentOcrRegions = (x.regions || []).map(r => ({...r, bbox:{...r.bbox}}));
    currentOcrOrientation = "horizontal";
    if ($("ocrModeUsed")) $("ocrModeUsed").textContent = "OCR全文の再解析: 座標なし（横書き扱い）";
    renderOcrRegions();
    applyExtracted(x, false);
    setOcrStep("analyze","done","全文再解析完了");
    $("ocrStatus").textContent = "OCR全文を再解析しました。座標情報を使わない補助解析です。";
  }

  async function runOCR() {
    if (!currentImageData && !currentImageFile) {
      alert("先に名刺画像を撮影または選択してください。");
      return;
    }

    resetOcrSteps();
    $("ocrRawText").value = "";
    $("btnReanalyze").classList.add("hidden");
    currentOcrRegions = [];
    renderOcrRegions();
    $("btnOCR").disabled = true;

    try {
      let ocrInput = currentImageData || currentImageFile;

      if ($("autoCardCorrection")?.checked && currentImageData) {
        setOcrStep("preprocess","running","名刺外周を検出中");
        $("ocrStatus").textContent = "名刺外周を検出して傾きを補正中…";
        $("correctionStatus").textContent = "外周検出中…";

        const corrected = await CardPreprocess.correctCardImage(currentImageData, message => {
          $("correctionStatus").textContent = message;
          $("ocrStatus").textContent = message;
        });

        currentOcrImageData = corrected.dataUrl;
        ocrInput = currentOcrImageData;

        if (corrected.corrected) {
          $("correctedPreview").src = currentOcrImageData;
          $("correctedPreviewWrap").classList.remove("hidden");
          $("correctionStatus").textContent = corrected.message;

          if (corrected.method === "opencv-perspective") {
            setOcrStep("preprocess","done","OpenCV: 外周4点・台形補正完了");
          } else {
            setOcrStep("preprocess","done","JS: 傾き回転補正完了");
          }
        } else {
          $("correctedPreview").src = "";
          $("correctedPreviewWrap").classList.add("hidden");
          $("correctionStatus").textContent = corrected.message;
          setOcrStep("preprocess","done","補正不要/元画像を使用");
        }
      } else {
        currentOcrImageData = currentImageData;
        setOcrStep("preprocess","done","画像補正なし");
        $("correctionStatus").textContent = "画像補正はOFFです。";
      }

      $("ocrStatus").textContent = "OCR資材を確認中…";
      setOcrStep("api","running","Tesseract.js確認中");

      const check = await LocalOCR.selfCheck();
      if (!check.ready) {
        setOcrStep("api", check.tesseractGlobal ? "done" : "error",
                   check.tesseractGlobal ? "Tesseract.js確認完了" : "Tesseract.js未読込");
        if (!check.worker.ok) setOcrStep("worker","error","worker.min.jsが見つかりません");
        if (!check.jpn.ok || !check.eng.ok) setOcrStep("lang","error","言語データが見つかりません");
        if (!check.coreAll) setOcrStep("worker","error","LSTM core 3種類が揃っていません");
        throw new Error("OCR資材が不足しています。SETUP_OCR_FINAL.batを実行してから再確認してください。");
      }

      setOcrStep("api","done","Tesseract.js確認完了");
      setOcrStep("worker","running","Worker起動中");
      $("ocrStatus").textContent = "Worker起動中…";

      const requestedMode = $("ocrDirection")?.value || "auto";
      const layout = await LocalOCR.recognizeLayout(ocrInput, info => {
        $("ocrStatus").textContent = info.text;
        if (info.stage === "api") setOcrStep("api","done",info.text);
        if (info.stage === "worker") setOcrStep("worker", info.text.includes("完了") ? "done":"running", info.text);
        if (info.stage === "lang") setOcrStep("lang", info.text.includes("完了") ? "done":"running", info.text);
        if (info.stage === "recognize") setOcrStep("recognize", info.text.includes("完了") ? "done":"running", info.text);
      }, requestedMode);

      if (!layout.text.trim() && !layout.regions.length) {
        throw new Error("OCRは完了しましたが文字を認識できませんでした。画像の向き・明るさ・ピントを確認してください。");
      }

      $("ocrRawText").value = removeOcrSpacesPreserveLines(layout.text).trim();
      $("btnReanalyze").classList.toggle("hidden", !layout.text.trim());
      currentOcrRegions = layout.regions.map(r => ({...r, bbox:{...r.bbox}}));
      currentOcrOrientation = layout.orientation || "horizontal";
      if ($("ocrModeUsed")) {
        const modeText = currentOcrOrientation === "vertical" ? "縦書き" : "横書き";
        const autoText = requestedMode === "auto" ? "（自動判定）" : "（手動指定）";
        $("ocrModeUsed").textContent = `採用OCR方向: ${modeText}${autoText}`;
      }
      renderOcrRegions();
      setOcrStep("recognize","done",`座標付き文字認識完了（${currentOcrRegions.length}領域）`);

      $("ocrStatus").textContent = "位置関係を解析して項目分類中…";
      setOcrStep("analyze","running","座標・内容から項目分類中");
      applyExtracted(layout.fields, false);
      setOcrStep("analyze","done","座標解析・転記完了");
      $("ocrStatus").textContent = "OCR完了。下のレイアウト解析結果を確認し、誤分類だけ修正してください。";
    } catch (err) {
      $("ocrStatus").textContent = `OCR停止: ${err.message}`;
      console.error(err);
      alert(err.message);
    } finally {
      $("btnOCR").disabled = false;
    }
  }

  async function runOcrSelfCheck() {
    $("ocrCheckResult").textContent = "確認中…";
    const [c, p] = await Promise.all([
      LocalOCR.selfCheck(),
      CardPreprocess.selfCheck()
    ]);
    const coreCount = Object.values(c.core || {}).filter(x => x && x.pair).length;
    $("ocrCheckResult").textContent =
`OpenCV.js:    ${p.ready ? "OK" : "NG（任意）"}${p.ready ? ` (${p.source === "local" ? "local" : "CDN"})` : ""}
JS傾き補正:   OK
OpenCV詳細:   ${p.ready ? "4点透視補正を使用可能" : (p.error || "未初期化")}
Tesseract.js: ${c.tesseractGlobal ? "OK" : "NG"}
Worker:       ${c.worker?.ok ? "OK" : "NG"}
Japanese:     ${c.jpn?.ok ? "OK" : "NG"}
Japanese Vert: ${c.jpnVert?.ok ? "OK" : "NG"}
English:      ${c.eng?.ok ? "OK" : "NG"}
LSTM Core:    ${c.coreAll ? `OK (${coreCount}/3)` : `NG (${coreCount}/3)`}
------------------------
総合判定:      ${c.ready ? (p.ready ? "OpenCV外周補正＋OCR実行可能" : "JS傾き補正＋OCR実行可能") : "OCR資材不足"}

Tesseract関連がNGの場合のみ SETUP_OCR_FINAL.bat を実行してください。OpenCV NGだけならOCRは実行できます。`;
  }

  async function openSettings() {
    $("defaultSaveImage").checked = await CardDB.getSetting("defaultSaveImage", false);
    $("categorySettings").value = categories.join("\n");
    await updateStats();
    show("viewSettings");
  }

  async function updateStats() {
    const all = await CardDB.getAllCards();
    const approx = new Blob([JSON.stringify(all)]).size;
    const imageBytes = all.reduce((sum,c) => sum + (c.imageData ? c.imageData.length * 0.75 : 0), 0);
    $("stats").innerHTML = `登録件数：<strong>${all.length}件</strong><br>概算データ容量：<strong>${formatBytes(approx)}</strong><br>概算画像容量：<strong>${formatBytes(imageBytes)}</strong>`;
  }

  async function saveSettings() {
    categories = $("categorySettings").value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (!categories.length) categories = [...DEFAULT_CATEGORIES];
    await CardDB.setSetting("categories", categories);
    await CardDB.setSetting("defaultSaveImage", $("defaultSaveImage").checked);
    populateCategories();
    alert("設定を保存しました。");
  }

  async function restoreJSON(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await Backup.importJSON(file);
      if (!confirm(`${data.cards.length}件のデータを復元します。\n同じIDの名刺は上書きされます。`)) return;
      for (const c of data.cards) await CardDB.putCard(c);
      if (data.settings) {
        for (const [k,v] of Object.entries(data.settings)) await CardDB.setSetting(k,v);
      }
      categories = await CardDB.getSetting("categories", DEFAULT_CATEGORIES);
      populateCategories();
      await refresh();
      await updateStats();
      alert("復元しました。");
    } catch (err) {
      alert(`復元失敗: ${err.message}`);
    } finally {
      e.target.value = "";
    }
  }

  async function deleteAll() {
    const word = prompt("全データを削除する場合は「削除」と入力してください。");
    if (word !== "削除") return;
    await CardDB.clearCards();
    await refresh();
    await updateStats();
    alert("全名刺データを削除しました。");
  }

  function digits(s) { return String(s || "").replace(/\D/g,""); }

  function formatBytes(n) {
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
    return `${(n/1024/1024).toFixed(1)} MB`;
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    })[ch]);
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", App.init);
