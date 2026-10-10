# ✦ 人物图谱 — 日记 · 人物 · 关系 · AI 问答

你写日记时提到的朋友、敌人、熟人，都可以记在这里。软件会把每个人变成一颗会沉沉浮浮的“小球”，
人物之间可以连线表示关系（朋友/敌人/恋人/师徒…），并且内置 AI 助手：
**你问它任何关于人物关系的问题，它会自动携带全量 JSON 数据（人物档案、关系、日记摘录）作为依据来回答。**

![screenshot](无法显示？直接运行体验。)

## ✨ 功能

- 🌌 **关系图谱**：球体缓慢沉浮，可拖拽、滚轮缩放；按住 `Alt` 从一个球拖到另一个球 = 建立关系；也可用「连接模式」依次点击两个球。
- 👤 **人物档案**：姓名、性别、年龄、身高、职业、标签、颜色、简介/经历，支持搜索。
- 📖 **日记管理**：写日记时自动检测提到的人物（可点击开关），人物 ↔ 日记自动关联。
- 🔗 **关系系统**：类型（自由填写）、亲密度 1-5 星、单向/双向、备注。
- 🤖 **AI 助手**：问答时自动携带当前完整 JSON（含连接关系），支持历史追问；可切换 DeepSeek / Kimi / 通义 / OpenAI / 本地 Ollama 等服务。
- 📦 **JSON 数据**：全部数据就是 `data/data.json` 一个文件，可导出 / 导入，随时备份。

## 🚀 快速开始

1. 安装 [Node.js](https://nodejs.org)（18 或更高版本）。
2. 双击 `start.bat`，或在命令行运行：

```bash
node server.js
```

3. 浏览器打开：**http://localhost:3210**

> 内置了一套示例人物（林晓 / 陈北 / 苏晚 / 赵烽 / 老周 / 何雨）和 3 篇示例日记，可以直接体验，
> 也可以在图谱页点选人物逐个删除，或直接导入你自己的 JSON。

## 🤖 配置 AI 助手

1. 打开右上角「⚙ 设置」。
2. 选择服务商（预设了 DeepSeek / Kimi / 通义千问 / OpenAI / Ollama），填入你的 **API Key**。
3. 点「测试连接」确认可用，然后保存。

### 推荐：DeepSeek

- 到 https://platform.deepseek.com 注册并创建 API Key
- Base URL：`https://api.deepseek.com`
- 模型：`deepseek-chat`（日用推荐）/ `deepseek-reasoner`（深度思考）

也支持任何 OpenAI 兼容接口（本地 Ollama 填 `http://127.0.0.1:11434/v1`）。

## 📦 JSON 数据结构（AI 问答也基于它）

所有数据保存在 `data/data.json`，结构：

```json
{
  "version": 1,
  "persons": [        // 人物档案
    {
      "id": "p_x",
      "name": "苏晚",
      "gender": "女",
      "relationLabel": "恋人",      // 与“我”的关系
      "age": 25,
      "height": 165,              // cm
      "occupation": "独立插画师",
      "tags": ["画家"],
      "color": "#ff6b9d",        // 球体颜色
      "notes": "简介 / 经历 / 印象…"
    }
  ],
  "relations": [       // 人物之间的连接关系
    {
      "id": "r_x",
      "source": "p_x",   // 人物 A id
      "target": "p_y",   // 人物 B id
      "type": "恋人",   // 关系类型
      "strength": 5,       // 亲密度 1-5
      "directed": false,   // true = 单向 A➜B
      "note": "2025 年 2 月确认关系"
    }
  ],
  "diaries": [         // 日记
    {
      "id": "d_x",
      "date": "2025-06-12",
      "title": "健身房初遇何雨",
      "content": "……正文……",
      "mentions": ["p_x", "p_y"]   // 提到的人物 id
    }
  ],
  "settings": { "ai": { "baseUrl": "...", "apiKey": "...", "model": "..." } }
}
```

> AI 助手每次提问时，后端会实时把上面的数据整理成 JSON 上下文（可在 AI 页点「📄 查看问答携带的 JSON」预览），
> 所以**连接关系、人物档案、日记都天然是机器可读的 JSON**，方便你二次开发或分析。

## 🌐 用其他程序调用

- 读取全部数据：`GET http://localhost:3210/api/state`
- 下载 JSON：`GET http://localhost:3210/api/export`
- 导入：`POST /api/import`（body 为完整数据对象）
- AI 问答：`POST /api/chat`  `{ "question": "…", "history": […] }`
- 查看 AI 上下文：`GET /api/context`

## ❓ 常见问题

- **端口被占用**：换端口启动 `PORT=3211 node server.js`。
- **AI 提示未配置**：去「设置」里填 API Key；**Key 只存在本地**，不会外传。
- **想清空重来**：删除 `data/data.json` 后重启，或先导出备份再导入空数据。

## 🛠 技术栈

- 后端：Node.js 原生模块（零 npm 依赖），数据落盘为 JSON。
- 前端：原生 HTML/CSS/JS + SVG，自研的“浮力”物理模拟（排斥 + 弹簧 + 引力 + 沉浮扰动），无需联网加载任何库。

— 祝你记录愉快 📝

---

## 许可证

[MIT](LICENSE) © 2026 old884888