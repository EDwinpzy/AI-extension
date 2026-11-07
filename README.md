<p align="center">
  <img src="images/icon128.png" width="88" height="88" alt="AI-extension icon" />
</p>

<h1 align="center">AI-extension</h1>

<p align="center">
  <strong>翻译 · 视频字幕 · 网页摘要 · 书签整理 · 暗色模式</strong><br />
  <strong>Translation · Video subtitles · Page summaries · Bookmarks · Dark mode</strong>
</p>

<p align="center">
  <a href="#中文">简体中文</a> ·
  <a href="#english">English</a> ·
  <a href="https://github.com/EDwinpzy/AI-extension">GitHub</a>
</p>

---

## 中文

AI-extension 是一个可直接加载的 Manifest V3 浏览器扩展，把 AI 翻译、视频字幕翻译、网页摘要、书签整理和 Darkling 暗色模式集中到同一个设置页。项目无需构建，模型既可以在本地运行，也可以接入云端 API。

### 功能

- **AI 翻译**：支持划词翻译、整页翻译、自动翻译和原文/译文恢复；整页模式可选双语对照或仅显示译文，并保留页面原有的空格、换行和 `<br>` 分行结构。
- **灵活的模型路由**：支持 Ollama、LM Studio、llama.cpp 等本地服务，也支持 DeepSeek、Command Code、OpenCode Zen/Go 及任意兼容接口。模型可拖动排序，当前模型不可用时会按顺序自动回退。
- **接口兼容**：云端模型可选择 Chat Completions、Anthropic Messages 或 OpenAI Responses 接口。
- **术语表**：内置 AI、工程、金融和产品名词；支持自定义词条及 UTF-8 CSV 导入/导出。
- **视频字幕**：识别播放器 DOM 字幕和原生 `TextTrack`，把字幕合并为自然语句后翻译，并替换屏幕上的原字幕。字号、位置、行数、字幕模型均可单独设置。
- **网页摘要**：从当前页面提取正文，通过右键菜单生成结构化摘要。
- **书签整理**：读取网页实际渲染内容后进行 AI 分类；支持按收藏栏现有文件夹归类、精简标题、重复检测、自定义整理要求和应用前预览。自动整理默认关闭。
- **暗色模式**：内置 Darkling 引擎，支持右键菜单、黑名单和 `Alt+Shift+D` 快捷键；默认关闭。

### 快速开始

#### 环境要求

- Chrome、Edge、Brave 或其他较新的 Chromium 浏览器
- 一个可访问的模型端点：本地模型服务，或云端 API Key
- 运行测试需要 Node.js 20 或更高版本；日常使用扩展不需要 Node.js

#### 安装

```bash
git clone https://github.com/EDwinpzy/AI-extension.git
cd AI-extension
```

1. 打开 `chrome://extensions`；Edge 使用 `edge://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的仓库根目录。
4. 将 AI-extension 固定到工具栏；点击扩展图标会直接打开设置页。
5. 在“模型”页测试连接，并选择实际可用的模型。

#### 模型配置

仓库中的默认配置指向 Ollama：

```text
服务地址：http://127.0.0.1:11434/v1
模型：translategemma:4b
```

使用默认配置前，请在本机准备好该模型或其他 Ollama 模型。也可以在设置页点击“添加模型”，选择 LM Studio、llama.cpp、云端服务或自定义 OpenAI/Anthropic 兼容接口。

### 使用

#### 翻译

- **划词翻译**：选中文字后自动显示译文气泡；可在“语言与显示”中关闭自动翻译，改为点击气泡翻译。
- **整页翻译**：在页面右键选择“翻译网页”；再次选择“还原翻译”可恢复原文。
- **自动整页翻译**：默认对所有网站开启，`chatgpt.com` 默认在排除列表中。可在“站点规则”中关闭自动翻译或添加例外域名。
- **显示方式**：整页翻译支持“双语对照”和“仅译文”。
- **设置入口**：点击扩展图标，或使用网页右键菜单中的“设置”。

#### 视频字幕

在“视频字幕”页启用字幕后，扩展会读取播放器显示的字幕或浏览器原生字幕轨道，并按完整语句翻译。可分别设置是否启用、字幕模型、字号、顶部/底部位置和最多显示行数。

#### 网页摘要

在网页右键选择“总结全文”。扩展会先过滤导航、侧栏、评论等非正文内容，再把提取出的正文交给当前模型生成摘要。

#### 书签整理

在“书签整理”页：

- 使用“一键整理”先扫描并显示预览，确认后才会移动或删除书签。
- 分类依据是收藏栏现有文件夹；只有收藏栏没有任何文件夹时才使用内置分类。
- 可同时精简书签名称、扫描重复项，或为本次整理填写自定义要求。
- “自动整理书签”默认关闭；开启后，新保存的书签会在短暂防抖后自动处理，并可按小时、天或周定时去重。
- 无法读取正文的网页不会被强制归类。

#### 暗色模式

- 在设置页“暗色模式”中启用，或使用快捷键 `Alt+Shift+D`。
- 页面右键可切换暗色/明亮模式、增删当前站点黑名单，或打开 Darkling 设置面板。
- 暗色模式默认关闭，修改后立即生效。

### 模型与数据

扩展设置、模型配置、API Key、翻译缓存和书签整理设置保存在 `chrome.storage.local`。

- API Key 由浏览器扩展本地存储保存，并未使用项目自有服务器代为保管。
- 翻译文本、网页正文、字幕或书签页面上下文只会发送到你配置的模型端点。
- 由于默认开启整页自动翻译，页面文本可能在未手动点击翻译时被发送；可在“站点规则”中关闭。
- 建议让模型端点保持在本机，或只使用你信任的云端服务。

### 权限说明

| 权限 | 用途 |
| --- | --- |
| `<all_urls>` | 注入划词/整页翻译与字幕脚本、读取当前页正文、在后台标签页检查书签页面 |
| `storage` | 保存设置、模型列表、缓存和整理状态 |
| `bookmarks` | 读取、移动、重命名和去重书签 |
| `scripting` | 在已有标签页按需注入脚本 |
| `contextMenus` | 提供翻译、摘要和暗色模式右键菜单 |
| `alarms` | 定时执行书签去重 |
| `notifications` | 在页面无法响应时提示原因 |
| `clipboardWrite` | 复制译文或摘要 |

浏览器限制页面（例如 `chrome://`、扩展商店和部分 PDF 阅读器）无法注入内容脚本，因此翻译、字幕和摘要功能在这些页面不可用。

