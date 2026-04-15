// X 中文转多语言翻译插件 - Content Script

// 支持的目标语言
const LANGUAGES = {
  de: { name: 'Deutsch', nameZh: '德语', label: '🇩 德语' },
  en: { name: 'English', nameZh: '英语', label: '🇬🇧 英语' },
  es: { name: 'Español', nameZh: '西班牙语', label: '🇪 西班牙语' },
  fr: { name: 'Français', nameZh: '法语', label: '🇫 法语' },
  it: { name: 'Italiano', nameZh: '意大利语', label: '🇮 意大利语' },
  ja: { name: '日本語', nameZh: '日语', label: '🇯 日语' },
  ko: { name: '한국어', nameZh: '韩语', label: '🇰 韩语' },
  nl: { name: 'Nederlands', nameZh: '荷兰语', label: '🇳 荷兰语' },
  pl: { name: 'Polski', nameZh: '波兰语', label: '🇵 波兰语' },
  ru: { name: 'Русский', nameZh: '俄语', label: '🇷🇺 俄语' },
  tr: { name: 'Türkçe', nameZh: '土耳其语', label: '🇹 土耳其语' }
}

function getTargetLangInfo() {
  return LANGUAGES[cachedConfig.targetLang] || LANGUAGES.en
}

function getTranslatePrompt() {
  const lang = getTargetLangInfo()
  return `请将以下中文翻译成自然流畅的${lang.name}。只输出翻译结果，不要任何解释或额外内容：\n\n`
}

const CHINESE_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/
const TRANSLATOR_UI_SELECTOR = '[data-x-translator-root="true"]'
const SITE_CONFIG = {
  x: {
    editorSelector:
      '[data-testid="tweetTextarea_0"], [contenteditable="true"][role="textbox"]'
  },
  reddit: {
    // light DOM 选择器：匹配直接出现在文档流中的 textarea 和 contenteditable
    lightDomSelector: [
      'textarea[name="text"]',
      'textarea[placeholder*="comment" i]',
      'textarea[placeholder*="reply" i]',
      'textarea[placeholder*="post" i]',
      'textarea[placeholder*="title" i]',
      'textarea[aria-label*="comment" i]',
      'textarea[aria-label*="reply" i]',
      // Lexical 编辑器（Reddit 新版评论框）
      'div[data-lexical-editor="true"]'
    ].join(', '),
    // shadow DOM 内部选择器
    shadowDomSelector: 'textarea:not([readonly]):not([disabled]), div[data-lexical-editor="true"]'
  },
  youtube: {
    editorSelector:
      '#contenteditable-root, [contenteditable="true"][role="textbox"], [contenteditable="true"]'
  }
}
const ACTIVE_SITE = window.location.hostname.endsWith('reddit.com')
  ? 'reddit'
  : window.location.hostname.endsWith('youtube.com')
  ? 'youtube'
  : 'x'
const ACTIVE_SITE_CONFIG = SITE_CONFIG[ACTIVE_SITE] || SITE_CONFIG.x

// 注入 CSS 到 shadow root（content script 的 CSS 不会穿透 shadow boundary）
let injectedStylesheets = new WeakSet()
let cachedCSS = null

async function loadCSSContent() {
  if (cachedCSS) return cachedCSS
  try {
    const cssURL = chrome.runtime.getURL('styles.css')
    const resp = await fetch(cssURL)
    cachedCSS = await resp.text()
  } catch {
    cachedCSS = ''
  }
  return cachedCSS
}

async function injectStylesIntoShadowRoot(shadowRoot) {
  if (!shadowRoot || injectedStylesheets.has(shadowRoot)) return

  const css = await loadCSSContent()
  if (!css) return

  const style = document.createElement('style')
  style.textContent = css
  shadowRoot.prepend(style)
  injectedStylesheets.add(shadowRoot)
}

// 递归查找所有 shadow root 中的 textarea
// 从 document 开始，递归进入每个发现的 shadow root
function collectRedditEditors(root, collected, visited) {
  if (!root?.querySelectorAll || visited.has(root)) return
  visited.add(root)

  const config = SITE_CONFIG.reddit

  // 在当前 root 中查找 textarea
  const textareas = root.querySelectorAll(config.shadowDomSelector)
  for (const ta of textareas) {
    if (!shouldIgnoreEditor(ta) && !collected.has(ta)) {
      collected.add(ta)
    }
  }

  // 递归进入所有 shadow root
  const allElements = root.querySelectorAll('*')
  for (const el of allElements) {
    if (el.shadowRoot) {
      collectRedditEditors(el.shadowRoot, collected, visited)
    }
  }
}

function scanRedditEditors() {
  const collected = new Set()
  const visited = new WeakSet()

  // 1. 先扫 light DOM
  const lightEditors = document.querySelectorAll(
    SITE_CONFIG.reddit.lightDomSelector
  )
  for (const ta of lightEditors) {
    if (!shouldIgnoreEditor(ta) && !collected.has(ta)) {
      collected.add(ta)
    }
  }

  // 2. 递归扫所有 shadow root，从 document 开始
  collectRedditEditors(document, collected, visited)

  return Array.from(collected)
}

