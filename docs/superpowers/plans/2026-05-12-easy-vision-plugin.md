# OpenCode Easy Vision Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `opencode-easy-vision` - a generic OpenCode plugin that enables vision support for models that lack native vision capability, using any MCP vision server.

**Architecture:**
- Plugin hooks into OpenCode's `chat.message` event
- Detects when images in messages
- For non-vision models: saves images to temp files, injects prompt to use vision MCP tool
- For vision models: passes through unchanged
- Fully configurable: models, image analysis tool, prompt template

**Tech Stack:**
- TypeScript
- `@opencode-ai/plugin` SDK
- Node.js `node:test` (for tests)

---

## Plugin Design

### Core Features

1. **Model Detection** - Detect if current model has native vision capabilities
2. **Image Interception** - Use `chat.message` hook to detect image parts
3. **Temp File Management** - Save pasted images to temporary files
4. **Prompt Injection** - Tell model to use vision MCP tool with file paths
5. **Configuration** - Customizable via JSON config file

### Configuration Format

```json
// ~/.config/opencode/opencode-easy-vision.json
{
  "models": ["anthropic/claude-*", "openai/gpt-4*"],
  "excludeModels": ["anthropic/*vision*", "*sonnet*"],
  "imageAnalysisTool": "mcp_clipboard_vision_analyze_image",
  "promptTemplate": "I'm attaching {imageCount} image(s) for you to analyze.\n\nImages:\n{imageList}\n\nUse the `{toolName}` tool on each one.\n\nMy question: {userText}"
}
```

### Vision Model Patterns

Pre-configured patterns for common vision models:
- `anthropic/*-vision-*`
- `anthropic/*sonnet*`
- `openai/gpt-4o*`
- `openai/gpt-4-vision*`
- `google/gemini-*`
- `*/*-vl-*`
- `*/*vision*`

---

## Project Structure

```
opencode-easy-vision/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # Main plugin entry
│   ├── types.ts          # Type definitions
│   ├── config.ts         # Config loading
│   ├── modelDetector.ts  # Vision model detection
│   ├── imageSaver.ts      # Save images to temp files
│   └── promptInjector.ts # Build injection prompt
└── tests/
    ├── config.test.ts
    ├── modelDetector.test.ts
    ├── imageSaver.test.ts
    └── promptInjector.test.ts
```

---

## Task 1: Set up project structure and package.json

**Files:**
- Create: `opencode-easy-vision/package.json`
- Create: `opencode-easy-vision/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "opencode-easy-vision",
  "version": "1.0.0",
  "description": "OpenCode plugin that enables vision support for models lacking native vision capability",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "test": "node --test tests/",
    "lint": "tsc --noEmit",
    "prepublishOnly": "npm run build"
  },
  "keywords": [
    "opencode",
    "opencode-plugin",
    "vision",
    "image-analysis",
    "mcp"
  ],
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "@opencode-ai/plugin": "^1.1.25"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": ">=1.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Initialize git (if needed)**

```bash
mkdir -p opencode-easy-vision
cd opencode-easy-vision
npm install
```

- [ ] **Step 4: Commit**

```bash
git init
git add package.json tsconfig.json
git commit -m "chore: initial project setup"
```

---

## Task 2: Create type definitions

**Files:**
- Create: `opencode-easy-vision/src/types.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/types.test.ts`:

```typescript
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "../src/types.ts"), "utf8")

