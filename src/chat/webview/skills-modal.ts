import type { SkillInfo } from "./types"

export interface SkillsModalOptions {
  onToggleSkill: (skillId: string, enabled: boolean) => void
  onSearchSkills: (query: string) => void
}

export function setupSkillsModal(els: any, options: SkillsModalOptions) {
  const skillsModal = els.skillsModal
  const skillsList = els.skillsList
  const searchInput = els.skillsSearchInput
  const closeBtn = els.closeSkillsBtn

  if (!skillsModal || !skillsList || !searchInput || !closeBtn) {
    console.warn("Skills modal elements not found")
    return
  }

  // Close button handler
  closeBtn.addEventListener("click", () => {
    skillsModal.classList.add("hidden")
  })

  // Escape key to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !skillsModal.classList.contains("hidden")) {
      skillsModal.classList.add("hidden")
    }
  })

  // Search input handler
  searchInput.addEventListener("input", (e: Event) => {
    const query = (e.target as HTMLInputElement).value
    options.onSearchSkills(query)
  })

  return {
    renderSkills: (skills: SkillInfo[]) => {
      renderSkillsList(skillsList, skills, options)
    },
    open: () => {
      skillsModal.classList.remove("hidden")
    },
    close: () => {
      skillsModal.classList.add("hidden")
    },
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
    item.className = `skill-item skill-item--${skill.enabled ? "enabled" : "disabled"}`
    item.dataset.skillId = skill.id

    // Toggle switch
    const toggle = document.createElement("button")
    toggle.className = "skill-toggle"
    toggle.setAttribute("aria-label", `${skill.enabled ? "Disable" : "Enable"} ${skill.name}`)
    toggle.setAttribute("aria-pressed", String(skill.enabled))
    toggle.innerHTML = `<span class="skill-toggle-track"></span>`
    toggle.addEventListener("click", () => {
      options.onToggleSkill(skill.id, !skill.enabled)
    })

    // Info
    const info = document.createElement("div")
    info.className = "skill-info"

    const name = document.createElement("div")
    name.className = "skill-name"
    name.textContent = skill.name

    const description = document.createElement("div")
    description.className = "skill-description"
    description.textContent = skill.description || ""

    info.appendChild(name)
    info.appendChild(description)

    item.appendChild(toggle)
    item.appendChild(info)
    list.appendChild(item)
  })

  container.appendChild(list)
}
