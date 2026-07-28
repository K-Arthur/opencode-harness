<!-- Auto-generated from architecture spec -->
# Flow: Orchestrated Pipeline (send_prompt to pipeline_progress)

```mermaid
flowchart TD
    Start([User sends prompt in Orchestrated mode])

    Start --> Classify[Webview computes AttachmentSummary]
    Classify --> Send[webview postMessage: send_prompt<br/>with attachments + attachmentSummary]

    Send --> Router[WebviewEventRouter.normalizeAttachmentSummary]
    Router --> Queue{Tab busy or streaming?}
    Queue -->|Yes| HostQueue[HostPromptQueue.enqueue<br/>with attachmentSummary]
    Queue -->|No| StartPrompt[StreamCoordinator.startPrompt]
    HostQueue --> Drain[Drain queue]
    Drain --> StartPrompt

    StartPrompt --> Select[selectWorkflow(text, AttachmentSummary)]
    Select --> Workflow[WorkflowDefinition<br/>Standard / Quick / Debug / Review / Multimodal]

    Workflow --> Run[OrchestrationCoordinator.runPipeline]
    Run --> InitMachine[WorkflowStateMachine<br/>revision = 0]
    InitMachine --> StageLoop[For each stage in workflow]

    StageLoop --> RoleModel[resolveRoutedModel(role, orchestrated, tab.model)]
    RoleModel --> Dispatch[enhancedStageDispatcher.executePrompt<br/>with model override + AbortSignal]
    Dispatch --> SendPrompt[SessionManager.sendPrompt<br/>with model/agent + parts]
    SendPrompt --> Handoff[Validate stage output<br/>typed StageHandoff]
    Handoff --> Update[WorkflowStateMachine.transitionStage<br/>revision++]
    Update --> PostProgress[pipeline_progress message<br/>with runId + revision]
    PostProgress --> Webview[Webview stores pipeline state<br/>per SessionState.pipeline]
    Webview --> Render[renderPipelineProgress]

    Update --> Next{More stages?}
    Next -->|Yes| StageLoop
    Next -->|No| Synthesize[Synthesis stage]
    Synthesize --> FinalSnapshot[WorkflowStateMachine.transition completed<br/>revision++]
    FinalSnapshot --> FinalProgress[pipeline_progress message]
    FinalProgress --> Webview

    Webview --> StreamStart{stream_start?}
    StreamStart -->|Yes| GetState[webview postMessage: pipeline_get_state]
    GetState --> HostState[OrchestrationCoordinator.getPipelineState]
    HostState --> Snapshot[WorkflowStateMachine.snapshot]
    Snapshot --> PostProgress

    Webview --> Switch{Tab switch / reload?}
    Switch -->|Yes| Render
    Switch -->|No| End([Pipeline UI visible])
    Render --> End
```
