# LifeSpan 資料結構文件（Data Schema）

供未來**後端移轉**對照使用。本 App 為單頁前端，資料以 JSON 儲存，結構穩定、每筆具唯一 `id` 與 ISO-8601 時間戳，可直接映射到關聯式資料庫或文件資料庫。

---

## 1. 儲存位置

| 位置 | 內容 | 說明 |
|---|---|---|
| 瀏覽器 `localStorage['lifespan_data_v1']` | 完整 `state` 物件（JSON 字串） | 主要本機儲存 |
| Firestore `users/{uid}/lifespan/data` | `{profile, history[], labs[], meds[], habits{}, updatedAt}` | 雲端同步（選填，Firebase 登入後） |
| Firestore `users/{uid}/lifespan_images/{snapId}` | `{image(base64), kind, date}` | 報告原檔留底（選填） |
| 匯出檔 `lifespan-health-YYYY-MM-DD.json` | `{app, schemaVersion, exportedAt, data:state}` | 手動匯出（設定 → 資料管理） |
| 加密備份 `lifespan-health-YYYY-MM-DD.enc.json` | `{app, enc:'AES-GCM', kdf:'PBKDF2', hash:'SHA-256', iter, salt, iv, ct, exportedAt}` | 密碼加密備份（設定 → 備份與還原 → 🔒 加密備份） |
| 匯出檔 `lifespan-labs-YYYY-MM-DD.csv` | 檢驗數據平表 | 檢驗數據庫 CSV 匯出 |

> **加密備份格式**：以 Web Crypto 於本機加密，密碼永不離開裝置。`salt`（16 bytes）/`iv`（12 bytes）/`ct`（密文，含 GCM 驗證標籤）皆為 base64；金鑰由密碼經 **PBKDF2-SHA256、150,000 次迭代**推導出 **AES-GCM 256-bit**。明文即上方標準匯出檔 `{app, schemaVersion, exportedAt, data:state}`。還原時由「還原（選備份檔）」自動偵測 `enc==='AES-GCM'` 後提示輸入密碼；密碼錯誤會在解密時丟出例外並中止，原資料不受影響。**忘記密碼將無法還原**。

> `schemaVersion` 目前為 **1**。匯入同時相容舊格式（無中繼、直接是 `state`）。

---

## 2. `state`（根物件）

```jsonc
{
  "profile":   { /* 見 §3，最後一次評估的輸入 */ } | null,
  "result":    { /* 見 §4，最後一次計算結果 */ } | null,
  "history":   [ /* 見 §5，健康紀錄點快照，時序 */ ],
  "labs":      [ /* 見 §6，檢驗數據，時序 */ ],
  "meds":      [ /* 見 §6.1，用藥紀錄，時序 */ ],
  "surgeries": [ /* 見 §6.2，手術紀錄，時序 */ ],
  "habits":    { "YYYY-MM-DD": { "water":true, ... } },
  "settings":  { /* 見 §7，本機設定；移轉時通常不入庫 */ },
  "dietVal":   1-5,
  "stressVal": 1-5
}
```

---

## 3. `profile`（個人檔案 / 評估輸入）

| 欄位 | 型別 | 單位／值 |
|---|---|---|
| sex | string | `male` \| `female` |
| age | number | 歲 |
| height | number | cm |
| weight | number | kg |
| waist | number | cm |
| hr | number | bpm（靜止心率） |
| sbp / dbp | number | mmHg（收縮／舒張壓） |
| glucose | number | mg/dL（空腹血糖） |
| chol / hdl | number | mg/dL |
| smoke | string | `never` \| `former` \| `current` |
| exercise | number | 分鐘/週 |
| alcohol | number | 份/週 |
| sleep | number | 小時/日 |
| sitting | number | 小時/日 |
| diet | number | 1–5（飲食品質） |
| stress | number | 1–5（壓力） |
| fhHeart / fhDiabetes / fhCancer | boolean | 家族史 |

未填的數值欄位為 `null`。

---

## 4. `result`（計算結果，衍生自 profile）

`{ bmi, whtr, bmr, tdee, sub:{cardio,body,activity,nutrition,sleep,substance,mental,metabolic}, score, bio, chrono, life, lifeMods:[{label,years}], potential, risks:{cvd,dm,mets}, date(ISO) }`
移轉時多屬可重算的衍生值，可選擇不入庫。

---

## 5. `history[]`（健康紀錄點，時序）