describe("types.ts", () => {
  it("defines PluginConfig interface", () => {
    assert.ok(
      source.includes("interface PluginConfig"),
      "must define PluginConfig interface"
    )
  })

  it("has models property in PluginConfig", () => {
    assert.ok(
      source.includes("models?: string[]"),
      "must have models property"
    )
  })

  it("has excludeModels property in PluginConfig", () => {
    assert.ok(
      source.includes("excludeModels?: string[]"),
      "must have excludeModels property"
    )
  })

  it("has imageAnalysisTool property in PluginConfig", () => {
    assert.ok(
      source.includes("imageAnalysisTool?: string"),
      "must have imageAnalysisTool property"
    )
  })

  it("has promptTemplate property in PluginConfig", () => {
    assert.ok(
      source.includes("promptTemplate?: string"),
      "must have promptTemplate property"
    )
  })

  it("defines SavedImage interface", () => {
    assert.ok(
      source.includes("interface SavedImage"),
      "must define SavedImage interface"
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd opencode-easy-vision && npm test`
Expected: FAIL (file doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

Create `src/types.ts`:

```typescript
export interface PluginConfig {
  /**
   * Model ID patterns to match for this plugin to activate.
   * Supports glob patterns: "*" matches any characters, "?" matches a single character.
   * 
   * Example: ["anthropic/claude-*", "openai/gpt-4*"]
   */
  models?: string[]

  /**
   * Model ID patterns to EXCLUDE from vision handling.
   * These are typically models with native vision capabilities.
   * 
   * Example: ["anthropic/*vision*", "*sonnet*"]
   */
  excludeModels?: string[]

  /**
   * Name of the MCP tool to use for image analysis.
   * 
   * The full tool name as it appears in OpenCode (typically prefixed with "mcp_<serverName>_").
   * 
   * Examples:
   * - "mcp_clipboard_vision_analyze_image"
   * - "mcp_minimax_understand_image"
   * - "mcp_openrouter_image_analyze_image"
   */
  imageAnalysisTool?: string

  /**
   * Custom prompt template for injecting image analysis instructions.
   * 
   * Available variables:
   * - {imageCount}: Number of images
   * - {imageList}: Newline-separated list of image paths
   * - {toolName}: The configured image analysis tool name
   * - {userText}: The user's original message text
   */
  promptTemplate?: string
}

export interface SavedImage {
  /** Full path to the saved image file */
  path: string

  /** MIME type of the image */
  mime: string

  /** Original part ID from the message (if applicable) */
  partId?: string
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd opencode-easy-vision && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add type definitions"
```

---

## Task 3: Implement model detector

**Files:**
- Create: `opencode-easy-vision/src/modelDetector.ts`
- Test: `opencode-easy-vision/tests/modelDetector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modelDetector.test.ts`:

```typescript
import { describe, it } from "node:test"
import assert from "node:assert/strict"

// We'll test the actual implementation after writing it
describe("modelDetector", () => {
  it("should be importable", async () => {
    // This test will pass once the file exists
    const module = await import("../src/modelDetector.js")
    assert.ok(module)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd opencode-easy-vision && npm test`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `src/modelDetector.ts`:

```typescript
import type { PluginConfig } from "./types"

/**
 * Default patterns for models with native vision capabilities.
 * These models are excluded from vision MCP tool routing.
 */
const DEFAULT_VISION_MODEL_PATTERNS = [
  // Anthropic vision models
  "anthropic/*-vision-*",
  "anthropic/*sonnet*",
  "anthropic/*opus*",
  // OpenAI vision models
  "openai/gpt-4o*",
  "openai/gpt-4-vision*",
  // Google vision models
  "google/gemini-*",
  // General vision patterns
  "*/*-vl-*",
  "*/*vision*",
]

/**
 * Convert glob-style patterns to RegExp.
 * Supports: * = any characters, ? = single character.
 */
function patternsToRegex(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => {
    const escapeRegex = (s: string): string =>
      s
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\*/g, ".*")
        .replace(/\\\?/g, ".")

    return new RegExp(`^${escapeRegex(pattern)}$`, "i")
  })
}

/**
 * Check if a model ID matches any of the given patterns.
 */
function matchesAnyPattern(modelId: string, patterns: RegExp[]): boolean {
  return patterns.some((regex) => regex.test(modelId))
}

/**
 * Determine if a model has native vision capabilities.
 * 
 * A model is considered to have native vision if:
 * 1. It matches any pattern in excludeModels (from config), OR
 * 2. It matches any default vision model patterns
 */
export function hasNativeVision(
  modelId: string,
  config?: PluginConfig,
): boolean {
  const excludePatterns = config?.excludeModels ?? DEFAULT_VISION_MODEL_PATTERNS
  const allExcludePatterns = [
    ...excludePatterns,
    ...(config?.excludeModels ? [] : DEFAULT_VISION_MODEL_PATTERNS),
  ]

  const regexes = patternsToRegex(allExcludePatterns)
  return matchesAnyPattern(modelId, regexes)
}

/**
 * Determine if this plugin should activate for the given model.
 * 
 * The plugin activates if:
 * 1. No models are specified in config (activate for all), OR
 * 2. The model matches any pattern in config.models
 * 
 * AND the model does NOT have native vision capabilities.
 */
export function shouldActivate(
  providerId: string,
  modelId: string,
  config?: PluginConfig,
): boolean {
  const fullModelId = `${providerId}/${modelId}`

  // First check if model has native vision - if yes, don't activate
  if (hasNativeVision(fullModelId, config)) {
    return false
  }

  // If no models specified in config, activate for all non-vision models
  if (!config?.models || config.models.length === 0) {
    return true
  }

  // Check if model matches any pattern in config.models
  const modelRegexes = patternsToRegex(config.models)
  return matchesAnyPattern(fullModelId, modelRegexes)
}

export { patternsToRegex, matchesAnyPattern }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd opencode-easy-vision && npm run build && npm test`
Expected: PASS

- [ ] **Step 5: Add more comprehensive tests**

Update `tests/modelDetector.test.ts`:

```typescript
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  hasNativeVision,
  shouldActivate,
  patternsToRegex,
  matchesAnyPattern,
} from "../src/modelDetector.js"

describe("patternsToRegex", () => {
  it("converts glob patterns to regex correctly", () => {
    const regexes = patternsToRegex(["claude-*", "gpt-4?"])
    assert.ok(regexes.length === 2)
  })

  it("matches exact model IDs against patterns", () => {
    const regexes = patternsToRegex(["anthropic/*", "openai/gpt-4*"])
    assert.ok(matchesAnyPattern("anthropic/claude-sonnet-4", regexes))
    assert.ok(matchesAnyPattern("openai/gpt-4o", regexes))
    assert.ok(!matchesAnyPattern("google/gemini-pro", regexes))
  })
})

describe("hasNativeVision", () => {
  it("returns true for known vision models", () => {
    assert.ok(hasNativeVision("anthropic/claude-sonnet-4-20250514"))
    assert.ok(hasNativeVision("openai/gpt-4o"))
    assert.ok(hasNativeVision("google/gemini-1.5-pro"))
  })

  it("returns false for non-vision models", () => {
    assert.ok(!hasNativeVision("anthropic/claude-3-5-haiku"))
    assert.ok(!hasNativeVision("minimax/m2.5"))
  })

  it("respects custom excludeModels from config", () => {
    const config = {
      excludeModels: ["custom/*vision*"]
    }
    assert.ok(hasNativeVision("custom/my-vision-model", config))
  })
})

describe("shouldActivate", () => {
  it("returns false for vision models", () => {
    assert.ok(!shouldActivate("anthropic", "claude-sonnet-4-20250514"))
  })

  it("returns true for non-vision models by default", () => {
    assert.ok(shouldActivate("minimax", "m2.5"))
    assert.ok(shouldActivate("openrouter", "nvidia/nemotron-nano-12b"))
  })

  it("respects custom models list from config", () => {
    const config = {
      models: ["minimax/*", "openrouter/*"]
    }
    assert.ok(shouldActivate("minimax", "m2.5", config))
    assert.ok(shouldActivate("openrouter", "any-model", config))
    assert.ok(!shouldActivate("anthropic", "claude-haiku", config))
  })

  it("excludes vision models even if in models list", () => {
    const config = {
      models: ["anthropic/*"]
    }
    // Vision model - should be excluded
    assert.ok(!shouldActivate("anthropic", "claude-sonnet-4-vision", config))
  })
})
```

- [ ] **Step 6: Run comprehensive tests**

Run: `cd opencode-easy-vision && npm run build && npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/modelDetector.ts tests/modelDetector.test.ts
git commit -m "feat: implement model detection logic"
```

---

## Task 4: Implement config loading

**Files:**
- Create: `opencode-easy-vision/src/config.ts`
- Test: `opencode-easy-vision/tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/config.test.ts`:

```typescript
import { describe, it } from "node:test"
import assert from "node:assert/strict"

describe("config loading", () => {
  it("should be importable", async () => {
    const module = await import("../src/config.js")
    assert.ok(module.loadConfig)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd opencode-easy-vision && npm test`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `src/config.ts`:

```typescript
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import type { PluginConfig } from "./types"

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: PluginConfig = {
  // No models filter = activate for all non-vision models
  models: undefined,
  // Use default vision model patterns for exclusion
  excludeModels: undefined,
  // Default tool - users should override this
  imageAnalysisTool: undefined,
  // Default prompt template
  promptTemplate: undefined,
}

/**
 * Default prompt template.
 */
export const DEFAULT_PROMPT_TEMPLATE = `I'm attaching {imageCount} image(s) for you to analyze.

Images:
{imageList}

Use the \`{toolName}\` tool on each one to understand what they show.

My question: {userText}`

/**
 * Get possible config file locations in order of priority:
 * 1. Project-level: .opencode/opencode-easy-vision.json
 * 2. User-level: ~/.config/opencode/opencode-easy-vision.json
 */
function getConfigPaths(): string[] {
  const paths: string[] = []

  // Project-level
  const cwd = process.cwd()
  paths.push(path.join(cwd, ".opencode", "opencode-easy-vision.json"))

  // User-level
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  paths.push(path.join(configHome, "opencode", "opencode-easy-vision.json"))

  return paths
}

/**
 * Load and parse a config file.
 * Returns default config if file doesn't exist or has errors.
 */
function loadConfigFile(configPath: string): PluginConfig | null {
  if (!fs.existsSync(configPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(configPath, "utf8")
    return JSON.parse(content) as PluginConfig
  } catch (err) {
    console.warn(`[opencode-easy-vision] Warning: Failed to load config from ${configPath}: ${err}`)
    return null
  }
}

/**
 * Load configuration from all possible locations.
 * Merges with defaults.
 */
export function loadConfig(): PluginConfig {
  for (const configPath of getConfigPaths()) {
    const config = loadConfigFile(configPath)
    if (config) {
      return {
        ...DEFAULT_CONFIG,
        ...config,
      }
    }
  }

  return DEFAULT_CONFIG
}

export { getConfigPaths, loadConfigFile }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd opencode-easy-vision && npm run build && npm test`
Expected: PASS

- [ ] **Step 5: Add more comprehensive tests**

Update `tests/config.test.ts`:

```typescript
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  loadConfig,
  loadConfigFile,
  getConfigPaths,
  DEFAULT_PROMPT_TEMPLATE,
} from "../src/config.js"

describe("getConfigPaths", () => {
  it("returns both project and user config paths", () => {
    const paths = getConfigPaths()
    assert.ok(paths.length >= 2)
    assert.ok(paths[0].includes(".opencode"))
    assert.ok(paths[1].includes(".config"))
  })
})

describe("loadConfigFile", () => {
  it("returns null for non-existent file", () => {
    const result = loadConfigFile("/nonexistent/path.json")
    assert.ok(result === null)
  })

  it("parses valid JSON config", (t) => {
    // Create a temp config file for testing
    const tempDir = os.tmpdir()
    const testConfigPath = path.join(tempDir, "test-opencode-easy-vision.json")
    
    const testConfig = {
      models: ["minimax/*", "openrouter/*"],
      imageAnalysisTool: "mcp_custom_analyze_image",
    }
    
    fs.writeFileSync(testConfigPath, JSON.stringify(testConfig))
    
    const result = loadConfigFile(testConfigPath)
    
    assert.ok(result !== null)
    assert.deepStrictEqual(result?.models, ["minimax/*", "openrouter/*"])
    assert.strictEqual(result?.imageAnalysisTool, "mcp_custom_analyze_image")
    
    // Cleanup
    fs.unlinkSync(testConfigPath)
  })
})

describe("loadConfig", () => {
  it("returns default config when no config file exists", () => {
    const config = loadConfig()
    assert.ok(config)
  })
})

describe("DEFAULT_PROMPT_TEMPLATE", () => {
  it("contains all expected variables", () => {
    assert.ok(DEFAULT_PROMPT_TEMPLATE.includes("{imageCount}"))
    assert.ok(DEFAULT_PROMPT_TEMPLATE.includes("{imageList}"))
    assert.ok(DEFAULT_PROMPT_TEMPLATE.includes("{toolName}"))
    assert.ok(DEFAULT_PROMPT_TEMPLATE.includes("{userText}"))
  })
})
```

- [ ] **Step 6: Run comprehensive tests**

Run: `cd opencode-easy-vision && npm run build && npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: implement config loading"
```

---

## Task 5: Implement image saving

**Files:**
- Create: `opencode-easy-vision/src/imageSaver.ts`
- Test: `opencode-easy-vision/tests/imageSaver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/imageSaver.test.ts`:

```typescript
import { describe, it } from "node:test"
import assert from "node:assert/strict"

describe("imageSaver", () => {
  it("should be importable", async () => {
    const module = await import("../src/imageSaver.js")
    assert.ok(module)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd opencode-easy-vision && npm test`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `src/imageSaver.ts`:

```typescript
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { randomUUID } from "crypto"
import type { SavedImage } from "./types"

/**
 * Get the temporary directory for saving images.
 * Creates the directory if it doesn't exist.
 */
function getTempDir(): string {
  const tempDir = path.join(os.tmpdir(), "opencode-easy-vision")
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true }
  }
  return tempDir
}

/**
 * Map MIME types to file extensions.
 */
function mimeToExtension(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
  }
  return map[mime] || "png"
}

/**
 * Parse a data URL and extract the MIME type and base64 data.
 * 
 * Data URL format: data:[<mediatype>][;base64],<data>
 */
function parseDataUrl(dataUrl: string): { mime: string; data: Buffer } | null {
  const match = dataUrl.match(/^data:([^;]+)(;base64)?,(.*)$/)
  if (!match) {
    return null
  }

  const mime = match[1]
  const isBase64 = !!match[2]
  const encodedData = match[3]

  if (isBase64) {
    try {
      return {
        mime,
        data: Buffer.from(encodedData, "base64"),
      }
    } catch {
      return null
    }
  }

  return {
    mime,
    data: Buffer.from(decodeURIComponent(encodedData),
  }
}

/**
 * Save an image (from data URL) to a temporary file.
 * Returns the path to the saved file.
 */
export function saveImageFromDataUrl(dataUrl: string, partId?: string): SavedImage | null {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) {
    return null
  }

  const tempDir = getTempDir()
  const ext = mimeToExtension(parsed.mime)
  const filename = `${randomUUID()}.${ext}`
  const filePath = path.join(tempDir, filename)

  try {
    fs.writeFileSync(filePath, parsed.data)
    return {
      path: filePath,
      mime: parsed.mime,
      partId,
    }
  } catch (err) {
    console.warn(`[opencode-easy-vision] Failed to save image: ${err}`)
    return null
  }
}

/**
 * Clean up old temporary files (older than 1 hour).
 * Call this periodically to prevent disk bloat.
 */
export function cleanupOldImages(maxAgeMs: number = 60 * 60 * 1000): void {
  const tempDir = getTempDir()
  if (!fs.existsSync(tempDir)) {
    return
  }

  try {
    const files = fs.readdirSync(tempDir)
    const now = Date.now()

    for (const file of files) {
      const filePath = path.join(tempDir, file)
      try {
        const stats = fs.statSync(filePath)
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath)
        }
      } catch {
        // Skip files we can't stat/delete
      }
    }
  } catch {
    // Ignore errors during cleanup
  }
}

export { getTempDir, parseDataUrl, mimeToExtension }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd opencode-easy-vision && npm run build && npm test`
Expected: PASS

- [ ] **Step 5: Add more comprehensive tests**

Update `tests/imageSaver.test.ts`:

```typescript
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import {
  saveImageFromDataUrl,
  parseDataUrl,
  mimeToExtension,
  getTempDir,
  cleanupOldImages,
} from "../src/imageSaver.js"

describe("mimeToExtension", () => {
  it("maps common MIME types to extensions", () => {
    assert.strictEqual(mimeToExtension("image/png"), "png")
    assert.strictEqual(mimeToExtension("image/jpeg"), "jpg")
    assert.strictEqual(mimeToExtension("image/webp"), "webp")
    assert.strictEqual(mimeToExtension("image/unknown"), "png")
  })
})

describe("parseDataUrl", () => {
  it("parses base64 PNG data URL", () => {
    // A minimal valid PNG header in base64
    const base64Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const dataUrl = `data:image/png;base64,${base64Png}`
    
    const result = parseDataUrl(dataUrl)
    assert.ok(result !== null)
    assert.strictEqual(result?.mime, "image/png")
    assert.ok(result?.data.length > 0)
  })

  it("returns null for invalid data URL", () => {
    const result = parseDataUrl("not-a-data-url")
    assert.ok(result === null)
  })
})

describe("getTempDir", () => {
  it("returns a valid directory path", () => {
    const dir = getTempDir()
    assert.ok(dir.length > 0)
    assert.ok(fs.existsSync(dir))
  })
})

describe("saveImageFromDataUrl", () => {
  it("saves a PNG image to file", () => {
    const base64Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const dataUrl = `data:image/png;base64,${base64Png}`
    
    const result = saveImageFromDataUrl(dataUrl)
    assert.ok(result !== null)
    assert.ok(result?.path.endsWith(".png"))
    assert.ok(fs.existsSync(result?.path || ""))
    
    // Cleanup
    if (result?.path) {
      fs.unlinkSync(result.path)
    }
  })

  it("returns null for invalid data", () => {
    const result = saveImageFromDataUrl("invalid")
    assert.ok(result === null)
  })
})

describe("cleanupOldImages", () => {
  it("runs without errors", () => {
    // Just verify it doesn't throw
    cleanupOldImages()
    assert.ok(true)
  })
})
```

- [ ] **Step 6: Run comprehensive tests**

Run: `cd opencode-easy-vision && npm run build && npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/imageSaver.ts tests/imageSaver.test.ts
git commit -m "feat: implement image saving"
```

---

## Task 6: Implement prompt injector

**Files:**
- Create: `opencode-easy-vision/src/promptInjector.ts`
- Test: `opencode-easy-vision/tests/promptInjector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/promptInjector.test.ts`:

```typescript
import { describe, it } from "node:test"
import assert from "node:assert/strict"

describe("promptInjector", () => {
  it("should be importable", async () => {
    const module = await import("../src/promptInjector.js")
    assert.ok(module)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd opencode-easy-vision && npm test`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Create `src/promptInjector.ts`:

```typescript
import type { SavedImage, PluginConfig } from "./types"
import { DEFAULT_PROMPT_TEMPLATE } from "./config"

/**
 * Build the image list string from saved images.
 */
function buildImageList(images: SavedImage[]): string {
  return images
    .map((img, index) => `- Image ${index + 1}: ${img.path}`)
    .join("\n")
}

/**
 * Replace template variables in a prompt template.
 */
function replaceTemplateVariables(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value)
  }
  return result
}

/**
 * Build the injection prompt.
 * 
 * @param images - The saved images
 * @param toolName - The name of the vision MCP tool to use
 * @param userText - The user's original text (may be empty)
 * @param config - Plugin config (for custom template)
 */
export function buildInjectionPrompt(
  images: SavedImage[],
  toolName: string,
  userText: string,
  config?: PluginConfig,
): string {
  const template = config?.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE

  const variables: Record<string, string> = {
    imageCount: String(images.length),
    imageList: buildImageList(images),
    toolName,
    userText: userText || "(Please analyze these images)",
  }

  return replaceTemplateVariables(template, variables)
}

/**
 * Check if a Part represents an image attachment.
 * 
 * This is a heuristic - checks for common image-related types.
 * The actual part structure depends on what OpenCode provides.
 */
export function isImagePart(part: unknown): boolean {
  if (!part || typeof part !== "object") {
    return false
  }

  const p = part as Record<string, unknown>
  
  // Check for file part with image MIME type
  if (p.type === "file" && typeof p.mime === "string") {
    return p.mime.startsWith("image/")
  }

  // Check for data URL images
  if (p.type === "text" && typeof p.text === "string") {
    return p.text.startsWith("data:image/")
  }

  return false
}

/**
 * Extract image data from a part.
 */
export function extractImageData(part: unknown): string | null {
  if (!part || typeof part !== "object") {
    return null
  }

  const p = part as Record<string, unknown>
  
  // File part with URL
  if (p.type === "file" && typeof p.url === "string") {
    return p.url
  }

  // Text part with data URL
  if (p.type === "text" && typeof p.text === "string" && p.text.startsWith("data:image/")) {
    return p.text
  }

  return null
}

export { buildImageList, replaceTemplateVariables }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd opencode-easy-vision && npm run build && npm test`
Expected: PASS

- [ ] **Step 5: Add more comprehensive tests**

Update `tests/promptInjector.test.ts`:

```typescript
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildInjectionPrompt,
  buildImageList,
  replaceTemplateVariables,
  isImagePart,
  extractImageData,
} from "../src/promptInjector.js"
import type { SavedImage } from "../src/types.js"

describe("buildImageList", () => {
  it("builds formatted list from images", () => {
    const images: SavedImage[] = [
      { path: "/tmp/img1.png", mime: "image/png" },
      { path: "/tmp/img2.jpg", mime: "image/jpeg" },
    ]
    
    const result = buildImageList(images)
    
    assert.ok(result.includes("Image 1:"))
    assert.ok(result.includes("/tmp/img1.png"))
    assert.ok(result.includes("Image 2:"))
    assert.ok(result.includes("/tmp/img2.jpg"))
  })
})

describe("replaceTemplateVariables", () => {
  it("replaces all variables in template", () => {
    const template = "Count: {count}, List: {list}, Tool: {tool}"
    const result = replaceTemplateVariables(template, {
      count: "2",
      list: "- item1\n- item2",
      tool: "my_tool",
    })
    
    assert.ok(result.includes("Count: 2"))
    assert.ok(result.includes("List: - item1"))
    assert.ok(result.includes("Tool: my_tool"))
  })
})

describe("buildInjectionPrompt", () => {
  it("builds prompt with default template", () => {
    const images: SavedImage[] = [
      { path: "/tmp/test.png", mime: "image/png" },
    ]
    
    const result = buildInjectionPrompt(
      images,
      "mcp_test_analyze",
      "What is in this image?",
    )
    
    assert.ok(result.includes("1 image"))
    assert.ok(result.includes("/tmp/test.png"))
    assert.ok(result.includes("mcp_test_analyze"))
    assert.ok(result.includes("What is in this image?"))
  })

  it("uses default user text when empty", () => {
    const images: SavedImage[] = [
      { path: "/tmp/img.png", mime: "image/png" },
    ]
    
    const result = buildInjectionPrompt(images, "mcp_test_analyze", "")
    
    assert.ok(result.includes("analyze these images"))
  })

  it("uses custom template from config", () => {
    const images: SavedImage[] = [
      { path: "/tmp/img.png", mime: "image/png" },
    ]
    
    const config = {
      promptTemplate: "Custom: {toolName} - {imageCount}",
    }
    
    const result = buildInjectionPrompt(images, "my_tool", "question", config)
    
    assert.ok(result.includes("Custom: my_tool"))
    assert.ok(result.includes("1"))
  })
})

describe("isImagePart", () => {
  it("identifies file parts with image MIME types", () => {
    const pngPart = { type: "file", mime: "image/png" }
    const jpgPart = { type: "file", mime: "image/jpeg" }
    const textPart = { type: "text", text: "hello" }
    
    assert.ok(isImagePart(pngPart))
    assert.ok(isImagePart(jpgPart))
    assert.ok(!isImagePart(textPart))
  })

  it("returns false for invalid parts", () => {
    assert.ok(!isImagePart(null))
    assert.ok(!isImagePart(undefined))
    assert.ok(!isImagePart({}))
  })
})

describe("extractImageData", () => {
  it("extracts URL from file part", () => {
    const part = { type: "file", url: "file:///tmp/image.png" }
    const result = extractImageData(part)
    assert.strictEqual(result, "file:///tmp/image.png")
  })

  it("returns null for non-image parts", () => {
    const part = { type: "text", text: "not an image" }
    const result = extractImageData(part)
    assert.ok(result === null)
  })
})
```

- [ ] **Step 6: Run comprehensive tests**

Run: `cd opencode-easy-vision && npm run build && npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/promptInjector.ts tests/promptInjector.test.ts
git commit -m "feat: implement prompt injection"
```

---

## Task 7: Create main plugin entry point

**Files:**
- Create: `opencode-easy-vision/src/index.ts`

- [ ] **Step 1: Write the main plugin entry**

Create `src/index.ts`:

```typescript
import type { Plugin, Hooks } from "@opencode-ai/plugin"
import type { PluginConfig, SavedImage } from "./types"
import { loadConfig, DEFAULT_PROMPT_TEMPLATE } from "./config"
import { shouldActivate } from "./modelDetector"
import { saveImageFromDataUrl, cleanupOldImages } from "./imageSaver"
import {
  buildInjectionPrompt,
  isImagePart,
  extractImageData,
} from "./promptInjector"

let config: PluginConfig | undefined

/**
 * The main plugin function.
 */
const plugin: Plugin = async (input) => {
  // Load config on first use
  if (!config) {
    config = loadConfig()
  }

  // Clean up old images periodically
  try {
    cleanupOldImages()
  } catch {
    // Ignore cleanup errors
  }

  return {
    "chat.message": async (input, output) => {
      const model = input.model
      if (!model) {
        // No model info available - can't determine if we should activate
        return
      }

      // Check if we should activate for this model
      if (!shouldActivate(model.providerID, model.modelID, config)) {
        return
      }

      // Find image parts in the message
      const imageParts: Array<{ part: unknown; partId?: string }> = []
      
      // Look through output.parts
      for (let i = 0; i < output.parts.length; i++) {
        const part = output.parts[i]
        if (isImagePart(part)) {
          imageParts.push({ part, partId: (part as { partId?: string }?.partId })
        }
      }

      if (imageParts.length === 0) {
        // No images found - nothing to do
        return
      }

      // Get the configured tool name
      const toolName = config?.imageAnalysisTool
      if (!toolName) {
        console.warn(
          "[opencode-easy-vision] Warning: No imageAnalysisTool not configured. " +
          "Please set imageAnalysisTool in your opencode-easy-vision.json"
        )
        return
      }

      // Save images to temp files
      const savedImages: SavedImage[] = []
      const textParts: string[] = []

      for (const { part, partId } of imageParts) {
        const imageData = extractImageData(part)
        if (imageData) {
          // Try to save as data URL first
          if (imageData.startsWith("data:")) {
            const saved = saveImageFromDataUrl(imageData, partId)
            if (saved) {
              savedImages.push(saved)
            }
          } else {
            // It's a URL - use directly
            savedImages.push({
              path: imageData,
              mime: "image/unknown",
              partId,
            })
          }
        }
      }

      if (savedImages.length === 0) {
        return
      }

      // Extract user text from non-image parts
      for (const part of output.parts) {
        if (
          part && 
          typeof part === "object" &&
          (part as { type?: string }).type === "text" &&
          typeof (part as { text?: string }).text === "string"
        ) {
          const text = (part as { text: string }).text
          // Skip data URLs
          if (!text.startsWith("data:")) {
            textParts.push(text)
          }
        }
      }

      const userText = textParts.join("\n\n")

      // Build the injection prompt
      const injectionPrompt = buildInjectionPrompt(
        savedImages,
        toolName,
        userText,
        config,
      )

      // Replace the parts with our injected prompt
      // We'll replace all parts with a single text part containing our prompt
      output.parts = [
        {
          type: "text" as const,
          text: injectionPrompt,
        },
      ]

      // Also update the message text if possible
      if (output.message && typeof output.message === "object") {
        ;(output.message as Record<string, unknown>).text = injectionPrompt
      }

      console.log(
        `[opencode-easy-vision] Injected vision prompt for ${savedImages.length} image(s)
      )
    },
  } as Partial<Hooks>
}

export default plugin
```

- [ ] **Step 2: Update package.json main field**

Verify package.json has correct main:

```json
{
  "main": "dist/index.js",
  "types": "dist/index.d.ts"
}
```

- [ ] **Step 3: Build and test**

Run: `cd opencode-easy-vision && npm run build && npm test`
Expected: Build succeeds, tests pass

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add main plugin entry point"
```

---

## Task 8: Add README documentation

**Files:**
- Create: `opencode-easy-vision/README.md`

- [ ] **Step 1: Create README.md**

```markdown
# opencode-easy-vision

OpenCode plugin that enables vision support for models lacking native vision capability.

## What it does

This plugin intercepts images pasted into OpenCode chat and automatically:

1. **Detects** if the current model has native vision capabilities
2. **Saves** pasted images to temporary files
3. **Injects** a prompt telling the model to use your configured vision MCP tool
4. **Routes** the image analysis through the MCP server instead of the model's native vision

## Installation

### Via npm

```bash
npm install opencode-easy-vision
```

### Via OpenCode CLI

```bash
opencode plugin opencode-easy-vision --global
```

### Manual

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-easy-vision"]
}
```

## Configuration

Create a config file at one of these locations:

- **Project-level**: `.opencode/opencode-easy-vision.json`
- **User-level**: `~/.config/opencode/opencode-easy-vision.json`

### Example Configuration

```json
{
  "models": ["minimax/*", "openrouter/*"],
  "imageAnalysisTool": "mcp_minimax_understand_image",
  "promptTemplate": "I'm attaching {imageCount} image(s).\n\nImages:\n{imageList}\n\nUse the `{toolName}` tool.\n\nMy question: {userText}"
}
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `models` | `string[]` | Model patterns to activate for. Default: all non-vision models |
| `excludeModels` | `string[]` | Model patterns to EXCLUDE (vision models). Default: common vision models |
| `imageAnalysisTool` | `string` | **Required**. Name of the MCP tool to use for image analysis |
| `promptTemplate` | `string` | Custom prompt template. See variables below. |

### Prompt Template Variables

| Variable | Description |
|----------|-------------|
| `{imageCount}` | Number of images |
| `{imageList}` | Newline-separated list of image paths |
| `{toolName}` | The configured image analysis tool name |
| `{userText}` | The user's original message text |

## Example: Using with MiniMax Coding Plan MCP

1. **Configure the MCP server in `opencode.json`:

```json
{
  "mcp": {
    "MiniMax": {
      "type": "local",
      "command": ["uvx", "minimax-coding-plan-mcp"],
      "environment": {
        "MINIMAX_API_KEY": "your-api-key-here",
        "MINIMAX_API_HOST": "https://api.minimax.io"
      }
    }
  }
}
```

2. **Configure the plugin**:

```json
{
  "models": ["minimax/*"],
  "imageAnalysisTool": "mcp_minimax_understand_image"
}
```

3. **Use it**:
   - Select a MiniMax model in OpenCode
   - Paste an image (`Cmd+V` / `Ctrl+V`)
   - Ask your question

## Example: Using with OpenRouter Image MCP

1. **Configure the MCP server**:

```json
{
  "mcp": {
    "openrouter_image": {
      "type": "local",
      "command": ["npx", "openrouter-image-mcp"],
      "environment": {
        "OPENROUTER_API_KEY": "your-api-key-here",
        "OPENROUTER_MODEL": "nvidia/nemotron-nano-12b-v2-vl:free"
      }
    }
  }
}
```

2. **Configure the plugin**:

```json
{
  "models": ["*"],
  "imageAnalysisTool": "mcp_openrouter_image_analyze_image"
}
```

## Default Vision Models

These models are automatically excluded (they have native vision):

- `anthropic/*-vision-*`
- `anthropic/*sonnet*`
- `anthropic/*opus*`
- `openai/gpt-4o*`
- `openai/gpt-4-vision*`
- `google/gemini-*`
- `*/*-vl-*`
- `*/*vision*`

Add your own patterns using `excludeModels`.

## How It Works

```
User pastes image + question
        ↓
Plugin checks model has native vision?
        ↓
    ┌───┴───┐
    │         │
   YES        NO
    │         │
[pass through  [save images]
    │         │
    │    [inject prompt]
    │         │
    │    [use MCP tool]
    │         │
    └───┬───┘
        ↓
   Model responds
```

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Task 9: Final verification

**Files:**
- All files

- [ ] **Step 1: Run full test suite**

Run: `cd opencode-easy-vision && npm run build && npm test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `cd opencode-easy-vision && npm run lint`
Expected: No TypeScript errors

- [ ] **Step 3: Verify package.json is complete**

Check package.json has:
- [ ] `name`
- [ ] `version`
- [ ] `description`
- [ ] `main`
- [ ] `types`
- [ ] `scripts`
- [ ] `dependencies`
- [ ] `devDependencies`
- [ ] `keywords`

---

## Integration with OpenCode

### Installing the plugin in OpenCode:

1. **Install the package**:

```bash
npm install opencode-easy-vision
```

2. **Add to your `opencode.json`**:

```json
{
  "plugin": ["opencode-easy-vision"]
}
```

3. **Configure the vision MCP server and plugin**:

See Configuration section above.

---

## Self-Review

**1. Spec coverage:**
- [x] Model detection with pattern matching
- [x] Config loading from multiple locations
- [x] Image saving with temp file management
- [x] Prompt injection with template variables
- [x] Main plugin entry with chat.message hook
- [x] Comprehensive documentation

**2. Placeholder scan:**
- No TODOs or placeholders

**3. Type consistency:**
- All types defined in types.ts
- Consistent usage across files

**Plan complete. Ready for execution.**