// Reddit 专用：使用 fixed 定位按钮，避免 shadow DOM 问题
let redditButtonWrapper = null
let redditPositionObserver = null

function positionRedditButton(editor) {
  if (!redditButtonWrapper) return

  redditButtonWrapper.style.display = 'flex'
  const rect = editor.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    redditButtonWrapper.style.left = `${rect.right + 12}px`
    redditButtonWrapper.style.top = `${rect.top + rect.height / 2 - 17}px`
  } else {
    // textarea 可能不可见，固定在屏幕右下角
    redditButtonWrapper.style.right = '16px'
    redditButtonWrapper.style.left = 'auto'
    redditButtonWrapper.style.top = 'auto'
    redditButtonWrapper.style.bottom = '16px'
  }
}

function setupRedditButtonPosition(editor) {
  if (redditPositionObserver) {
    redditPositionObserver.disconnect()
    redditPositionObserver = null
  }

  redditPositionObserver = new ResizeObserver(() => positionRedditButton(editor))
  redditPositionObserver.observe(editor)

  // 滚动时也更新位置
  window.addEventListener('scroll', () => positionRedditButton(editor), true)
  window.addEventListener('resize', () => positionRedditButton(editor))
}

function createRedditButtonWrapper(editor) {
  // 移除已有
  if (redditButtonWrapper) {
    redditButtonWrapper.remove()
  }

  const wrapper = document.createElement('div')
  wrapper.id = 'x-translator-btn-wrapper'
  wrapper.dataset.xTranslatorRoot = 'true'
  wrapper.style.cssText = `
    position: fixed;
    display: flex;
    align-items: center;
    gap: 6px;
    z-index: 999999;
    pointer-events: auto;
  `

  const btn = createTranslateButton(editor)
  wrapper.appendChild(btn)

  document.body.appendChild(wrapper)
  redditButtonWrapper = wrapper

  setupRedditButtonPosition(editor)
  positionRedditButton(editor)
}

let currentEditor = null
let isTranslating = false
let autoTranslateTimer = null
let buttonDoneTimer = null
let fullScanTimer = null
let floatingButtonCleanup = null
const lastTranslatedSourceByEditor = new WeakMap()

// 各提供商的 API 配置
const PROVIDER_CONFIG = {
  anthropic: {
    type: 'anthropic',
    defaultUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-20250514'
  },
  siliconflow: {
    type: 'openai',
    defaultUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct'
  },
  deepseek: {
    type: 'openai',
    defaultUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat'
  },
  bailian: {
    type: 'openai',
    defaultUrl:
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-turbo'
  },
  openai: {
    type: 'openai',
    defaultUrl: null, // 用户自定义
    defaultModel: 'gpt-4o'
  }
}

// 检查文本是否包含中文
function containsChinese(text) {
  return CHINESE_REGEX.test(text)
}

function isTextareaEditor(editor) {
  return editor instanceof HTMLTextAreaElement
}

function getEditorAnchor(editor) {
  const rootNode = editor?.getRootNode?.()
  return rootNode instanceof ShadowRoot ? rootNode.host : editor
}

function getClassNameText(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.baseVal === 'string') return value.baseVal
  return String(value)
}

function isElementVisible(element) {
  if (!element) return false

  const rect = element.getBoundingClientRect?.()
  const style = window.getComputedStyle?.(element)

  if (!rect || !style) return false
  if (style.display === 'none' || style.visibility === 'hidden') return false

  return rect.width > 0 && rect.height > 0
}

function getEditorMetaText(editor) {
  const anchor = getEditorAnchor(editor)

  return [
    editor.getAttribute?.('placeholder') || '',
    editor.getAttribute?.('aria-label') || '',
    editor.getAttribute?.('name') || '',
    editor.id || '',
    getClassNameText(editor.className),
    anchor?.getAttribute?.('placeholder') || '',
    anchor?.getAttribute?.('aria-label') || '',
    anchor?.getAttribute?.('name') || '',
    anchor?.id || '',
    getClassNameText(anchor?.className),
    anchor?.tagName || ''
  ]
    .join(' ')
    .toLowerCase()
}

function shouldIgnoreEditor(editor) {
  const anchor = getEditorAnchor(editor)

  if (!editor || editor.closest?.(TRANSLATOR_UI_SELECTOR)) return true
  if (anchor?.closest?.(TRANSLATOR_UI_SELECTOR)) return true
  if (!isElementVisible(editor) && !isElementVisible(anchor)) return true

  const metaText = getEditorMetaText(editor)
  if (/(search|搜索|query)/.test(metaText)) return true

  if (ACTIVE_SITE === 'reddit') {
    const redditContainer = anchor?.closest(
      'form, shreddit-comment-composer, shreddit-composer, faceplate-textarea-input, faceplate-textarea, [slot*="composer"], [data-testid*="comment"], [data-testid*="composer"], [id*="comment"], [id*="composer"], div[data-lexical-editor="true"]'
    )

    if (
      !redditContainer &&
      !/(comment|reply|post|title|text|body|commentcomposer|textarea)/.test(
        metaText
      )
    ) {
      return true
    }
  }

  return false
}