每次「存為紀錄點」新增一筆快照。建議後端表：`health_snapshots`。

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | string PK | `snap_<ms>` |
| date | string | ISO-8601 |
| source | string | `app` \| `image` \| `pdf` \| `nhi` \| `wearable` |
| sex,age,height,weight,waist,hr,sbp,dbp,glucose,chol,hdl | number | 同 §3 |
| smoke,exercise,alcohol,sleep,sitting,diet,stress | | 同 §3 |
| bmi,whtr,score,bio,life | number | 衍生指標 |
| cvdLevel,dmLevel | string | `低/中/高/極高` |
| metsCount | number | 代謝症候群符合項數 |
| img | 1?（選填） | 有留底原檔時為 1 |
| imgKind | string?（選填） | `image` \| `pdf` |

---

## 6. `labs[]`（檢驗數據，時序、核心移轉標的）

每次辨識／匯入／手動評估各新增一筆。建議後端表：`lab_records`（或正規化為 `lab_values`：一列一個 metric）。

```jsonc
{
  "id":     "lab_<base36ms><rand>",   // PK
  "date":   "2026-07-19T...Z",        // ISO-8601
  "source": "pdf",                     // image|pdf|nhi|wearable|app|manual
  "values": { "ldl":138, "hdl":45, "hba1c":5.9, ... },  // 見下表（標準代碼）
  "extra":  [ { "name":"游離甲狀腺素", "val":1.2 } ]     // 選填：未歸入標準代碼的檢驗項目（原始名稱＋數值），供「其他檢驗（未歸類）」呈現，不遺漏
}
```

> `extra[]` 保存健保／報告中名稱較特殊、尚未對應到上表標準 `key` 的檢驗值；僅有 `extra`（無 `values`）的紀錄也會保留。去重鍵含 `extra` 的（名稱:數值）組合。

**metric 代碼與單位**（`values` 內的鍵）：

| key | 名稱 | 單位 |
|---|---|---|
| sbp / dbp | 收縮／舒張壓 | mmHg |
| glucose | 空腹血糖 | mg/dL |
| hba1c | 糖化血色素 | % |
| chol | 總膽固醇 | mg/dL |
| hdl / ldl | HDL／LDL | mg/dL |
| tg | 三酸甘油酯 | mg/dL |
| waist | 腰圍 | cm |
| weight | 體重 | kg |
| hr | 心率 | bpm |
| height | 身高 | cm |

> 正規化建議：`lab_values(record_id FK, metric, value, unit)`，`metric` 用上表 key，方便任意項目的時序查詢與分析。

---

## 6.1 `meds[]`（用藥紀錄，時序）

由健保健康存摺 FHIR（`MedicationRequest`／`MedicationDispense`／`MedicationStatement`）解析，或手動新增。建議後端表：`medication_records`。

```jsonc
{
  "id":         "med_<base36ms><rand>",  // PK
  "date":       "2025-06-01T...Z",       // ISO-8601（authoredOn／whenHandedOver／effectiveDateTime…）
  "name":       "Amlodipine 5mg Tab",    // 藥品名（medicationCodeableConcept / 解析 medicationReference）
  "dose":       "每日一次，每次一顆",      // 用法用量（dosageInstruction.text 或 doseAndRate/timing）
  "route":      "口服",                   // 給藥途徑
  "days":       28,                       // 天數（expectedSupplyDuration / daysSupply）| null
  "qty":        "60tab",                  // 數量（quantity）
  "status":     "active",                 // FHIR status
  "kind":       "MedicationRequest",      // 來源資源型別
  "prescriber": "台大醫院",                // requester.display
  "source":     "nhi"                     // nhi | manual
}
```

> 去重鍵：`date(日)｜name｜dose`。跨裝置合併以 `id` 去重（雲端同步同 labs）。

---

## 6.2 `surgeries[]`（手術紀錄，時序）

由健保健康存摺醫療類 `myhealthbank.bdata`（住院／門診就醫紀錄中的手術／處置名稱）解析，或手動新增。建議後端表：`surgery_records`。

```jsonc
{
  "id":       "sur_<base36ms><rand>",  // PK
  "date":     "2023-10-09T...Z",       // ISO-8601（該次就醫日期）
  "name":     "開放性腓神經修補術",       // 手術／處置名稱
  "dx":       "周邊神經良性腫瘤",         // 相關診斷（best-effort）
  "hospital": "北港仁一醫",              // 院所
  "source":   "nhi"                     // nhi | manual
}
```

> 去重鍵：`date(日)｜name`。

---

## 6.2.1 `dx[]`（就醫診斷／病史，時序）

由健保健康存摺醫療類 `myhealthbank.bdata` 的門診／住院就醫紀錄解析（每列可含多組「ICD 碼＋中文診斷名」）。ICD-10 碼樣式為「英文字母＋2 位數字＋（可選）數字/字母」，藥品碼／處置碼不符此樣式，檢驗區（r7）不含 ICD 碼故不產生診斷。建議後端表：`diagnosis_records`。

