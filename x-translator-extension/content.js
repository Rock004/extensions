// X 中文转英文翻译插件 - Content Script

const CHINESE_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/
const TRANSLATOR_UI_SELECTOR = '[data-x-translator-root="true"]'

let currentEditor = null
let isTranslating = false
let autoTranslateTimer = null
let buttonDoneTimer = null
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

// 获取编辑器的文本内容
function getEditorText(editor) {
  if (!editor) return ''

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
  if (!editor?.querySelectorAll) return

  editor
    .querySelectorAll(TRANSLATOR_UI_SELECTOR)
    .forEach((node) => node.remove())
}

function getTextNodes(editor) {
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
  const textNodes = getTextNodes(editor)
  if (textNodes.length > 0) return textNodes[0]

  const textNode = document.createTextNode('')
  editor.appendChild(textNode)
  return textNode
}

function placeCaretAtEnd(editor) {
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
  editor.focus()
  cleanupInjectedUi(editor)

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
  const labels = {
    idle: '中→EN',
    ready: '翻成英文',
    loading: '翻译中',
    done: '已完成'
  }

  const icons = {
    idle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h10M9 4v2m-3 12 3-3m0 0 3 3m-3-3 4-4m7-5-4 10m0 0-1.5 4m1.5-4h4m-4 0-4-10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ready:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 12h16M12 4l8 8-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    loading:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v4m0 10v4m9-9h-4M7 12H3m15.364 6.364-2.828-2.828M8.464 8.464 5.636 5.636m12.728 0-2.828 2.828M8.464 15.536l-2.828 2.828" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    done: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12.5 9.5 17 19 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  }

  return `
    <span class="x-translator-btn__icon" aria-hidden="true">${icons[state] || icons.idle}</span>
    <span class="x-translator-btn__label">${labels[state] || labels.idle}</span>
  `
}

function setButtonState(btn, state) {
  const titles = {
    idle: '将中文翻译为英文',
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

// 翻译提示词
const TRANSLATE_PROMPT = `请将以下中文翻译成自然流畅的英文。只输出翻译结果，不要任何解释或额外内容：\n\n`

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
          content: TRANSLATE_PROMPT + text
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
          content: TRANSLATE_PROMPT + text
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
    'autoTranslate'
  ])
  if (result.provider) cachedConfig.provider = result.provider
  if (result.apiKey) cachedConfig.apiKey = result.apiKey
  if (result.apiUrl) cachedConfig.apiUrl = result.apiUrl
  if (result.model) cachedConfig.model = result.model
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
      showNotification('✓ 翻译完成', 'success')
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

function findFloatingContainer(editor) {
  let container = editor.parentElement

  while (container && container !== document.body) {
    if (!container.isContentEditable) {
      return container
    }
    container = container.parentElement
  }

  return editor.parentElement || editor
}

// 将按钮插入到工具栏
function injectButtonIntoToolbar(editor) {
  if (!editor || !editor.parentElement) return
  cleanupInjectedUi(editor)

  // 避免重复添加
  if (document.getElementById('x-translator-btn')) return

  currentEditor = editor

  // 策略 1: 查找 [role="toolbar"]
  const root =
    editor.closest('div[data-testid*="tweetTextarea"]') ||
    editor.closest('div[contenteditable="true"]')?.parentElement ||
    editor.parentElement

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
  // 移除已有的浮动按钮
  const existing = document.getElementById('x-translator-float')
  if (existing) existing.remove()

  const wrapper = document.createElement('div')
  wrapper.id = 'x-translator-float'
  wrapper.dataset.xTranslatorRoot = 'true'
  wrapper.setAttribute('contenteditable', 'false')
  wrapper.style.cssText = `
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 9999;
  `

  const btn = createTranslateButton(editor)
  wrapper.appendChild(btn)

  // 找到编辑器的相对容器
  const container = findFloatingContainer(editor)

  if (
    container &&
    container.style.position !== 'relative' &&
    container.style.position !== 'absolute'
  ) {
    container.style.position = 'relative'
  }

  ;(container || editor.parentElement).appendChild(wrapper)
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

const EDITOR_SELECTOR =
  '[data-testid="tweetTextarea_0"], [contenteditable="true"][role="textbox"]'

function getEditorsFromNode(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return []

  const editors = []
  if (node.matches && node.matches(EDITOR_SELECTOR)) {
    editors.push(node)
  }
  if (node.querySelectorAll) {
    editors.push(...node.querySelectorAll(EDITOR_SELECTOR))
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
    }
  }
})

observer.observe(document.body, {
  childList: true,
  subtree: true
})

// 初始检查（页面已加载时）
document.querySelectorAll(EDITOR_SELECTOR).forEach((editor) => {
  prepareEditor(editor, 500)
})
