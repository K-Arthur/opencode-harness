import { readFileSync, statSync, readdirSync } from "node:fs"
import { resolve, dirname, relative, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseJsonc } from "jsonc-parser"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

// Parse JSONC (comments + trailing commas) via jsonc-parser
function readJSONC(path) {
  const raw = readFileSync(path, "utf8")
  const errors = []
  const parsed = parseJsonc(raw, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0) {
    throw new Error(`JSONC parse errors in ${path}: ${errors.length} error(s)`)
  }
  return parsed
}

function normalizePath(p) {
  return p.replace(/\\/g, "/")
}

// Simple glob implementation for Node.js 20 compatibility
function* globSync(pattern, options = {}) {
  const ignore = options.ignore || []
  const ignorePatterns = ignore.map(p => {
    const regex = p
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
    return new RegExp(regex)
  })

  const baseDir = resolve(root, pattern.split('/')[0] || '.')
  const patternParts = pattern.split('/')

  function* walk(dir, remainingParts) {
    if (remainingParts.length === 0) {
      yield dir
      return
    }

    const part = remainingParts[0]
    const rest = remainingParts.slice(1)

    if (part === '**') {
      // Recursively walk all subdirectories
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name)
        const relPath = relative(root, fullPath)

        // Check if ignored
        if (ignorePatterns.some(regex => regex.test(relPath))) {
          continue
        }

        if (entry.isDirectory()) {
          yield* walk(fullPath, remainingParts)
          yield* walk(fullPath, rest)
        } else if (rest.length === 0) {
          yield fullPath
        }
      }
    } else if (part.includes('*') || part.includes('?')) {
      // Pattern matching
      const regex = new RegExp(
        '^' + part.replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$'
      )
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (regex.test(entry.name)) {
          const fullPath = join(dir, entry.name)
          const relPath = relative(root, fullPath)

          if (ignorePatterns.some(regex => regex.test(relPath))) {
            continue
          }

          if (entry.isDirectory() && rest.length > 0) {
            yield* walk(fullPath, rest)
          } else if (rest.length === 0) {
            yield fullPath
          }
        }
      }
    } else {
      // Exact match
      const fullPath = join(dir, part)
      try {
        const stat = statSync(fullPath)
        const relPath = relative(root, fullPath)

        if (ignorePatterns.some(regex => regex.test(relPath))) {
          return
        }

        if (stat.isDirectory() && rest.length > 0) {
          yield* walk(fullPath, rest)
        } else if (rest.length === 0) {
          yield fullPath
        }
      } catch {
        // File doesn't exist, skip
      }
    }
  }

  yield* walk(baseDir, patternParts.slice(1))
}

function matchGlob(file, pattern) {
  const parts = pattern.split("/")
  const fileParts = normalizePath(file).split("/")
  let pi = 0, fi = 0
  while (pi < parts.length && fi < fileParts.length) {
    if (parts[pi] === "**") {
      if (pi === parts.length - 1) return true
      pi++
      while (fi < fileParts.length && fileParts[fi] !== parts[pi]) fi++
      if (fi >= fileParts.length) return false
    } else if (parts[pi] !== fileParts[fi]) {
      return false
    }
    pi++
    fi++
  }
  return pi === parts.length && fi === fileParts.length
}

function parseImports(source) {
  const imports = []
  const regex = /from\s+["']([^"']+)["']/g
  let match
  while ((match = regex.exec(source)) !== null) {
    imports.push(match[1])
  }
  return imports
}

async function main() {
  try {
    const config = readJSONC(resolve(root, ".jcodemunch.jsonc"))
    const layers = config.architecture.layers
    const violations = []

    // Build a map from layer name to paths
    const layerPaths = {}
    for (const layer of layers) {
      layerPaths[layer.name] = layer.paths
    }

    // For each layer, check files for forbidden imports
    for (const layer of layers) {
      const files = []
      for (const pattern of layer.paths) {
        try {
          for (const file of globSync(pattern, { ignore: ["**/node_modules/**", "**/dist/**"] })) {
            try {
              if (statSync(file).isFile()) {
                files.push(file)
              }
            } catch (e) {
              console.error(`Warning: Could not read file ${file}: ${e.message}`)
            }
          }
        } catch (e) {
          console.error(`Warning: Could not glob pattern ${pattern}: ${e.message}`)
        }
      }

      for (const file of files) {
        try {
          const source = readFileSync(file, "utf8")
          const imports = parseImports(source)

          for (const imp of imports) {
            // Convert relative import to file path
            if (!imp.startsWith(".")) continue
            const impFile = resolve(dirname(file), imp)
            const relImp = normalizePath(relative(root, impFile))

            // Check if this import violates any may_not_import rule
            for (const forbidden of layer.may_not_import) {
              const forbiddenPaths = layerPaths[forbidden]
              if (!forbiddenPaths) continue
              for (const fp of forbiddenPaths) {
                if (matchGlob(relImp, fp)) {
                  const relFile = normalizePath(relative(root, file))
                  violations.push(`${relFile} imports ${relImp} which is in forbidden layer "${forbidden}"`)
                }
              }
            }
          }
        } catch (e) {
          console.error(`Warning: Could not process file ${file}: ${e.message}`)
        }
      }
    }

    if (violations.length > 0) {
      console.error("Architecture layer violations found:")
      for (const v of violations) {
        console.error(`  ❌ ${v}`)
      }
      process.exit(1)
    }

    console.log("✅ Architecture layer rules passed — no violations found")
  } catch (e) {
    console.error(`Error running architecture check: ${e.message}`)
    console.error(e.stack)
    process.exit(1)
  }
}

main()
