/**
 * Shared utilities for screenshot test specs.
 */
import * as fs from "fs"
import * as path from "path"

const FIXTURES_DIR = path.resolve(__dirname, "fixtures/sessions")

/**
 * Load a fixture JSON from the fixtures directory.
 */
export function loadFixture(name: string): Record<string, unknown> {
  const filePath = path.join(FIXTURES_DIR, name)
  return JSON.parse(fs.readFileSync(filePath, "utf-8"))
}
