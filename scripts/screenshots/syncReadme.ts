/**
 * Regenerates the README screenshot embed block from the catalog.
 *
 * Run: npx tsx scripts/screenshots/syncReadme.ts
 */
import * as fs from "fs"
import * as path from "path"
import { catalog } from "../../tests/visual/screenshots/catalog"

const ROOT = path.resolve(__dirname, "../..")
const README_PATH = path.join(ROOT, "README.md")

const START_MARKER = "<!-- SCREENSHOTS:START -->"
const END_MARKER = "<!-- SCREENSHOTS:END -->"

function generateScreenshotBlock(): string {
  const lines: string[] = [START_MARKER, ""]

  // Hero shot (first entry) — full width
  const hero = catalog[0]
  lines.push(`<p align="center">`)
  lines.push(`  <img src="media/screenshots/dark/${hero.name}.png" alt="${hero.caption}" width="100%">`)
  lines.push(`</p>`)
  lines.push("")

  // Remaining shots — 2-column grid
  const rest = catalog.slice(1)
  lines.push(`<table>`)
  for (let i = 0; i < rest.length; i += 2) {
    lines.push(`<tr>`)
    const left = rest[i]
    lines.push(`  <td align="center" width="50%">`)
    lines.push(`    <img src="media/screenshots/dark/${left.name}.png" alt="${left.caption}" width="100%">`)
    lines.push(`    <br><strong>${left.caption}</strong>`)
    lines.push(`  </td>`)
    if (i + 1 < rest.length) {
      const right = rest[i + 1]
      lines.push(`  <td align="center" width="50%">`)
      lines.push(`    <img src="media/screenshots/dark/${right.name}.png" alt="${right.caption}" width="100%">`)
      lines.push(`    <br><strong>${right.caption}</strong>`)
      lines.push(`  </td>`)
    }
    lines.push(`</tr>`)
  }
  lines.push(`</table>`)
  lines.push("")
  lines.push(END_MARKER)

  return lines.join("\n")
}

function syncReadme(): void {
  const readme = fs.readFileSync(README_PATH, "utf-8")

  if (!readme.includes(START_MARKER)) {
    console.warn(
      `README.md does not contain ${START_MARKER}. Add the markers where you want screenshots to appear:\n` +
      `  ${START_MARKER}\n  ${END_MARKER}\n`
    )
    process.exit(1)
  }

  const startIdx = readme.indexOf(START_MARKER)
  const endIdx = readme.indexOf(END_MARKER)
  if (endIdx < 0) {
    console.error(`${END_MARKER} not found in README.md`)
    process.exit(1)
  }

  const before = readme.slice(0, startIdx)
  const after = readme.slice(endIdx + END_MARKER.length)
  const block = generateScreenshotBlock()

  const updated = before + block + after
  fs.writeFileSync(README_PATH, updated, "utf-8")
  console.log(`README.md updated with ${catalog.length} screenshot references.`)
}

syncReadme()