### 开发与测试

项目没有打包步骤，修改源码后直接在扩展管理页点击“重新加载”即可。

主要目录：

```text
manifest.json          Manifest V3 配置
background-loader.js   扩展 Service Worker 入口
translate/             翻译、字幕、摘要、设置页与模型路由
bookmarks/             书签分类、页面检查、去重和自动整理
darkling/              Darkling 暗色模式引擎
_locales/              扩展本地化文案
images/                扩展图标
```

运行测试：

```bash
node --test --test-concurrency=1 bookmarks/tests/classifier.test.js bookmarks/tests/page-inspector.test.js bookmarks/tests/worker-automation.test.js bookmarks/tests/browser-port-recovery.test.js bookmarks/tests/browser-render.test.js darkling/tests/dark-mode-regression.test.js translate/tests/page-format.e2e.test.js
```

其中浏览器渲染测试需要本机安装 Microsoft Edge；未安装时相关用例会自动跳过。设置页 UI 测试 `translate/tests/options.subtitle-model.e2e.test.mjs` 还需要单独安装 `jsdom`。

### 当前边界

- 当前界面以中文为主，代码和文档同时提供英文说明。
- 扩展不内置模型，必须配置本地服务或云端 API。
- 书签自动整理会修改浏览器数据，因此默认关闭；自动模式也建议先查看预览行为是否符合预期。
- 不同播放器、动态渲染网站和登录页的可读取程度不同；书签分类会跳过无法获得正文的页面，而不是猜测。

---

## English

AI-extension is a directly loadable Manifest V3 browser extension that combines AI translation, video subtitle translation, page summaries, bookmark organization, and the Darkling dark-mode engine in one settings surface. There is no build step: the model can run locally or through a cloud API.

### Features

- **AI translation**: Translate a selection or a whole page, auto-translate pages, and restore the original text. Whole-page mode supports bilingual comparison or translation-only display while preserving the page's original spacing, line breaks, and `<br>` structure.
- **Flexible model routing**: Use local services such as Ollama, LM Studio, and llama.cpp, or cloud providers such as DeepSeek, Command Code, and OpenCode Zen/Go. Custom compatible endpoints are also supported. Models can be reordered and are tried in order when the active model fails.
- **API dialects**: Cloud models can use Chat Completions, Anthropic Messages, or OpenAI Responses.
- **Glossary**: Ships with AI, engineering, finance, and product terminology. Custom entries and UTF-8 CSV import/export are supported.
- **Video subtitles**: Reads captions rendered into the player DOM and native `TextTrack` cues, joins them into natural passages, translates them, and replaces the captions on screen. Font size, position, line count, and subtitle model are configurable.
- **Page summaries**: Extracts the article from the current page and generates a structured summary from the context menu.
- **Bookmark organization**: Inspects pages as rendered before asking the model to classify them. Supports existing bookmark-bar folders, title simplification, duplicate detection, per-run instructions, and a preview before any change. Automatic organization is off by default.
- **Dark mode**: Includes the Darkling engine with context-menu controls, a site blacklist, and the `Alt+Shift+D` shortcut. It is off by default.

### Quick Start

#### Requirements

- A recent Chromium-based browser such as Chrome, Edge, or Brave
- A reachable model endpoint: a local model service or a cloud API key
- Node.js 20 or newer only for running tests; Node.js is not required for normal use

#### Install

```bash
git clone https://github.com/EDwinpzy/AI-extension.git
cd AI-extension
```