// 获取编辑器的文本内容
function getEditorText(editor) {
  if (!editor) return ''

  if (isTextareaEditor(editor)) {
    return editor.value || ''
  }

  if (!editor.querySelector(TRANSLATOR_UI_SELECTOR)) {
    return editor.innerText || editor.textContent || ''
  }

  const clone = editor.cloneNode(true)
  clone
    .querySelectorAll(TRANSLATOR_UI_SELECTOR)
    .forEach((node) => node.remove())
  return clone.innerText || clone.textContent || ''
}

function isTranslatorUiNode(node) {
  return Boolean(node?.parentElement?.closest?.(TRANSLATOR_UI_SELECTOR))
}

function cleanupInjectedUi(editor) {
  if (!editor?.querySelectorAll || isTextareaEditor(editor)) return

  editor
    .querySelectorAll(TRANSLATOR_UI_SELECTOR)
    .forEach((node) => node.remove())

  // 也清理浮动按钮（如果存在）
  cleanupFloatingButton()
}

function getTextNodes(editor) {
  if (isTextareaEditor(editor)) return []

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (isTranslatorUiNode(node)) {
        return NodeFilter.FILTER_SKIP
      }

      return node.textContent && node.textContent.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP
    }
  })

  const nodes = []
  let currentNode = walker.nextNode()
  while (currentNode) {
    nodes.push(currentNode)
    currentNode = walker.nextNode()
  }
  return nodes
}

function ensureTextNode(editor) {
  if (isTextareaEditor(editor)) return null

  const textNodes = getTextNodes(editor)
  if (textNodes.length > 0) return textNodes[0]

  const textNode = document.createTextNode('')
  editor.appendChild(textNode)
  return textNode
}

function placeCaretAtEnd(editor) {
  if (isTextareaEditor(editor)) {
    const end = editor.value.length
    editor.setSelectionRange(end, end)
    return
  }

  const selection = window.getSelection()
  if (!selection) return

  const textNodes = getTextNodes(editor)
  const range = document.createRange()

  if (textNodes.length > 0) {
    const lastTextNode = textNodes[textNodes.length - 1]
    range.setStart(lastTextNode, lastTextNode.textContent.length)
  } else {
    range.selectNodeContents(editor)
    range.collapse(false)
  }

  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function notifySelectionChanged() {
  document.dispatchEvent(new Event('selectionchange'))
}

function settleEditorSelection(editor) {
  editor.focus()
  placeCaretAtEnd(editor)
  notifySelectionChanged()

  requestAnimationFrame(() => {
    editor.focus()
    placeCaretAtEnd(editor)
    notifySelectionChanged()
  })
}

function restoreEditorFocus(editor) {
  settleEditorSelection(editor)

  setTimeout(() => {
    settleEditorSelection(editor)
  }, 0)

  setTimeout(() => {
    settleEditorSelection(editor)
  }, 80)
}

function dispatchEditorInput(editor, text) {
  if (isTextareaEditor(editor)) {
    editor.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertReplacementText',
        data: text
      })
    )
    editor.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  editor.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertReplacementText',
      data: text
    })
  )

  editor.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertReplacementText',
      data: text
    })
  )
}

function replaceEditorTextPreservingNodes(editor, text) {
  if (isTextareaEditor(editor)) {
    const prototype = Object.getPrototypeOf(editor)
    const valueSetter =
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
        ?.set

    if (valueSetter) {
      valueSetter.call(editor, text)
    } else {
      editor.value = text
    }

    return editor
  }

  const textNodes = getTextNodes(editor)

  if (textNodes.length === 0) {
    const textNode = ensureTextNode(editor)
    textNode.textContent = text
    editor.normalize()
    return textNode
  }

  const primaryNode = textNodes[0]
  primaryNode.textContent = text

  for (let index = 1; index < textNodes.length; index += 1) {
    textNodes[index].textContent = ''
  }

  editor.normalize()
  return primaryNode
}

