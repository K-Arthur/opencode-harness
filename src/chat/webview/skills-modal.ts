import { createFocusTrap, type FocusTrap } from "./focus-trap"
import type { SkillInfo } from "./types"

export interface SkillsModalOptions {
  onToggleSkill: (skillId: string, enabled: boolean) => void
  onSearchSkills: (query: string) => void
}

export function setupSkillsModal(els: any, options: SkillsModalOptions) {
  const skillsModal = els.skillsModal
  const skillsList = els.skillsList
  const searchInput = els.skillsSearchInput
  const closeBtn = els.skillsModalCloseBtn

  if (!skillsModal || !skillsList || !searchInput || !closeBtn) {
    console.warn("Skills modal elements not found")
    return
  }

  let allSkills: SkillInfo[] = []
  let activeCategory = "all"
  let focusTrap: FocusTrap | null = null
  let openTrigger: HTMLElement | null = null

  function closeModal() {
    skillsModal.classList.add("hidden")
    if (focusTrap) { focusTrap.destroy(); focusTrap = null }
    const trigger = openTrigger ?? document.getElementById("skills-btn")
    trigger?.focus()
    openTrigger = null
  }

  closeBtn.addEventListener("click", closeModal)

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !skillsModal.classList.contains("hidden")) { e.stopPropagation(); closeModal() }
  })

  searchInput.addEventListener("input", (e: Event) => {
    const query = (e.target as HTMLInputElement).value
    options.onSearchSkills(query)
  })

  const filterContainer = document.getElementById("skills-filter")

  function rebuildFilters(skills: SkillInfo[]) {
    if (!filterContainer) return
    // Collect unique non-empty categories preserving insertion order
    const categories: string[] = []
    const seen = new Set<string>()
    for (const s of skills) {
      if (s.category && !seen.has(s.category)) {
        seen.add(s.category)
        categories.push(s.category)
      }
    }
    // Preserve the "All" button, then replace dynamic buttons
    const allBtn = filterContainer.querySelector<HTMLElement>('[data-category="all"]')
    filterContainer.innerHTML = ""
    if (allBtn) filterContainer.appendChild(allBtn)
    for (const cat of categories) {
      const btn = document.createElement("button")
      btn.className = "skills-modal-filter-btn"
      btn.dataset.category = cat
      btn.textContent = cat.charAt(0).toUpperCase() + cat.slice(1)
      btn.setAttribute("aria-pressed", String(activeCategory === cat))
      if (activeCategory === cat) btn.classList.add("active")
      filterContainer.appendChild(btn)
    }
    // Reset active if the current category no longer exists
    if (activeCategory !== "all" && !seen.has(activeCategory)) {
      activeCategory = "all"
      filterContainer.querySelectorAll<HTMLElement>(".skills-modal-filter-btn").forEach((b) => {
        const isAll = b.dataset.category === "all"
        b.classList.toggle("active", isAll)
        b.setAttribute("aria-pressed", String(isAll))
      })
    }
  }

  filterContainer?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".skills-modal-filter-btn")
    if (!btn) return
    const category = btn.dataset.category ?? "all"
    activeCategory = category
    filterContainer.querySelectorAll<HTMLElement>(".skills-modal-filter-btn").forEach((b) => {
      const active = b.dataset.category === category
      b.classList.toggle("active", active)
      b.setAttribute("aria-pressed", String(active))
    })
    const filtered = category === "all"
      ? allSkills
      : allSkills.filter((s) => s.category === category)
    renderSkillsList(skillsList, filtered, options)
  })

  return {
    renderSkills: (skills: SkillInfo[]) => {
      allSkills = skills
      rebuildFilters(skills)
      const filtered = activeCategory === "all"
        ? skills
        : skills.filter((s) => s.category === activeCategory)
      renderSkillsList(skillsList, filtered, options)
    },
    renderSearchResults: (results: SkillInfo[]) => {
      // Server-side search results bypass the local category filter
      renderSkillsList(skillsList, results, options)
    },
    open: () => {
      openTrigger = document.activeElement as HTMLElement
      skillsModal.classList.remove("hidden")
      focusTrap = createFocusTrap(skillsModal)
      document.addEventListener("keydown", focusTrap.handler)
      searchInput.focus()
    },
    close: closeModal,
  }
}

function renderSkillsList(container: HTMLElement, skills: SkillInfo[], options: SkillsModalOptions) {
  container.innerHTML = ""

  if (skills.length === 0) {
    const empty = document.createElement("div")
    empty.className = "skills-empty"
    empty.textContent = "No skills found"
    container.appendChild(empty)
    return
  }

  const list = document.createElement("div")
  list.className = "skills-list"

  skills.forEach((skill) => {
    const item = document.createElement("div")
    item.className = "skill-item"
    item.dataset.skillId = skill.id

    // Toggle controls whether this skill is SUGGESTED to the model in the
    // methodology hint. The opencode server manages skill loading itself and
    // does not accept enable/disable — be honest about that in the label so
    // users don't believe the toggle prevents the server from using a skill.
    const toggle = document.createElement("div")
    toggle.className = `skill-item-toggle${skill.enabled ? " checked" : ""}`
    toggle.setAttribute("role", "checkbox")
    toggle.setAttribute("aria-checked", String(skill.enabled))
    toggle.setAttribute("aria-label", `Suggest ${skill.name} to the model`)
    toggle.title = "Controls whether this skill is suggested to the model. The opencode server may still load it on its own."
    toggle.setAttribute("tabindex", "0")
    toggle.addEventListener("click", () => {
      options.onToggleSkill(skill.id, !skill.enabled)
    })
    toggle.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); options.onToggleSkill(skill.id, !skill.enabled) }
    })

    // Content
    const content = document.createElement("div")
    content.className = "skill-item-content"

    const name = document.createElement("div")
    name.className = "skill-item-name"
    name.textContent = skill.name

    const description = document.createElement("div")
    description.className = "skill-item-description"
    description.textContent = skill.description || ""

    content.appendChild(name)
    content.appendChild(description)

    if (skill.category) {
      const category = document.createElement("div")
      category.className = "skill-item-category"
      category.textContent = skill.category
      content.appendChild(category)
    }

    // Performance metrics
    if (skill.performanceScore !== undefined || skill.usageCount !== undefined) {
      const metrics = document.createElement("div")
      metrics.className = "skill-item-metrics"

      if (skill.performanceScore !== undefined) {
        const score = document.createElement("span")
        score.className = "skill-item-score"
        score.textContent = `Score: ${(skill.performanceScore * 100).toFixed(0)}%`
        metrics.appendChild(score)
      }

      if (skill.usageCount !== undefined) {
        const usage = document.createElement("span")
        usage.className = "skill-item-usage"
        usage.textContent = `Used: ${skill.usageCount}x`
        metrics.appendChild(usage)
      }

      content.appendChild(metrics)
    }

    item.appendChild(toggle)
    item.appendChild(content)
    list.appendChild(item)
  })

  container.appendChild(list)
}
