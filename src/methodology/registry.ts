import type { MethodologyOrchestrator } from "./MethodologyOrchestrator"

/**
 * What the status bar renders after each send. Derived from the SAME
 * MethodologyAdvice that was injected into the prompt — the status bar must
 * never run its own classification pass, or it can disagree with the
 * addendum the model actually received.
 */
export interface MethodologyStatusInfo {
  /** Human-readable methodology label (e.g. "Spec-first"). */
  label: string
  methodology: string
  strategy: string
  recommendedTier: string
  /** 0..1 */
  confidence: number
  taskType: string
}

let methodologyOrchestrator: MethodologyOrchestrator | undefined
let statusUpdater: ((info: MethodologyStatusInfo) => void) | undefined

export function getMethodologyOrchestrator(): MethodologyOrchestrator | undefined {
  return methodologyOrchestrator
}

export function setMethodologyOrchestrator(orchestrator: MethodologyOrchestrator | undefined): void {
  methodologyOrchestrator = orchestrator
}

export function updateMethodologyStatus(info: MethodologyStatusInfo): void {
  if (statusUpdater) statusUpdater(info)
}

export function setMethodologyStatusUpdater(updater: ((info: MethodologyStatusInfo) => void) | undefined): void {
  statusUpdater = updater
}
