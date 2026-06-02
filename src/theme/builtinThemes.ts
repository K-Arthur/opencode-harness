/**
 * Bundled OpenCode built-in theme palettes.
 *
 * OpenCode's built-in themes (tokyonight, catppuccin, gruvbox, …) are compiled
 * into the CLI binary — they are NOT JSON files on disk. That means a user
 * whose `opencode.json` says `"theme": "tokyonight"` had no theme file for the
 * extension to read, so the chat panel never matched the CLI. We ship a curated
 * set of those palettes here so they resolve by name and appear in the picker.
 *
 * Each entry uses OpenCode's **compact** theme schema
 * (`{ palette, overrides }`) which `ThemeManager.applyThemeContent` already
 * understands: the small core palette is auto-expanded into the full webview
 * token set (markdown / syntax / diff / gutters) via `deriveExtendedTheme`
 * using `color-mix`. This keeps each theme to ~10 authored colours while still
 * driving the extension's wider colour range.
 *
 * Pure data module — no VS Code / Node dependencies — unit-testable in isolation.
 *
 * On-disk theme files (`~/.config/opencode/themes/*.json`,
 * `<workspace>/.opencode/themes/*.json`) always take precedence over a bundled
 * entry of the same name, so users can override or extend any of these.
 */

export interface BuiltinPalette {
  /** Base/background neutral. */
  neutral: string
  /** Primary foreground / ink. */
  ink: string
  primary: string
  accent: string
  success: string
  warning: string
  error: string
  info: string
  diffAdd: string
  diffDelete: string
}

export interface BuiltinSyntaxOverrides {
  "syntax-comment"?: string
  "syntax-keyword"?: string
  "syntax-string"?: string
  "syntax-primitive"?: string
  "syntax-property"?: string
  "syntax-constant"?: string
}

export interface BuiltinThemeContent {
  palette: BuiltinPalette
  overrides?: BuiltinSyntaxOverrides
}

/**
 * Shape mirrors an on-disk OpenCode theme file's parsed root (`{ theme }`),
 * so `applyThemeContent(overrides, entry.theme)` can consume it directly.
 */
export interface BuiltinThemeFile {
  theme: BuiltinThemeContent
}

