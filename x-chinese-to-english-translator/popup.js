const apiKeyInput = document.getElementById('apiKey')
const apiUrlInput = document.getElementById('apiUrl')
const providerSelect = document.getElementById('provider')
const modelSelect = document.getElementById('model')
const targetLangSelect = document.getElementById('targetLang')
const providerLabel = document.getElementById('providerLabel')
const providerHint = document.getElementById('providerHint')
const modelHint = document.getElementById('modelHint')
const autoTranslateToggle = document.getElementById('autoTranslate')
const saveBtn = document.getElementById('saveBtn')
const statusEl = document.getElementById('status')
const toggleKey = document.getElementById('toggleKey')
let statusTimer = null
let customOpenAIUrl = ''
let currentProvider = 'anthropic'
let currentTargetLang = 'en'

// 支持的目标语言
const LANGUAGES = {
  de: { name: 'Deutsch', nameZh: '德语', label: '🇩🇪 德语' },
  en: { name: 'English', nameZh: '英语', label: '🇬🇧 英语' },
  es: { name: 'Español', nameZh: '西班牙语', label: '🇪🇸 西班牙语' },
  fr: { name: 'Français', nameZh: '法语', label: '🇫🇷 法语' },
  it: { name: 'Italiano', nameZh: '意大利语', label: '🇮🇹 意大利语' },
  ja: { name: '日本語', nameZh: '日语', label: '🇯🇵 日语' },
  ko: { name: '한국어', nameZh: '韩语', label: '🇰🇷 韩语' },
  nl: { name: 'Nederlands', nameZh: '荷兰语', label: '🇳 荷兰语' },
  pl: { name: 'Polski', nameZh: '波兰语', label: '🇵🇱 波兰语' },
  ru: { name: 'Русский', nameZh: '俄语', label: '🇷🇺 俄语' },
  tr: { name: 'Türkçe', nameZh: '土耳其语', label: '🇹 土耳其语' }
}

// 各提供商配置
const PROVIDERS = {
  anthropic: {
    label: 'Claude AI',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-20250514',
    keyPrefix: 'sk-ant-',
    keyHint: 'sk-ant-api03-...',
    models: [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-haiku-4-5-20251001'
    ],
    brand: 'Claude AI'
  },
  siliconflow: {
    label: '硅基流动',
    apiUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    keyPrefix: '',
    keyHint: 'sk-...',
    models: [
      'Qwen/Qwen2.5-72B-Instruct',
      'Qwen/Qwen2.5-Coder-32B-Instruct',
      'deepseek-ai/DeepSeek-V3',
      'THUDM/glm-4-9b-chat'
    ],
    brand: '硅基流动'
  },
  deepseek: {
    label: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    keyPrefix: 'sk-',
    keyHint: 'sk-...',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    brand: 'DeepSeek'
  },
  bailian: {
    label: '百炼 (阿里云)',
    apiUrl:
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-turbo',
    keyPrefix: 'sk-',
    keyHint: 'sk-...',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'],
    brand: '百炼'
  },
  openai: {
    label: 'OpenAI 兼容',
    apiUrl: '',
    defaultModel: 'gpt-4o',
    keyPrefix: 'sk-',
    keyHint: 'sk-...',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    brand: '自定义'
  }
}

function populateLangOptions(selectedLang) {
  targetLangSelect.innerHTML = Object.entries(LANGUAGES)
    .map(
      ([code, lang]) =>
        `<option value="${code}">${lang.label} (${code.toUpperCase()})</option>`
    )
    .join('')
  targetLangSelect.value = selectedLang || 'en'
  currentTargetLang = selectedLang || 'en'
}

function populateModelOptions(provider, selectedModel) {
  const config = PROVIDERS[provider]
  const effectiveModel = config.models.includes(selectedModel)
    ? selectedModel
    : config.defaultModel

  modelSelect.innerHTML = config.models
    .map((model) => `<option value="${model}">${model}</option>`)
    .join('')
  modelSelect.value = effectiveModel
  modelHint.textContent = `默认模型: ${config.defaultModel}`

  return effectiveModel
}

