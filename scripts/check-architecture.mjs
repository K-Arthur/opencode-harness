import { readFileSync, statSync } from "node:fs"
import { glob } from "node:fs/promises"
import { resolve, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

// Parse JSONC (strip comments)
function readJSONC(path) {
  const raw = readFileSync(path, "utf8")
  const cleaned = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
  return JSON.parse(cleaned)
}

function normalizePath(p) {
  return p.replace(/\\/g, "/")
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
        const fullPattern = resolve(root, pattern)
        for await (const file of glob(fullPattern, { ignore: ["**/node_modules/**", "**/dist/**"] })) {
          try {
            if (statSync(file).isFile()) {
              files.push(file)
            }
          } catch (e) {
            console.error(`Warning: Could not read file ${file}: ${e.message}`)
          }
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