// 设置编辑器文本（兼容 Draft.js / contentEditable）
function setEditorText(editor, text) {
  // ====== textarea 专用路径（Reddit 等）======
  if (isTextareaEditor(editor)) {
    editor.focus()

    // 直接设置 value
    const prototype = Object.getPrototypeOf(editor)
    const valueSetter =
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set

    if (valueSetter) {
      valueSetter.call(editor, text)
    } else {
      editor.value = text
    }

    // 设置光标到末尾
    const end = editor.value.length
    editor.setSelectionRange(end, end)

    // 触发 input 事件让 React 感知变化
    editor.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      })
    )
    editor.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  // ====== contentEditable 路径（X/YouTube/Reddit div[role=textbox]）======
  editor.focus()
  cleanupInjectedUi(editor)

  // 检查是否是简单 contentEditable（Reddit 的 div[role="textbox"]）
  const innerSpans = editor.querySelectorAll('span')
  const isSimpleEditor = !editor.querySelector('[data-testid*="tweetTextarea"]')
    && innerSpans.length <= 2

  if (isSimpleEditor) {
    // Lexical 编辑器：execCommand 有效，但需要足够的延迟让 focus 生效
    editor.focus()

    // 使用 requestAnimationFrame + 微任务 确保 focus 完全生效
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.execCommand('selectAll', false, null)
        document.execCommand('insertText', false, text)
      })
    })
    return
  }

  // 优先在现有文本节点上原位替换，尽量不破坏 X 内部编辑状态
  replaceEditorTextPreservingNodes(editor, text)
  restoreEditorFocus(editor)

  const currentText = getEditorText(editor).trim()
  if (currentText === text.trim()) {
    dispatchEditorInput(editor, text)
    return
  }

  // 选中全部内容
  const selection = window.getSelection()
  selection.removeAllRanges()
  const range = document.createRange()
  range.selectNodeContents(editor)
  selection.addRange(range)

  document.execCommand('selectAll', false, null)
  document.execCommand('delete', false, null)

  // delete 后，编辑器可能没有子节点（X 在暂停时会清理空编辑器）
  if (editor.childNodes.length === 0) {
    editor.appendChild(document.createTextNode(''))
  }

  // 创建新的选择范围用于插入
  const newRange = document.createRange()
  const firstTextNode = ensureTextNode(editor)
  newRange.setStart(firstTextNode, 0)
  newRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(newRange)

  // 插入文本
  document.execCommand('insertText', false, text)

  // 将光标移动到文本末尾（修复无法删除/继续输入的问题）
  restoreEditorFocus(editor)
  dispatchEditorInput(editor, text)

  // 延迟重试：Draft.js 可能通过 MutationObserver 回退内容
  setTimeout(() => {
    if (getEditorText(editor).trim() !== text.trim()) {
      replaceEditorTextPreservingNodes(editor, text)
      restoreEditorFocus(editor)
      dispatchEditorInput(editor, text)
    }
  }, 50)
}

function getTranslateButtonMarkup(state) {
  const lang = getTargetLangInfo()
  const langUpper = (cachedConfig.targetLang || 'en').toUpperCase()
  const langCode = langUpper.replace(/\s+/g, '').slice(0, 2)

  const texts = {
    ready: `将中文翻译为 <span class="x-translator-btn__lang-code">${langCode}</span> ${lang.nameZh}`,
    idle: `将中文翻译为 <span class="x-translator-btn__lang-code">${langCode}</span> ${lang.nameZh}`,
    loading: '翻译中...',
    done: '翻译完成'
  }

  const icons = {
    idle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 4l-2 4m0 0l2 4m-2-4h6M8 20l2-4m0 0l-2-4m2 4H2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ready:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 4l-2 4m0 0l2 4m-2-4h6M8 20l2-4m0 0l-2-4m2 4H2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    loading:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v4m0 10v4m9-9h-4M7 12H3m15.364 6.364-2.828-2.828M8.464 8.464 5.636 5.636m12.728 0-2.828 2.828M8.464 15.536l-2.828 2.828" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    done: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12.5 9.5 17 19 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  }

  return `
    <span class="x-translator-btn__icon" aria-hidden="true">${icons[state] || icons.idle}</span>
    <span class="x-translator-btn__label">${texts[state] || texts.idle}</span>
  `
}

function setButtonState(btn, state) {
  const lang = getTargetLangInfo()
  const titles = {
    idle: `将中文翻译为${lang.name}`,
    ready: '检测到中文，点击翻译',
    loading: '正在翻译，请稍候',
    done: '翻译完成，可继续编辑'
  }

  btn.dataset.state = state
  btn.innerHTML = getTranslateButtonMarkup(state)
  btn.title = titles[state] || titles.idle
  btn.setAttribute('aria-label', titles[state] || titles.idle)
}

function syncButtonState(editor, forceState) {
  const btn = document.getElementById('x-translator-btn')
  if (!btn) return

  const nextState =
    forceState || (containsChinese(getEditorText(editor)) ? 'ready' : 'idle')

  setButtonState(btn, nextState)
}

function flashButtonDone(editor) {
  clearTimeout(buttonDoneTimer)
  const btn = document.getElementById('x-translator-btn')
  if (!btn) return

  setButtonState(btn, 'done')
  buttonDoneTimer = setTimeout(() => {
    syncButtonState(editor)
  }, 1400)
}

// 调用翻译 API
async function translateText(text) {
  const { provider, apiKey, apiUrl, model } = await getConfig()
  if (!apiKey) {
    showNotification('请先在插件设置中配置 API Key', 'error')
    return null
  }

  const config = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.anthropic
  const url = apiUrl || config.defaultUrl
  const finalModel = model || config.defaultModel
  if (!url) {
    showNotification('API 地址未配置', 'error')
    return null
  }

  if (config.type === 'anthropic') {
    return callAnthropicAPI(url, apiKey, finalModel, text)
  } else {
    return callOpenAICompatibleAPI(url, apiKey, finalModel, text)
  }
}

// Claude API 调用
async function callAnthropicAPI(url, apiKey, model, text) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-10-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: getTranslatePrompt() + text
        }
      ]
    })
  })

  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`
    try {
      const err = await response.json()
      errMsg = err.error?.message || errMsg
    } catch {
      /* 非 JSON 响应，使用默认错误信息 */
    }
    throw new Error(errMsg)
  }

  const data = await response.json()
  return data.content?.[0]?.text || null
}

// OpenAI 兼容 API 调用
async function callOpenAICompatibleAPI(url, apiKey, model, text) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: getTranslatePrompt() + text
        }
      ]
    })
  })

  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`
    try {
      const err = await response.json()
      errMsg = err.error?.message || errMsg
    } catch {
      /* 非 JSON 响应，使用默认错误信息 */
    }
    throw new Error(errMsg)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || null
}

