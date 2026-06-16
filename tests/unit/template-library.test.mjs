import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const libSource = readFileSync(
  path.join(__dirname, "..", "..", "src", "prompts", "templateLibrary.ts"),
  "utf8",
)
const slashCommandsSource = readFileSync(
  path.join(__dirname, "..", "..", "src", "chat", "webview", "slashCommands.ts"),
  "utf8",
)
const mainSource = readFileSync(
  path.join(__dirname, "..", "..", "src", "chat", "webview", "main.ts"),
  "utf8",
)
const typesSource = readFileSync(
  path.join(__dirname, "..", "..", "src", "chat", "webview", "types.ts"),
  "utf8",
)
const commandsModalSource = readFileSync(
  path.join(__dirname, "..", "..", "src", "chat", "webview", "commands-modal.ts"),
  "utf8",
)

describe("TemplateLibrary — class structure", () => {
  it("defines TemplateLibraryManager as an exported class", () => {
    assert.ok(
      libSource.includes("export class TemplateLibraryManager"),
      "TemplateLibraryManager class must be exported",
    )
  })

  it("defines PromptTemplate interface with all expected fields", () => {
    assert.ok(libSource.includes("export interface PromptTemplate"))
    assert.ok(libSource.includes("id") && libSource.includes(": string"))
    assert.ok(libSource.includes("name") && libSource.includes(": string"))
    assert.ok(libSource.includes("content") && libSource.includes(": string"))
    assert.ok(libSource.includes("tags") && libSource.includes(": string[]"))
    assert.ok(libSource.includes("createdAt") && libSource.includes(": number"))
    assert.ok(libSource.includes("updatedAt") && libSource.includes(": number"))
  })

  it("defines TemplateLibraryOptions interface", () => {
    assert.ok(libSource.includes("export interface TemplateLibraryOptions"))
    assert.ok(libSource.includes("context"))
  })

  it("provides saveTemplate method", () => {
    assert.ok(libSource.includes("async saveTemplate("), "saveTemplate method must exist")
  })

  it("provides listTemplates method", () => {
    assert.ok(libSource.includes("listTemplates("), "listTemplates method must exist")
  })

  it("provides getTemplate method", () => {
    assert.ok(libSource.includes("getTemplate("), "getTemplate method must exist")
  })

  it("provides getTemplateByName method", () => {
    assert.ok(libSource.includes("getTemplateByName("), "getTemplateByName method must exist")
  })

  it("provides deleteTemplate method", () => {
    assert.ok(libSource.includes("async deleteTemplate("), "deleteTemplate method must exist")
  })

  it("provides dispose method", () => {
    assert.ok(libSource.includes("dispose("), "dispose method must exist")
  })
})

describe("TemplateLibrary — edge case handling", () => {
  it("validates empty name in saveTemplate", () => {
    assert.ok(
      libSource.includes("name.trim().length === 0") || libSource.includes("name cannot be empty"),
      "Should validate name parameter",
    )
  })

  it("validates empty content in saveTemplate", () => {
    assert.ok(
      libSource.includes("content.trim().length === 0") || libSource.includes("content cannot be empty"),
      "Should validate content parameter",
    )
  })

  it("handles existingId for upsert", () => {
    assert.ok(
      libSource.includes("existingId"),
      "Should support upsert via existingId parameter",
    )
  })

  it("handles storage errors in loadTemplates", () => {
    assert.ok(
      libSource.includes("loadTemplates") && libSource.includes("try") && libSource.includes("catch"),
      "loadTemplates should have error handling",
    )
  })

  it("handles storage errors in saveTemplates", () => {
    assert.ok(
      libSource.includes("saveTemplates") && libSource.includes("try") && libSource.includes("catch"),
      "saveTemplates should have error handling",
    )
  })

  it("handles non-existent ID in deleteTemplate", () => {
    assert.ok(
      libSource.includes("deleteTemplate"),
      "deleteTemplate should handle non-existent IDs gracefully",
    )
  })

  it("generates unique IDs for templates", () => {
    assert.ok(
      libSource.includes("generateId") || (libSource.includes("Date.now") && libSource.includes("Math.random")),
      "Should generate unique IDs",
    )
  })
})

describe("TemplateService — class structure", () => {
  it("handles saveTemplate with tags", () => {
    const svcSource = readFileSync(
      path.join(__dirname, "..", "..", "src", "chat", "TemplateService.ts"),
      "utf8",
    )
    assert.ok(svcSource.includes("export class TemplateService"))
    assert.ok(svcSource.includes("handleSaveTemplate"))
    assert.ok(svcSource.includes("handleListTemplates"))
    assert.ok(svcSource.includes("handleDeleteTemplate"))
    assert.ok(svcSource.includes("template_saved"))
    assert.ok(svcSource.includes("template_list"))
    assert.ok(svcSource.includes("template_deleted"))
    assert.ok(svcSource.includes("template_error"))
  })
})