1. Open `chrome://extensions`, or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the repository root containing `manifest.json`.
4. Pin AI-extension to the toolbar. Clicking its icon opens the settings page.
5. On the **Models** page, test the connection and select an available model.

#### Model Setup

The shipped default points to Ollama:

```text
Base URL: http://127.0.0.1:11434/v1
Model: translategemma:4b
```

Prepare that model or another Ollama model locally before using the default. You can also open **Add model** in Settings and choose LM Studio, llama.cpp, a cloud provider, or a custom OpenAI/Anthropic-compatible endpoint.

### Usage

#### Translation

- **Selection translation**: Select text to show the translation bubble automatically. Disable auto-selection translation under **Language & display** to use a click-to-translate chip instead.
- **Whole-page translation**: Right-click the page and choose **Translate page**. Choose **Restore translation** to return to the original text.
- **Automatic page translation**: Enabled for all sites by default, with `chatgpt.com` excluded initially. Turn it off or add exceptions under **Site rules**.
- **Display mode**: Whole-page translation supports bilingual comparison and translation-only modes.
- **Settings**: Click the extension icon, or use **Translation settings** in the page context menu.

#### Video Subtitles

When subtitles are enabled under **Video subtitles**, the extension reads the player's rendered captions or native browser text tracks and translates complete passages. You can configure the feature, subtitle model, font size, top/bottom position, and maximum number of lines.

#### Page Summaries

Right-click a page and choose **Summarize page**. The extension first filters out navigation, sidebars, comments, and other non-article content, then sends the extracted article to the active model.

#### Bookmark Organization

On the **Bookmarks** page:

- **One-click organize** scans and shows a preview. Bookmarks are moved or deleted only after you confirm.
- Classification uses the folders already present in the bookmark bar. Built-in categories are used only when the bar has no folders.
- You can simplify bookmark titles, scan for duplicates, or provide custom instructions for the current run.
- **Automatic bookmark organization** is off by default. When enabled, newly saved bookmarks are processed after a short debounce, and duplicate cleanup can run hourly, daily, or weekly.
- Pages whose content cannot be read are not force-classified.

#### Dark Mode

- Enable it under **Dark mode** in Settings, or press `Alt+Shift+D`.
- The page context menu can switch dark/light mode, add or remove the current site from the blacklist, or open the Darkling panel.
- Dark mode is off by default, and changes apply immediately.

### Models and Data

Settings, model definitions, API keys, translation cache, and bookmark settings are stored in `chrome.storage.local`.

- API keys are stored by the browser extension itself; there is no project-owned server holding them.
- Translated text, page content, subtitles, or bookmark page context are sent only to the model endpoint you configure.
- Because whole-page auto-translation is on by default, page text may be sent without an explicit click. Turn it off under **Site rules** if that is not desired.
- Prefer a local model endpoint, or use only cloud services you trust.

### Permissions

| Permission | Purpose |
| --- | --- |
| `<all_urls>` | Inject selection/page translation and subtitle scripts, read article text, and inspect pages in background tabs for bookmark classification |
| `storage` | Persist settings, models, caches, and organization state |
| `bookmarks` | Read, move, rename, and deduplicate bookmarks |
| `scripting` | Inject scripts into existing tabs on demand |
| `contextMenus` | Provide translation, summary, and dark-mode menu entries |
| `alarms` | Run scheduled bookmark deduplication |
| `notifications` | Explain why a page could not respond |
| `clipboardWrite` | Copy translations or summaries |

Restricted browser pages such as `chrome://` pages, extension stores, and some PDF viewers do not allow content-script injection, so translation, subtitles, and summaries are unavailable there.

### Development and Tests

There is no packaging step. After changing source files, click **Reload** on the extension management page.

Main directories:

```text
manifest.json          Manifest V3 configuration
background-loader.js   Extension service-worker entry point
translate/             Translation, subtitles, summaries, settings, and model routing
bookmarks/             Bookmark classification, page inspection, deduplication, and automation
darkling/              Darkling dark-mode engine
_locales/              Extension localization
images/                Extension icons
```

Run the tests:

```bash
node --test --test-concurrency=1 bookmarks/tests/classifier.test.js bookmarks/tests/page-inspector.test.js bookmarks/tests/worker-automation.test.js bookmarks/tests/browser-port-recovery.test.js bookmarks/tests/browser-render.test.js darkling/tests/dark-mode-regression.test.js translate/tests/page-format.e2e.test.js
```

The browser-rendering tests require Microsoft Edge and skip automatically when it is unavailable. The settings UI test at `translate/tests/options.subtitle-model.e2e.test.mjs` additionally requires `jsdom` to be installed separately.

### Current Limitations

- The interface is currently Chinese-first; the code and documentation include English explanations.
- No model is bundled. A local service or cloud API must be configured.
- Automatic bookmark organization changes browser data, so it is off by default. Review its behavior before leaving it enabled.
- Support for players, dynamically rendered sites, and login walls varies. Bookmark classification skips pages whose content cannot be read instead of guessing.