// 内存中的配置缓存
let cachedConfig = {
  provider: 'anthropic',
  apiKey: '',
  apiUrl: '',
  model: '',
  targetLang: 'en',
  autoTranslate: false
}

// 安全地从 storage 获取配置
function safeGetStorage(keys) {
  return new Promise((resolve) => {
    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.sync
    ) {
      chrome.storage.sync.get(keys, (result) => {
        resolve(result || {})
      })
    } else {
      resolve({})
    }
  })
}

// 从 storage 初始化配置（页面加载时调用一次）
async function initConfig() {
  const result = await safeGetStorage([
    'provider',
    'apiKey',
    'apiUrl',
    'model',
    'targetLang',
    'autoTranslate'
  ])
  if (result.provider) cachedConfig.provider = result.provider
  if (result.apiKey) cachedConfig.apiKey = result.apiKey
  if (result.apiUrl) cachedConfig.apiUrl = result.apiUrl
  if (result.model) cachedConfig.model = result.model
  if (result.targetLang) cachedConfig.targetLang = result.targetLang
  if (result.autoTranslate !== undefined)
    cachedConfig.autoTranslate = result.autoTranslate
}

// 监听 storage 变化（当用户在 popup 中修改设置时同步更新）
if (
  typeof chrome !== 'undefined' &&
  chrome.storage &&
  chrome.storage.onChanged
) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
      if (changes.provider) cachedConfig.provider = changes.provider.newValue
      if (changes.apiKey) cachedConfig.apiKey = changes.apiKey.newValue
      if (changes.apiUrl) cachedConfig.apiUrl = changes.apiUrl.newValue
      if (changes.model) cachedConfig.model = changes.model.newValue
      if (changes.targetLang) cachedConfig.targetLang = changes.targetLang.newValue
      if (changes.autoTranslate !== undefined)
        cachedConfig.autoTranslate = changes.autoTranslate.newValue
    }
  })
}

// 立即初始化
initConfig()

// 获取配置
function getConfig() {
  return Promise.resolve(cachedConfig)
}

// 显示通知
function showNotification(message, type = 'info') {
  const existing = document.getElementById('x-translator-notification')
  if (existing) existing.remove()

  const notif = document.createElement('div')
  notif.id = 'x-translator-notification'
  notif.className = `x-translator-notif x-translator-notif-${type}`
  notif.textContent = message
  document.body.appendChild(notif)

  setTimeout(() => notif.remove(), 3000)
}

// 执行翻译并替换内容
async function doTranslate(editor, source) {
  const text = getEditorText(editor)
  const trimmedText = text.trim()
  if (!trimmedText || !containsChinese(text)) return
  // 避免重复翻译相同内容
  if (lastTranslatedSourceByEditor.get(editor) === trimmedText) return

  isTranslating = true
  clearTimeout(buttonDoneTimer)
  syncButtonState(editor, 'loading')
  let didTranslate = false

  try {
    const translated = await translateText(trimmedText)
    if (translated && translated.trim()) {
      lastTranslatedSourceByEditor.set(editor, trimmedText)
      setEditorText(editor, translated.trim())
      didTranslate = true
      const lang = getTargetLangInfo()
      showNotification(`✓ 翻译为${lang.name}完成`, 'success')
    } else {
      showNotification('翻译结果为空，请重试', 'error')
    }
  } catch (err) {
    if (source === 'auto') {
      showNotification(`自动翻译失败: ${err.message}，请手动点击按钮`, 'error')
    } else {
      showNotification(`翻译失败: ${err.message}`, 'error')
    }
  } finally {
    isTranslating = false
    // 翻译后编辑器 DOM 可能已重新渲染，按钮可能被移除，需要重新注入
    if (!document.getElementById('x-translator-btn') && currentEditor) {
      injectButtonIntoToolbar(currentEditor)
    }

    if (didTranslate) {
      flashButtonDone(editor)
    } else {
      syncButtonState(editor)
    }

    // 延迟再次检查：React 可能在异步阶段重新渲染工具栏
    setTimeout(() => {
      if (!document.getElementById('x-translator-btn') && currentEditor) {
        injectButtonIntoToolbar(currentEditor)
      }

      if (didTranslate) {
        flashButtonDone(editor)
      } else {
        syncButtonState(editor)
      }
    }, 500)
  }
}

