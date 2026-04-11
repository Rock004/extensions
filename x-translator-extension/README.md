# X 中文转英文翻译助手

Chrome 浏览器插件，在 X (Twitter) 上回复时，自动将中文翻译为英文。

## 功能

- 在 X 网页中选中中文文本时，自动弹出翻译浮窗
- 将翻译结果填入回复框
- 支持多个翻译后端：Anthropic Claude、SiliconFlow、DeepSeek、通义千问
- 在插件弹窗中可配置 API Key、模型、翻译提示词

## 安装

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择 `x-translator-extension` 目录

## 配置

点击浏览器工具栏中的插件图标，在弹窗中设置：

- **API Provider** — 选择翻译服务后端
- **API Key** — 填入对应服务的密钥
- **Model** — 选择使用的模型
- **自定义 Prompt** — 可调整翻译提示词

设置完成后自动保存到本地存储。

## 使用

1. 打开 [x.com](https://x.com) 或 [twitter.com](https://twitter.com)
2. 选中任意中文文本
3. 等待翻译完成后，点击翻译浮窗中的按钮即可将英文填入回复框

## 文件结构

```
x-translator-extension/
├── manifest.json          # 插件配置
├── popup.html             # 设置弹窗界面
├── popup.js               # 设置弹窗逻辑
├── content.js             # 划词翻译核心脚本
├── styles.css             # 翻译浮窗样式
├── icon16.png / icon48.png / icon128.png  # 插件图标
└── 需氧功能文档.md         # 功能说明文档
```

## 技术栈

- Chrome Extension Manifest V3
- 原生 JavaScript，无第三方依赖
