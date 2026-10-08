# 產品指南

寫給要 **認識或使用** B2B System 的人：決策者、Reviewer、租戶的管理者、平台管理者。
系統怎麼設計、程式怎麼寫，在 [`../architecture/`](../architecture/) 與 [`../coding-standards/`](../coding-standards/README.md)。

## 先讀哪一份

| 你想知道 | 讀 |
| --- | --- |
| 這是什麼、有哪些能力、誰在用 | [`introduction/01-overview.md`](./introduction/01-overview.md) |
| 每個機制替哪些邊際情況想過答案、和常見後台有什麼不同 | [`introduction/02-introduction.md`](./introduction/02-introduction.md) |
| 每個畫面長什麼樣子、背後的規則 | [`introduction/03-feature-tour.md`](./introduction/03-feature-tour.md) |
| 要完成某件事該怎麼操作 | [`how-to/`](./how-to/README.md) |

## 結構

```
guide/
├── introduction/   認識產品：是什麼、為什麼（依閱讀順序編號）
├── how-to/         操作說明：一個任務一份，依角色分資料夾
└── images/tour/    截圖，由 apps/e2e/tour/ 的導覽劇本產生
```

- **介紹** 解釋「是什麼、為什麼」，可以從頭讀到尾；**操作說明** 是「要做 X，照這幾步」，讀者只讀自己需要的那一份。兩種寫法不放在同一個資料夾。
- 截圖一律由導覽劇本拍攝（重拍方式見 [`introduction/03-feature-tour.md`](./introduction/03-feature-tour.md#重新產生截圖)），介紹與操作說明共用，不手動擷取。
- 這裡只描述 **已經上線** 的功能；還沒做的放在 [`../features/`](../features/README.md)。