// 创建翻译按钮
function createTranslateButton(editor) {
  const btn = document.createElement('button')
  btn.id = 'x-translator-btn'
  btn.className = 'x-translator-btn'
  btn.type = 'button'
  btn.tabIndex = -1
  btn.dataset.xTranslatorRoot = 'true'
  btn.setAttribute('contenteditable', 'false')
  setButtonState(btn, containsChinese(getEditorText(editor)) ? 'ready' : 'idle')

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault()
  })

  btn.addEventListener('mousedown', (e) => {
    e.preventDefault()
  })

  btn.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!currentEditor || isTranslating) return

    const text = getEditorText(currentEditor)
    if (!text.trim()) {
      showNotification('请先输入内容', 'error')
      return
    }
    if (!containsChinese(text)) {
      showNotification('未检测到中文内容', 'info')
      return
    }

    doTranslate(currentEditor, 'manual')
  })

  return btn
}

function findRedditToolbar(editor) {
  const anchor = getEditorAnchor(editor)
  const root =
    anchor.closest(
      'form, shreddit-comment-composer, shreddit-composer, faceplate-textarea-input, [slot*="composer"], [data-testid*="comment"], [data-testid*="composer"], [id*="comment"], [id*="composer"]'
    ) ||
    anchor.parentElement ||
    anchor

  if (!root) return null

  const actionButtonRow = Array.from(root.querySelectorAll('button')).find(
    (button) => {
      const text = button.textContent?.trim() || ''
      return /(comment|reply|cancel|post|评论|回复|取消|发布)/i.test(text)
    }
  )?.parentElement

  if (
    actionButtonRow &&
    !actionButtonRow.contains(anchor) &&
    actionButtonRow.querySelectorAll('button').length >= 1
  ) {
    return actionButtonRow
  }

  const directSelectors = [
    '[role="toolbar"]',
    '[slot="footer"]',
    '[slot="actions"]',
    '[slot="actionRow"]',
    '[slot="button-row"]',
    '[data-testid*="footer"]',
    '[data-testid*="actions"]'
  ]

  for (const selector of directSelectors) {
    const match = root.querySelector(selector)
    if (match && !match.contains(editor)) {
      return match
    }
  }

  const editorRect = editor.getBoundingClientRect()
  const candidates = root.querySelectorAll('div, footer, section, nav')
  for (const candidate of candidates) {
    if (candidate === anchor || candidate.contains(anchor)) continue
    if (candidate.closest(TRANSLATOR_UI_SELECTOR)) continue

    const buttons = candidate.querySelectorAll('button')
    if (buttons.length === 0) continue

    const rect = candidate.getBoundingClientRect()
    const isNearEditor =
      rect.top <= editorRect.bottom + 220 && rect.bottom >= editorRect.top - 80

    if (isNearEditor) {
      return candidate
    }
  }

  return null
}

function findFloatingContainer(editor) {
  const anchor = getEditorAnchor(editor)

  if (ACTIVE_SITE === 'reddit') {
    return (
      anchor.closest(
        'faceplate-textarea-input, shreddit-comment-composer, shreddit-composer, form, [slot*="composer"], [data-testid*="comment"], [data-testid*="composer"], [id*="comment"], [id*="composer"]'
      ) ||
      anchor.parentElement ||
      anchor
    )
  }

  let container = anchor.parentElement

  while (container && container !== document.body) {
    if (!container.isContentEditable) {
      return container
    }
    container = container.parentElement
  }

  return anchor.parentElement || anchor
}

// 将按钮插入到工具栏
function injectButtonIntoToolbar(editor) {
  const anchor = getEditorAnchor(editor)

  if (!editor || !anchor || shouldIgnoreEditor(editor)) return
  cleanupInjectedUi(editor)

  // 避免重复添加
  if (document.getElementById('x-translator-btn')) return

  currentEditor = editor

  if (ACTIVE_SITE === 'reddit') {
    // Reddit: 使用 fixed 定位按钮，挂在 document.body 上
    // 这样可以完全避免 shadow DOM 的 CSS 隔离和 toolbar 查找问题
    createRedditButtonWrapper(editor)
    return
  }

  // 策略 1: 查找 [role="toolbar"]
  const root =
    anchor.closest('div[data-testid*="tweetTextarea"]') ||
    anchor.closest('div[contenteditable="true"]')?.parentElement ||
    anchor.parentElement

  if (root) {
    const toolbar =
      root.querySelector('[role="toolbar"]') ||
      root.parentElement?.querySelector('[role="toolbar"]') ||
      root.parentElement?.parentElement?.querySelector('[role="toolbar"]') ||
      root.querySelector('[data-testid="toolBar"]') ||
      root.parentElement?.querySelector('[data-testid="toolBar"]')

    if (toolbar) {
      const btn = createTranslateButton(editor)
      toolbar.insertBefore(btn, toolbar.firstChild)
      return
    }
  }

  // 策略 2: 查找包含 compose 按钮的容器（emoji/gif/poll 所在行）
  const composeArea = findComposeToolbar(editor)
  if (composeArea) {
    const btn = createTranslateButton(editor)
    composeArea.insertBefore(btn, composeArea.firstChild)
    return
  }

  // 策略 3: 浮动按钮，贴在编辑器右侧
  attachFloatingButton(editor)
}