function updateProviderUI(provider, options = {}) {
  const { selectedModel = '', customApiUrl = '', targetLang = 'en' } = options
  const config = PROVIDERS[provider]
  const lang = LANGUAGES[targetLang] || LANGUAGES.en

  // 更新顶部品牌文案
  providerLabel.textContent = `中文 → ${lang.name} · 由 ${config.brand} 驱动`

  // 更新 key 提示
  apiKeyInput.placeholder = config.keyHint

  // 更新提示文案
  providerHint.textContent = config.keyPrefix
    ? `Key 前缀要求: ${config.keyPrefix}`
    : '该提供商不限制固定 Key 前缀'

  populateModelOptions(provider, selectedModel)

  // OpenAI 兼容模式允许编辑 API 地址
  if (provider === 'openai') {
    apiUrlInput.removeAttribute('readonly')
    apiUrlInput.style.color = '#e7e9ea'
    apiUrlInput.style.cursor = 'text'
    apiUrlInput.value = customApiUrl || customOpenAIUrl
  } else {
    apiUrlInput.setAttribute('readonly', '')
    apiUrlInput.style.color = '#71767b'
    apiUrlInput.style.cursor = 'default'
    apiUrlInput.value = config.apiUrl
  }
}

function isValidApiUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// 加载已保存的配置
chrome.storage.sync.get(
  ['apiKey', 'provider', 'apiUrl', 'model', 'autoTranslate', 'targetLang'],
  (result) => {
    if (chrome.runtime.lastError) {
      showStatus(`读取设置失败: ${chrome.runtime.lastError.message}`, 'error')
      return
    }

    const provider = result.provider || 'anthropic'
    const savedModel = result.model || PROVIDERS[provider].defaultModel
    const savedLang = result.targetLang || 'en'
    if (provider === 'openai' && result.apiUrl) {
      customOpenAIUrl = result.apiUrl
    }
    currentProvider = provider
    currentTargetLang = savedLang

    providerSelect.value = provider
    if (result.apiKey) apiKeyInput.value = result.apiKey
    if (result.autoTranslate !== undefined)
      autoTranslateToggle.checked = result.autoTranslate
    populateLangOptions(savedLang)
    updateProviderUI(provider, {
      selectedModel: savedModel,
      customApiUrl: result.apiUrl || '',
      targetLang: savedLang
    })
  }
)

// 切换提供商时更新 UI
providerSelect.addEventListener('change', (e) => {
  if (currentProvider === 'openai') {
    customOpenAIUrl = apiUrlInput.value.trim()
  }

  updateProviderUI(e.target.value, {
    customApiUrl: e.target.value === 'openai' ? customOpenAIUrl : '',
    targetLang: currentTargetLang
  })
  currentProvider = e.target.value
})

apiUrlInput.addEventListener('input', () => {
  if (providerSelect.value === 'openai') {
    customOpenAIUrl = apiUrlInput.value.trim()
  }
})

// 显示/隐藏 API Key
toggleKey.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password'
})

// 保存设置
saveBtn.addEventListener('click', () => {
  const provider = providerSelect.value
  const key = apiKeyInput.value.trim()
  const config = PROVIDERS[provider]

  if (!key) {
    showStatus('请输入 API Key', 'error')
    return
  }

  if (config.keyPrefix && !key.startsWith(config.keyPrefix)) {
    showStatus(`API Key 格式不正确（应以 ${config.keyPrefix} 开头）`, 'error')
    return
  }

  const saveData = {
    apiKey: key,
    provider: provider,
    model: modelSelect.value || config.defaultModel,
    targetLang: targetLangSelect.value || 'en',
    autoTranslate: autoTranslateToggle.checked
  }

  if (provider === 'openai') {
    const url = apiUrlInput.value.trim()
    if (!url) {
      showStatus('请输入 API 地址', 'error')
      return
    }
    if (!isValidApiUrl(url)) {
      showStatus('API 地址必须是有效的 HTTPS URL', 'error')
      return
    }
    customOpenAIUrl = url
    saveData.apiUrl = url
  } else {
    saveData.apiUrl = config.apiUrl
  }

  chrome.storage.sync.set(saveData, () => {
    if (chrome.runtime.lastError) {
      showStatus(`保存失败: ${chrome.runtime.lastError.message}`, 'error')
      return
    }
    showStatus('✓ 保存成功！', 'success')
  })
})

function showStatus(msg, type) {
  clearTimeout(statusTimer)
  statusEl.textContent = msg
  statusEl.className = 'status' + (type === 'error' ? ' error' : '')
  statusTimer = setTimeout(() => {
    statusEl.textContent = ''
  }, 2500)
}
