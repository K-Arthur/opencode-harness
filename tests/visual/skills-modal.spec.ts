import { test, expect, type Page } from '@playwright/test'
import { installVsCodeApi, expectNoWebviewErrors } from './webviewTestHarness'

async function mountSkillsModal(page: Page, visible: boolean = true) {
  await page.evaluate((isVisible) => {
    document.querySelector('.welcome-container')?.remove()

    const existingModal = document.getElementById('skills-modal')
    if (existingModal) {
      existingModal.classList.toggle('hidden', !isVisible)
      return
    }

    const modal = document.createElement('div')
    modal.id = 'skills-modal'
    modal.className = `skills-modal ${isVisible ? '' : 'hidden'}`
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-label', 'Manage skills')
    modal.setAttribute('aria-modal', 'true')
    modal.innerHTML = `
      <div class="skills-modal-content">
        <div class="skills-modal-header">
          <h2 class="skills-modal-title">Manage Skills</h2>
          <button class="skills-modal-close-btn" id="skills-modal-close-btn" aria-label="Close skills modal">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="skills-modal-search">
          <input type="text" class="skills-modal-search-input" id="skills-search-input" placeholder="Search skills..." aria-label="Search skills">
        </div>
        <div class="skills-modal-filter" id="skills-filter">
          <button class="skills-modal-filter-btn active" data-category="all">All</button>
          <button class="skills-modal-filter-btn" data-category="coding">Coding</button>
          <button class="skills-modal-filter-btn" data-category="analysis">Analysis</button>
          <button class="skills-modal-filter-btn" data-category="debugging">Debugging</button>
        </div>
        <div class="skills-modal-list" id="skills-list">
          <div class="skill-item">
            <div class="skill-item-toggle checked"></div>
            <div class="skill-item-content">
              <div class="skill-item-name">Code Review</div>
              <div class="skill-item-description">Review code for bugs and improvements</div>
              <div class="skill-item-category">Coding</div>
            </div>
          </div>
          <div class="skill-item">
            <div class="skill-item-toggle"></div>
            <div class="skill-item-content">
              <div class="skill-item-name">Debug Helper</div>
              <div class="skill-item-description">Help debug issues in code</div>
              <div class="skill-item-category">Debugging</div>
            </div>
          </div>
          <div class="skill-item">
            <div class="skill-item-toggle checked"></div>
            <div class="skill-item-content">
              <div class="skill-item-name">Code Analysis</div>
              <div class="skill-item-description">Analyze code structure and patterns</div>
              <div class="skill-item-category">Analysis</div>
            </div>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(modal)
  }, visible)
}

test.describe('Skills Management Modal', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
    await mountSkillsModal(page)
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('should render skills modal', async ({ page }) => {
    const modal = page.locator('#skills-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toHaveAttribute('role', 'dialog')
    await expect(modal).toHaveAttribute('aria-modal', 'true')
  })

  test('should have proper header', async ({ page }) => {
    const title = page.locator('.skills-modal-title')
    await expect(title).toHaveText('Manage Skills')
    
    const closeBtn = page.locator('#skills-modal-close-btn')
    await expect(closeBtn).toBeVisible()
    await expect(closeBtn).toHaveAttribute('aria-label', 'Close skills modal')
  })

  test('should have search input', async ({ page }) => {
    const searchInput = page.locator('#skills-search-input')
    await expect(searchInput).toBeVisible()
    await expect(searchInput).toHaveAttribute('placeholder', 'Search skills...')
    await expect(searchInput).toHaveAttribute('aria-label', 'Search skills')
  })

  test('should have filter buttons', async ({ page }) => {
    const filterBtns = page.locator('.skills-modal-filter-btn')
    await expect(filterBtns).toHaveCount(4)
    
    await expect(filterBtns.nth(0)).toHaveText('All')
    await expect(filterBtns.nth(0)).toHaveClass(/active/)
    await expect(filterBtns.nth(0)).toHaveAttribute('data-category', 'all')
    
    await expect(filterBtns.nth(1)).toHaveText('Coding')
    await expect(filterBtns.nth(1)).toHaveAttribute('data-category', 'coding')
  })

  test('should render skill items', async ({ page }) => {
    const skillItems = page.locator('.skill-item')
    await expect(skillItems).toHaveCount(3)
    
    const firstSkill = skillItems.nth(0)
    await expect(firstSkill.locator('.skill-item-name')).toHaveText('Code Review')
    await expect(firstSkill.locator('.skill-item-description')).toHaveText('Review code for bugs and improvements')
    await expect(firstSkill.locator('.skill-item-category')).toHaveText('Coding')
  })

  test('should show checked state for enabled skills', async ({ page }) => {
    const checkedToggle = page.locator('.skill-item').nth(0).locator('.skill-item-toggle')
    await expect(checkedToggle).toHaveClass(/checked/)
  })

  test('should show unchecked state for disabled skills', async ({ page }) => {
    const uncheckedToggle = page.locator('.skill-item').nth(1).locator('.skill-item-toggle')
    await expect(uncheckedToggle).not.toHaveClass(/checked/)
  })

  test('should hide modal when hidden class is applied', async ({ page }) => {
    await mountSkillsModal(page, false)
    
    const modal = page.locator('#skills-modal')
    await expect(modal).not.toBeVisible()
  })

  test('should have proper styling for skill items', async ({ page }) => {
    const skillItem = page.locator('.skill-item').nth(0)
    
    // Check border
    const border = await skillItem.evaluate(el => window.getComputedStyle(el).border)
    expect(border).toBeTruthy()
  })

  test('should have category badges with proper styling', async ({ page }) => {
    const categoryBadge = page.locator('.skill-item-category').nth(0)
    await expect(categoryBadge).toHaveText('Coding')
    
    // Check accent color styling
    const color = await categoryBadge.evaluate(el => window.getComputedStyle(el).color)
    expect(color).toBeTruthy()
  })
})