// 查找 X 的 compose 工具栏
function findComposeToolbar(editor) {
  // 向上最多 8 层查找
  let el = editor
  for (let i = 0; i < 8 && el && el !== document.body; i++) {
    // 查找包含 emoji/图片/GIF 图标的行
    const toolbar = el.querySelector(
      'div[role="toolbar"], div[data-testid="toolBar"]'
    )
    if (toolbar) return toolbar

    // 通过样式特征识别工具栏：包含多个 svg button 的 flex 行
    const divs = el.querySelectorAll(':scope > div')
    for (const div of divs) {
      if (
        window.getComputedStyle(div).display === 'flex' &&
        div.querySelectorAll('button svg').length >= 2
      ) {
        return div
      }
    }

    el = el.parentElement
  }
  return null
}

// 浮动按钮方案
function attachFloatingButton(editor) {
  // 清理旧的浮动按钮
  cleanupFloatingButton()

  const wrapper = document.createElement('div')
  wrapper.id = 'x-translator-float'
  wrapper.dataset.xTranslatorRoot = 'true'
  wrapper.setAttribute('contenteditable', 'false')
  // 使用 fixed 定位，紧贴编辑器右边，z-index 高于内容
  wrapper.style.cssText = `
    position: fixed;
    z-index: 99999;
    pointer-events: auto;
  `

  const btn = createTranslateButton(editor)
  wrapper.appendChild(btn)

  document.body.appendChild(wrapper)

  // 定位并随滚动/缩放更新
  updateFloatingButtonPosition(editor)
  const onScrollResize = () => updateFloatingButtonPosition(editor)
  window.addEventListener('scroll', onScrollResize, true)
  window.addEventListener('resize', onScrollResize)

  let resizeObserver = null
  // 用 ResizeObserver 监听编辑器大小变化
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => updateFloatingButtonPosition(editor))
    resizeObserver.observe(editor)
  }

  // 保存清理函数
  floatingButtonCleanup = () => {
    window.removeEventListener('scroll', onScrollResize, true)
    window.removeEventListener('resize', onScrollResize)
    if (resizeObserver) resizeObserver.disconnect()
    const w = document.getElementById('x-translator-float')
    if (w) w.remove()
    floatingButtonCleanup = null
  }
}

function cleanupFloatingButton() {
  if (floatingButtonCleanup) {
    floatingButtonCleanup()
  }
}

function updateFloatingButtonPosition(editor) {
  const wrapper = document.getElementById('x-translator-float')
  if (!wrapper) return

  const rect = editor.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) {
    wrapper.style.display = 'none'
    return
  }
  wrapper.style.display = 'flex'
  // 按钮贴在编辑器右侧外部，垂直居中
  wrapper.style.left = `${rect.right + 8}px`
  wrapper.style.top = `${rect.top + rect.height / 2 - 17}px`
}

// 防抖自动翻译
function scheduleAutoTranslate(editor) {
  clearTimeout(autoTranslateTimer)
  currentEditor = editor

  const text = getEditorText(editor)
  if (!text.trim() || !containsChinese(text)) return

  // 检查是否开启了自动翻译
  if (!cachedConfig.autoTranslate) return

  // 停止输入 1.5 秒后自动翻译
  autoTranslateTimer = setTimeout(() => {
    if (!isTranslating) {
      doTranslate(editor, 'auto')
    }
  }, 1500)
}

// 监听编辑器输入变化
function handleEditorInput(editor) {
  const text = getEditorText(editor)
  const trimmedText = text.trim()
  currentEditor = editor
  clearTimeout(buttonDoneTimer)

  if (
    lastTranslatedSourceByEditor.get(editor) &&
    lastTranslatedSourceByEditor.get(editor) !== trimmedText
  ) {
    lastTranslatedSourceByEditor.delete(editor)
  }

  // 检查按钮是否还存在（翻译后 React 重渲染可能导致按钮丢失）
  if (!document.getElementById('x-translator-btn')) {
    injectButtonIntoToolbar(editor)
  }

  const btn = document.getElementById('x-translator-btn')
  if (btn) {
    syncButtonState(editor)
  }

  // 触发自动翻译
  scheduleAutoTranslate(editor)
}

// 已绑定监听器的编辑器集合（避免重复绑定）
const boundEditors = new WeakSet()

