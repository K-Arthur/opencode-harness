import type { AdvisoryOrchestrationResult } from "./MethodologyOrchestrator"
import type { MethodologyOrchestrator } from "./MethodologyOrchestrator"

let methodologyOrchestrator: MethodologyOrchestrator | undefined
let statusUpdater: ((result: AdvisoryOrchestrationResult) => void) | undefined

export function getMethodologyOrchestrator(): MethodologyOrchestrator | undefined {
  return methodologyOrchestrator
}

export function setMethodologyOrchestrator(orchestrator: MethodologyOrchestrator | undefined): void {
  methodologyOrchestrator = orchestrator
}

export function updateMethodologyStatus(result: AdvisoryOrchestrationResult): void {
  if (statusUpdater) statusUpdater(result)
}

export function setMethodologyStatusUpdater(updater: ((result: AdvisoryOrchestrationResult) => void) | undefined): void {
  statusUpdater = updater
}
