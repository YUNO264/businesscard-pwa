
const App = (() => {
  const DEFAULT_CATEGORIES = [
    "設備メーカー","工具メーカー","商社","加工業者","ソフトウェア","測定機メーカー","大学・研究機関","その他"
  ];

  let currentImageData = null;
  let currentImageFile = null;
  let cards = [];
  let categories = [...DEFAULT_CATEGORIES];

  const $ = id => document.getElementById(id);

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
    currentImageFile = null;
    $("saveImage").checked = $("defaultSaveImage").checked;
    $("ocrStatus").textContent = "";
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
    $("saveImage").checked = !!c.imageData;
    currentImageData = c.imageData || null;
    currentImageFile = null;
    if (currentImageData) {
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
      imageData: $("saveImage").checked ? currentImageData : null,
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
      currentImageData = await resizeImage(ev.target.result, 1600, 0.78);
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

  async function runOCR() {
    if (!currentImageFile && !currentImageData) {
      alert("先に名刺画像を撮影または選択してください。");
      return;
    }
    $("ocrStatus").textContent = "OCR準備中…";
    try {
      const text = await LocalOCR.recognize(currentImageFile || currentImageData, m => {
        if (m.status === "recognizing text") $("ocrStatus").textContent = `OCR ${Math.round((m.progress||0)*100)}%`;
        else if (m.status) $("ocrStatus").textContent = m.status;
      });
      const x = LocalOCR.extract(text);
      if (!$("company").value) $("company").value = x.company;
      if (!$("department").value) $("department").value = x.department;
      if (!$("position").value) $("position").value = x.position;
      if (!$("phone").value) $("phone").value = x.phone;
      if (!$("mobile").value) $("mobile").value = x.mobile;
      if (!$("email").value) $("email").value = x.email;
      if (!$("postalCode").value) $("postalCode").value = x.postalCode;
      if (!$("website").value) $("website").value = x.website;
      if (!$("memo").value) $("memo").value = `OCR全文:\n${x.rawText.trim()}`;
      $("ocrStatus").textContent = "OCR完了。内容を確認・修正してください。";
    } catch (err) {
      $("ocrStatus").textContent = "OCRを実行できませんでした。";
      alert(err.message);
    }
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