function bindEditorEvents(editor) {
  if (boundEditors.has(editor)) return
  boundEditors.add(editor)

  editor.addEventListener('input', () => handleEditorInput(editor))
  editor.addEventListener('focus', () => {
    currentEditor = editor
    injectButtonIntoToolbar(editor)
  })
}

const EDITOR_SELECTOR = ACTIVE_SITE_CONFIG.editorSelector || ACTIVE_SITE_CONFIG.lightDomSelector

function getAllSearchRoots() {
  const roots = new Set([document])
  const pendingRoots = [document]

  while (pendingRoots.length > 0) {
    const currentRoot = pendingRoots.pop()
    if (!currentRoot?.querySelectorAll) continue

    for (const element of currentRoot.querySelectorAll('*')) {
      if (element.shadowRoot && !roots.has(element.shadowRoot)) {
        roots.add(element.shadowRoot)
        pendingRoots.push(element.shadowRoot)
      }
    }
  }

  return Array.from(roots)
}

function scanAllEditors(delay = 0) {
  // Reddit 使用专用的 shadow DOM 扫描
  if (ACTIVE_SITE === 'reddit') {
    const editors = scanRedditEditors()
    editors.forEach((editor) => prepareEditor(editor, delay))
    return
  }

  for (const root of getAllSearchRoots()) {
    if (!root.querySelectorAll) continue

    root.querySelectorAll(EDITOR_SELECTOR).forEach((editor) => {
      if (!shouldIgnoreEditor(editor)) {
        prepareEditor(editor, delay)
      }
    })
  }
}

function scheduleFullEditorScan(delay = 180) {
  clearTimeout(fullScanTimer)
  fullScanTimer = setTimeout(() => {
    scanAllEditors(0)
  }, delay)
}

function getEditorsFromNode(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return []

  const editors = []

  // Reddit: 检查节点是否是 shadow root 宿主，如果是则扫描其 shadow DOM
  if (ACTIVE_SITE === 'reddit' && node.shadowRoot) {
    const shadowEditors = node.shadowRoot.querySelectorAll(
      SITE_CONFIG.reddit.shadowDomSelector
    )
    for (const editor of shadowEditors) {
      if (!shouldIgnoreEditor(editor)) {
        editors.push(editor)
      }
    }
  }

  if (node.matches && node.matches(EDITOR_SELECTOR)) {
    if (!shouldIgnoreEditor(node)) {
      editors.push(node)
    }
  }
  if (node.querySelectorAll) {
    editors.push(
      ...Array.from(node.querySelectorAll(EDITOR_SELECTOR)).filter(
        (editor) => !shouldIgnoreEditor(editor)
      )
    )
  }
  return editors
}

function prepareEditor(editor, delay) {
  setTimeout(() => {
    injectButtonIntoToolbar(editor)
    syncButtonState(editor)
  }, delay)
  bindEditorEvents(editor)
}

// 使用 MutationObserver 监听 DOM 变化（X 是 SPA）
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      for (const editor of getEditorsFromNode(node)) {
        prepareEditor(editor, 300)
      }

      if (node.nodeType === Node.ELEMENT_NODE && node.shadowRoot) {
        scheduleFullEditorScan(60)
      }
    }
  }

  if (ACTIVE_SITE === 'reddit') {
    scheduleFullEditorScan(120)
  }
})

observer.observe(document.body, {
  childList: true,
  subtree: true
})

// 初始检查（页面已加载时）
scanAllEditors(500)

// Reddit: 轮询后备方案（MutationObserver 可能错过 shadow DOM 中的元素）
if (ACTIVE_SITE === 'reddit') {
  let redditPollTimer = null
  let redditFoundEditors = new WeakSet()

  function pollRedditEditors() {
    const editors = scanRedditEditors()
    for (const editor of editors) {
      if (!redditFoundEditors.has(editor)) {
        redditFoundEditors.add(editor)
        prepareEditor(editor, 100)
      }
    }
  }

  // 每 1.5 秒轮询一次
  redditPollTimer = setInterval(pollRedditEditors, 1500)

  // 【最可靠的路径】监听 focusin 事件：当用户点击编辑器时，立即注入
  document.addEventListener(
    'focusin',
    (e) => {
      if (!e.target) return
      const el = e.target
      if (el.tagName === 'TEXTAREA' ||
          (el.tagName === 'DIV' && el.getAttribute('role') === 'textbox' && el.isContentEditable)) {
        if (boundEditors.has(el)) return
        if (shouldIgnoreEditor(el)) return
        prepareEditor(el, 0)
      }
    },
    true
  )

  // 同时监听 input 事件（兜底）
  document.addEventListener(
    'input',
    (e) => {
      if (!e.target) return
      const el = e.target
      if (el.tagName === 'TEXTAREA' ||
          (el.tagName === 'DIV' && el.getAttribute('role') === 'textbox' && el.isContentEditable)) {
        if (boundEditors.has(el)) return
        if (shouldIgnoreEditor(el)) return
        prepareEditor(el, 0)
      }
    },
    true
  )
}
