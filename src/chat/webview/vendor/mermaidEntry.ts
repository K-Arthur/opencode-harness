import mermaid from "mermaid"

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
})

;(window as any).__OC_MERMAID__ = mermaid
