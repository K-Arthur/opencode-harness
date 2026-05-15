/**
 * Quick Settings Panel for Welcome Screen
 * Provides essential settings accessible before starting a session
 */

export interface QuickSettingItem {
  id: string
  type: 'dropdown'
  label: string
  description?: string
  currentValue: string
  options: { label: string; value: string }[]
  onChange: (value: string) => void
}

export interface QuickSettingsConfig {
  container: HTMLElement
  settings: QuickSettingItem[]
}

/**
 * Setup quick settings panel with dropdown selectors
 * Designed for extensibility - add more settings by adding to the config array
 */
export function setupQuickSettings(config: QuickSettingsConfig): void {
  const { container, settings } = config

  // Clear existing content
  container.innerHTML = ''

  // Render each setting item
  settings.forEach((setting) => {
    const settingEl = createSettingItem(setting)
    container.appendChild(settingEl)
  })
}

function createSettingItem(setting: QuickSettingItem): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'quick-setting-item'
  wrapper.setAttribute('data-setting-id', setting.id)

  // Label
  const label = document.createElement('label')
  label.className = 'quick-setting-label'
  label.textContent = setting.label
  label.setAttribute('for', `quick-setting-${setting.id}`)
  wrapper.appendChild(label)

  // Description (optional)
  if (setting.description) {
    const desc = document.createElement('p')
    desc.className = 'quick-setting-description'
    desc.textContent = setting.description
    wrapper.appendChild(desc)
  }

  // Dropdown selector
  const select = document.createElement('select')
  select.id = `quick-setting-${setting.id}`
  select.className = 'quick-setting-select'
  select.setAttribute('aria-label', setting.label)

  setting.options.forEach((option) => {
    const optEl = document.createElement('option')
    optEl.value = option.value
    optEl.textContent = option.label
    if (option.value === setting.currentValue) {
      optEl.selected = true
    }
    select.appendChild(optEl)
  })

  // Handle change
  select.addEventListener('change', (e) => {
    const value = (e.target as HTMLSelectElement).value
    setting.onChange(value)
  })

  wrapper.appendChild(select)

  return wrapper
}