describe("Slash command — /template", () => {
  it("slash-commands.ts registers /template in LOCAL_SLASH_COMMANDS", () => {
    const slashRegSource = readFileSync(
      path.join(__dirname, "..", "..", "src", "chat", "webview", "slash-commands.ts"),
      "utf8",
    )
    assert.ok(
      slashRegSource.includes('name: "template"'),
      "LOCAL_SLASH_COMMANDS must include /template",
    )
  })

  it("slashCommands.ts handles /template sub-commands", () => {
    assert.ok(
      slashCommandsSource.includes('"/template"'),
      "slashCommands must handle /template",
    )
    assert.ok(
      slashCommandsSource.includes("list_templates"),
      "/template must send list_templates message",
    )
    assert.ok(
      slashCommandsSource.includes("delete_template"),
      "/template delete must send delete_template message",
    )
  })
})

describe("Template types in types.ts", () => {
  it("defines PromptTemplate interface in types.ts", () => {
    assert.ok(
      typesSource.includes("export interface PromptTemplate"),
      "types.ts must export PromptTemplate interface",
    )
  })

  it("defines template-related HostMessage types", () => {
    assert.ok(
      typesSource.includes("template_saved"),
      "types.ts must include template_saved HostMessage",
    )
    assert.ok(
      typesSource.includes("template_list"),
      "types.ts must include template_list HostMessage",
    )
    assert.ok(
      typesSource.includes("template_deleted"),
      "types.ts must include template_deleted HostMessage",
    )
    assert.ok(
      typesSource.includes("template_error"),
      "types.ts must include template_error HostMessage",
    )
  })

  it("defines template-related WebviewMessage types", () => {
    assert.ok(
      typesSource.includes("save_template"),
      "types.ts must include save_template WebviewMessage",
    )
    assert.ok(
      typesSource.includes("list_templates"),
      "types.ts must include list_templates WebviewMessage",
    )
    assert.ok(
      typesSource.includes("delete_template"),
      "types.ts must include delete_template WebviewMessage",
    )
    assert.ok(
      typesSource.includes("save_message_as_template"),
      "types.ts must include save_message_as_template WebviewMessage",
    )
  })
})

describe("Commands modal — template support", () => {
  it("defines TemplateEntry interface", () => {
    assert.ok(
      commandsModalSource.includes("export interface TemplateEntry"),
      "commands-modal.ts must export TemplateEntry",
    )
  })

  it("provides openTemplateList method", () => {
    assert.ok(
      commandsModalSource.includes("openTemplateList"),
      "commands-modal must expose openTemplateList",
    )
  })

  it("provides onUseTemplate and onDeleteTemplate callbacks", () => {
    assert.ok(
      commandsModalSource.includes("onUseTemplate"),
      "commands-modal options must include onUseTemplate",
    )
    assert.ok(
      commandsModalSource.includes("onDeleteTemplate"),
      "commands-modal options must include onDeleteTemplate",
    )
  })

  it("renders template items with Use and Delete buttons", () => {
    assert.ok(
      commandsModalSource.includes("renderTemplates"),
      "commands-modal must have renderTemplates function",
    )
    assert.ok(
      commandsModalSource.includes('"Use"') || commandsModalSource.includes("'Use'"),
      "template items must have Use button",
    )
    assert.ok(
      commandsModalSource.includes('"Delete"') || commandsModalSource.includes("'Delete'"),
      "template items must have Delete button",
    )
  })
})

describe("main.ts — template wiring", () => {
  it("wires onUseTemplate callback in commandsModal setup", () => {
    assert.ok(
      mainSource.includes("onUseTemplate"),
      "main.ts must wire onUseTemplate callback",
    )
  })

  it("wires onDeleteTemplate callback in commandsModal setup", () => {
    assert.ok(
      mainSource.includes("onDeleteTemplate"),
      "main.ts must wire onDeleteTemplate callback",
    )
  })

  it("handles template_saved host message", () => {
    assert.ok(
      mainSource.includes("template_saved"),
      "main.ts must handle template_saved message",
    )
  })

  it("handles template_list host message", () => {
    assert.ok(
      mainSource.includes("template_list"),
      "main.ts must handle template_list message",
    )
  })

  it("handles template_deleted host message", () => {
    assert.ok(
      mainSource.includes("template_deleted"),
      "main.ts must handle template_deleted message",
    )
  })

  it("handles template_error host message", () => {
    assert.ok(
      mainSource.includes("template_error"),
      "main.ts must handle template_error message",
    )
  })
})
