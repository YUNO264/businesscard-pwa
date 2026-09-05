
const Backup = (() => {
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCSV(cards) {
    const header = ["会社名","会社名かな","姓","名","氏名かな","部署","役職","固定電話","携帯電話","メール","郵便番号","住所","Webサイト","分類","タグ","メモ","登録日","更新日"];
    const rows = cards.map(c => [
      c.company,c.companyKana,c.lastName,c.firstName,c.nameKana,c.department,c.position,
      c.phone,c.mobile,c.email,c.postalCode,c.address,c.website,c.category,
      (c.tags || []).join(" | "),c.memo,c.createdAt,c.updatedAt
    ]);
    const csv = "\uFEFF" + [header, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
    download(`business_cards_${dateStamp()}.csv`, new Blob([csv], {type:"text/csv;charset=utf-8"}));
  }

  async function exportJSON(cards, settings) {
    const payload = {
      app: "business-card-pwa",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      cards
    };
    download(`business_cards_backup_${dateStamp()}.json`,
      new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"}));
  }

  async function importJSON(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || data.app !== "business-card-pwa" || !Array.isArray(data.cards)) {
      throw new Error("このアプリのバックアップJSONではありません。");
    }
    return data;
  }

  function dateStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2,"0");
    return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;
  }

  return { exportCSV, exportJSON, importJSON };
})();
