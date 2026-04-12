# 社交平台中文转英文翻译助手

Chrome 浏览器插件，在 X (Twitter)、Reddit、YouTube 上发帖或回复时，使用 AI 将中文自动翻译为英文。

## 支持平台

- **X / Twitter** — `x.com` / `twitter.com`
- **Reddit** — `reddit.com` / `www.reddit.com`
- **YouTube** — `youtube.com` / `www.youtube.com`

## 功能

- 在评论/回复框旁显示 **中→EN** 翻译按钮
- 输入中文后点击按钮，一键翻译为英文并填入评论框
- **自动翻译模式**：停止输入 1.5 秒后自动翻译（可选）
- 支持多个翻译后端：
  - Anthropic Claude
  - 硅基流动 (SiliconFlow)
  - DeepSeek
  - 百炼 (阿里云)
  - 任意 OpenAI 兼容 API（自定义地址）
- 多模型可选，自由切换
- 一键显示/隐藏 API Key
- 设置自动保存到浏览器同步存储

## 安装

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本插件目录

## 配置

点击浏览器工具栏中的插件图标，在弹窗中设置：

- **模型提供商** — 选择翻译服务后端
- **模型** — 选择使用的模型
- **API Key** — 填入对应服务的密钥
- **API 地址** — 自定义（仅 OpenAI 兼容模式）
- **自动翻译** — 开关自动翻译功能

设置完成后自动保存。

## 使用方法

1. 打开支持平台的网站（X / Reddit / YouTube）
2. 点击评论或回复框，输入中文内容
3. 点击工具栏中的 **中→EN** 按钮
4. 翻译完成，英文自动填入评论框 ✓

开启自动翻译后，输入中文 1.5 秒后自动翻译，无需手动点击。

## 文件结构

```
├── manifest.json          # 插件配置 (Manifest V3)
├── popup.html             # 设置弹窗界面
├── popup.js               # 设置弹窗逻辑
├── content.js             # 翻译核心脚本
├── styles.css             # 按钮和通知样式
├── icon16.png             # 16x16 图标
├── icon48.png             # 48x48 图标
├── icon128.png            # 128x128 图标
└── README.md              # 说明文档
```

## 技术栈

- Chrome Extension Manifest V3
- 原生 JavaScript，无第三方依赖
- Fetch API 调用翻译服务