export const BUILTIN_THEMES: Readonly<Record<string, BuiltinThemeFile>> = {
  tokyonight: {
    theme: {
      palette: {
        neutral: "#1a1b26", ink: "#c0caf5", primary: "#7aa2f7", accent: "#bb9af7",
        success: "#9ece6a", warning: "#e0af68", error: "#f7768e", info: "#7dcfff",
        diffAdd: "#9ece6a", diffDelete: "#f7768e",
      },
      overrides: {
        "syntax-comment": "#565f89", "syntax-keyword": "#bb9af7", "syntax-string": "#9ece6a",
        "syntax-primitive": "#ff9e64", "syntax-property": "#7aa2f7", "syntax-constant": "#ff9e64",
      },
    },
  },
  catppuccin: {
    theme: {
      palette: {
        neutral: "#1e1e2e", ink: "#cdd6f4", primary: "#89b4fa", accent: "#cba6f7",
        success: "#a6e3a1", warning: "#f9e2af", error: "#f38ba8", info: "#89dceb",
        diffAdd: "#a6e3a1", diffDelete: "#f38ba8",
      },
      overrides: {
        "syntax-comment": "#9399b2", "syntax-keyword": "#cba6f7", "syntax-string": "#a6e3a1",
        "syntax-primitive": "#fab387", "syntax-property": "#89b4fa", "syntax-constant": "#fab387",
      },
    },
  },
  "gruvbox-dark": {
    theme: {
      palette: {
        neutral: "#282828", ink: "#ebdbb2", primary: "#83a598", accent: "#d3869b",
        success: "#b8bb26", warning: "#fabd2f", error: "#fb4934", info: "#8ec07c",
        diffAdd: "#b8bb26", diffDelete: "#fb4934",
      },
      overrides: {
        "syntax-comment": "#a89984", "syntax-keyword": "#fb4934", "syntax-string": "#b8bb26",
        "syntax-primitive": "#d3869b", "syntax-property": "#83a598", "syntax-constant": "#d3869b",
      },
    },
  },
  nord: {
    theme: {
      palette: {
        neutral: "#2e3440", ink: "#d8dee9", primary: "#88c0d0", accent: "#b48ead",
        success: "#a3be8c", warning: "#ebcb8b", error: "#bf616a", info: "#81a1c1",
        diffAdd: "#a3be8c", diffDelete: "#bf616a",
      },
      overrides: {
        "syntax-comment": "#7b88a1", "syntax-keyword": "#81a1c1", "syntax-string": "#a3be8c",
        "syntax-primitive": "#b48ead", "syntax-property": "#88c0d0", "syntax-constant": "#d08770",
      },
    },
  },
  "everforest-dark": {
    theme: {
      palette: {
        neutral: "#2d353b", ink: "#d3c6aa", primary: "#a7c080", accent: "#d699b6",
        success: "#a7c080", warning: "#dbbc7f", error: "#e67e80", info: "#7fbbb3",
        diffAdd: "#a7c080", diffDelete: "#e67e80",
      },
      overrides: {
        "syntax-comment": "#9da9a0", "syntax-keyword": "#e67e80", "syntax-string": "#a7c080",
        "syntax-primitive": "#d699b6", "syntax-property": "#7fbbb3", "syntax-constant": "#d699b6",
      },
    },
  },
  onedark: {
    theme: {
      palette: {
        neutral: "#282c34", ink: "#abb2bf", primary: "#61afef", accent: "#c678dd",
        success: "#98c379", warning: "#e5c07b", error: "#e06c75", info: "#56b6c2",
        diffAdd: "#98c379", diffDelete: "#e06c75",
      },
      overrides: {
        "syntax-comment": "#7f848e", "syntax-keyword": "#c678dd", "syntax-string": "#98c379",
        "syntax-primitive": "#d19a66", "syntax-property": "#61afef", "syntax-constant": "#d19a66",
      },
    },
  },
  dracula: {
    theme: {
      palette: {
        neutral: "#282a36", ink: "#f8f8f2", primary: "#bd93f9", accent: "#ff79c6",
        success: "#50fa7b", warning: "#f1fa8c", error: "#ff5555", info: "#8be9fd",
        diffAdd: "#50fa7b", diffDelete: "#ff5555",
      },
      overrides: {
        "syntax-comment": "#8995c4", "syntax-keyword": "#ff79c6", "syntax-string": "#f1fa8c",
        "syntax-primitive": "#bd93f9", "syntax-property": "#50fa7b", "syntax-constant": "#bd93f9",
      },
    },
  },
  "rose-pine": {
    theme: {
      palette: {
        neutral: "#191724", ink: "#e0def4", primary: "#c4a7e7", accent: "#ebbcba",
        success: "#9ccfd8", warning: "#f6c177", error: "#eb6f92", info: "#31748f",
        diffAdd: "#9ccfd8", diffDelete: "#eb6f92",
      },
      overrides: {
        "syntax-comment": "#908caa", "syntax-keyword": "#31748f", "syntax-string": "#f6c177",
        "syntax-primitive": "#ebbcba", "syntax-property": "#c4a7e7", "syntax-constant": "#ebbcba",
      },
    },
  },
  kanagawa: {
    theme: {
      palette: {
        neutral: "#1f1f28", ink: "#dcd7ba", primary: "#7e9cd8", accent: "#957fb8",
        success: "#76946a", warning: "#c0a36e", error: "#c34043", info: "#6a9589",
        diffAdd: "#76946a", diffDelete: "#c34043",
      },
      overrides: {
        "syntax-comment": "#9a9a8a", "syntax-keyword": "#957fb8", "syntax-string": "#98bb6c",
        "syntax-primitive": "#ffa066", "syntax-property": "#7e9cd8", "syntax-constant": "#ffa066",
      },
    },
  },
  "ayu-dark": {
    theme: {
      palette: {
        neutral: "#0b0e14", ink: "#bfbdb6", primary: "#59c2ff", accent: "#ffb454",
        success: "#aad94c", warning: "#ffb454", error: "#f26d78", info: "#39bae6",
        diffAdd: "#aad94c", diffDelete: "#f26d78",
      },
      overrides: {
        "syntax-comment": "#828a99", "syntax-keyword": "#ff8f40", "syntax-string": "#aad94c",
        "syntax-primitive": "#d2a6ff", "syntax-property": "#59c2ff", "syntax-constant": "#d2a6ff",
      },
    },
  },
}

/** Theme names we ship a palette for. */
export function builtinThemeNames(): string[] {
  return Object.keys(BUILTIN_THEMES)
}

/** Look up a bundled theme by name (exact match). */
export function getBuiltinTheme(name: string): BuiltinThemeFile | undefined {
  return Object.prototype.hasOwnProperty.call(BUILTIN_THEMES, name) ? BUILTIN_THEMES[name] : undefined
}