```jsonc
{
  "id":       "dx_<base36ms><rand>",   // PK
  "date":     "2026-07-03T...Z",       // ISO-8601（就醫日期）
  "code":     "I10",                    // ICD-10 診斷碼
  "name":     "本態性(原發性)高血壓",     // 診斷名稱
  "hospital": "惠腎診所",                // 院所
  "source":   "nhi"                     // nhi | manual
}
```

> 去重鍵：`date(日)｜code｜name`。用途：作為慢性病「地面真相」，讓 `detectConditions()`（照護缺口、風險個人化）優先採用健保確診（如 `I10*`→高血壓、`E10–E14`→糖尿病、`N18`→CKD、`E78`→血脂異常），而非僅由檢驗值推斷。

---

## 6.2.2 `screen[]`（質性篩檢結果，時序）

健保檢驗區中**非數值**的篩檢結果（數值解析器會略過），目前擷取糞便潛血（FOBT／iFOBT）。用於讓「大腸癌篩檢」照護缺口能依實際完成日期與陰／陽性判斷，而非盲提醒。建議後端表：`screening_records`。

```jsonc
{
  "id":       "scr_<base36ms><rand>",  // PK
  "date":     "2026-04-21T...Z",       // ISO-8601（採檢日）
  "test":     "fobt",                   // 篩檢代碼（目前：fobt）
  "label":    "糞便潛血",                // 顯示名
  "result":   "neg",                    // neg | pos | unknown（陰性／陽性／無法判定）
  "raw":      "(-) ＜50",               // 原始結果字串
  "hospital": "嘉基醫院",
  "source":   "nhi"
}
```

> 去重鍵：`date(日)｜test｜result`。同日多筆時陽性優先（`latestScreen()`）。

---

## 6.3 `qa[]`（健康問答紀錄，時序）

「健康問答」中每一次提問與 AI 回覆各存一筆，永久保存於本機並隨雲端備份同步，供日後回顧。建議後端表：`qa_records`。

```jsonc
{
  "id": "qa_<base36ms><rand>",   // PK
  "ts": "2026-07-24T...Z",        // ISO-8601 提問時間
  "q":  "我的血脂該怎麼改善？",     // 使用者問題
  "a":  "根據你的資料，LDL 140…"    // AI 回覆（送出前為「⏳…」佔位，載入時會標記為未完成）
}
```

> 回覆時把 `profile`／`labs`／`meds`／風險評估／`goals` 整合為背景送給 AI；此處僅保存問答本身，不另存背景快照。

---

## 6.4 `reminders[]`、`goals{}`、`mhx{}`（提醒、個人目標、病史勾選）

- `reminders[]`：提醒（用藥／回診／復健／檢驗／量測／喝水／自訂）。欄位 `{id, type, title, freq(once|daily|weekly|monthly|months), time, startDate, weekday, interval, note, enabled, doneDates[], apptDate?, apptTime?, createdAt}`。建議後端表：`reminders`。
- `goals{}`：個人健康目標，`{ metric: 目標值 }`（metric ∈ sbp/dbp/ldl/hba1c/glucose/tg/hdl/ua/egfr/weight/waist）。
- `mhx{}`：病史勾選布林值 `{ af, chf, stroke, vascular, bleed, antiplt, alcohol, labileINR }`，供 CHA₂DS₂-VASc／HAS-BLED 評分。
- `footAssess[]`：垂足外觀 AI 評估歷程，`{ ts, side, severity, observations[], advice[], gait[], dorsiflexion, thumb(base64 小縮圖) }`，上限 8 筆，供追蹤外觀變化。建議後端表：`foot_assessments`。

---

## 7. `settings`（本機設定，一般不入庫）

`{ gemini, openai, engine, gas, autosync, fb, fbEmail, dailyAlert, lang, fontScale, remindSilent, visitAheadDays, visitAheadTime, gcalClientId, gdriveLast }` — 含 API 金鑰、OAuth Client ID 與 Firebase 設定，**屬機敏／裝置本機資訊，移轉時建議排除**。`dailyAlert`（預設 true）控制每日健康警戒彈窗；`gcalClientId` 供 Google 日曆／Drive 同步（公開值、非密鑰）；`fontScale`（預設 1.5）為文字放大倍率。

---

## 8. 移轉建議

- **主鍵穩定**：`history.id`、`labs.id` 皆唯一且不重複，可直接作 PK；跨裝置合併以 id 去重（現行雲端同步即以 id 合併）。
- **時序**：所有紀錄皆有 ISO-8601 `date`，可直接建時間索引。
- **正規化**：`labs` 建議拆成 `lab_records` + `lab_values` 兩表，最利於「按時間、類別」查詢與分析。
- **原檔**：報告影像存於 Firestore `lifespan_images`；若移到物件儲存（S3／GCS），以 `snapId` 命名即可對應。
- **相容**：匯出 JSON 已帶 `schemaVersion`，後端解析時應以此判斷版本。
