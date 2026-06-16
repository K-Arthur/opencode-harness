declare global {
  interface Window {
    __OC_MERMAID_URI__?: string
    __OC_KATEX_URI__?: string
  }
}

interface MermaidAPI {
  render(id: string, text: string): Promise<{ svg: string }>
}

interface KatexAPI {
  renderToString(tex: string, options?: { throwOnError?: boolean; displayMode?: boolean }): string
}

let mermaidLoadState: "idle" | "loading" | "loaded" | "error" = "idle"
let mermaidLoadPromise: Promise<MermaidAPI> | undefined

let katexLoadState: "idle" | "loading" | "loaded" | "error" = "idle"
let katexLoadPromise: Promise<KatexAPI> | undefined

export const MERMAID_TIMEOUT_MS = 8_000

export function loadMermaid(): Promise<MermaidAPI> {
  if (mermaidLoadState === "loaded") {
    return Promise.resolve((window as any).__OC_MERMAID__ as MermaidAPI)
  }
  if (mermaidLoadState === "loading" && mermaidLoadPromise) {
    return mermaidLoadPromise
  }

  const uri = window.__OC_MERMAID_URI__
  if (!uri) {
    mermaidLoadState = "error"
    return Promise.reject(new Error("Mermaid vendor URI not available"))
  }

  mermaidLoadState = "loading"
  mermaidLoadPromise = new Promise<MermaidAPI>((resolve, reject) => {
    const timer = setTimeout(() => {
      mermaidLoadState = "error"
      reject(new Error("Mermaid load timed out"))
    }, MERMAID_TIMEOUT_MS)

    const script = document.createElement("script")
    script.src = uri
    script.onload = () => {
      clearTimeout(timer)
      mermaidLoadState = "loaded"
      resolve((window as any).__OC_MERMAID__ as MermaidAPI)
    }
    script.onerror = () => {
      clearTimeout(timer)
      mermaidLoadState = "error"
      reject(new Error("Failed to load mermaid vendor script"))
    }
    document.head.appendChild(script)
  })

  return mermaidLoadPromise
}

export function loadKatex(): Promise<KatexAPI> {
  if (katexLoadState === "loaded") {
    return Promise.resolve((window as any).__OC_KATEX__ as KatexAPI)
  }
  if (katexLoadState === "loading" && katexLoadPromise) {
    return katexLoadPromise
  }

  const uri = window.__OC_KATEX_URI__
  if (!uri) {
    katexLoadState = "error"
    return Promise.reject(new Error("KaTeX vendor URI not available"))
  }

  katexLoadState = "loading"
  katexLoadPromise = new Promise<KatexAPI>((resolve, reject) => {
    const timer = setTimeout(() => {
      katexLoadState = "error"
      reject(new Error("KaTeX load timed out"))
    }, MERMAID_TIMEOUT_MS)

    const script = document.createElement("script")
    script.src = uri
    script.onload = () => {
      clearTimeout(timer)
      katexLoadState = "loaded"
      resolve((window as any).__OC_KATEX__ as KatexAPI)
    }
    script.onerror = () => {
      clearTimeout(timer)
      katexLoadState = "error"
      reject(new Error("Failed to load katex vendor script"))
    }
    document.head.appendChild(script)
  })

  return katexLoadPromise
}
