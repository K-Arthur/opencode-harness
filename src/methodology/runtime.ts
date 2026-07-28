import * as vscode from "vscode"
import type { AdvisoryOrchestrationResult, MethodologyOrchestrator } from "./MethodologyOrchestrator"
import type { OutcomeTracker } from "./OutcomeTracker"

let methodologyOrchestrator: MethodologyOrchestrator | undefined
let outcomeTracker: OutcomeTracker | undefined
let methodologyStatusItem: vscode.StatusBarItem | undefined

export function setMethodologyRuntime(runtime: {
  orchestrator?: MethodologyOrchestrator
  outcomeTracker?: OutcomeTracker
  statusItem?: vscode.StatusBarItem
}): void {
  methodologyOrchestrator = runtime.orchestrator
  outcomeTracker = runtime.outcomeTracker
  methodologyStatusItem = runtime.statusItem
}

export function updateMethodologyStatus(result: AdvisoryOrchestrationResult): void {
  if (!methodologyStatusItem) return
  const conf = result.methodology.confidence
  const label = `${result.methodology.methodology}`
  const tier = result.advisory.recommendedTier
  methodologyStatusItem.text = `$(lightbulb) ${label} · ${tier}`
  const confPct = (conf * 100).toFixed(0)
  methodologyStatusItem.tooltip = `Methodology: ${label}\nConfidence: ${confPct}%\nRecommended tier: ${tier}\n${result.advisory.reasoning}\n\nClick to configure`
}

export function getMethodologyOrchestrator(): MethodologyOrchestrator | undefined {
  return methodologyOrchestrator
}

export function getOutcomeTracker(): OutcomeTracker | undefined {
  return outcomeTracker
}
