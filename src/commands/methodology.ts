/**
 * Methodology commands — AGENTS.md generation and methodology configuration.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AgentsMdGenerator } from '../methodology/AgentsMdGenerator';
import { log } from '../utils/outputChannel';

export function registerGenerateAgentsMdCommand(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('opencode-harness.generateAgentsMd', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('Open a workspace folder to generate AGENTS.md.');
        return;
      }

      const projectRoot = workspaceFolders[0]!.uri.fsPath;
      const generator = new AgentsMdGenerator(projectRoot);

      try {
        const result = generator.generate();

        if (result.existingFile) {
          const updated = result.sectionsUpdated ?? [];
          if (updated.length > 0) {
            vscode.window.showInformationMessage(
              `AGENTS.md updated. Sections changed: ${updated.join(', ')}`
            );
          } else {
            vscode.window.showInformationMessage('AGENTS.md is already up to date.');
          }
        } else {
          vscode.window.showInformationMessage(
            'AGENTS.md generated with auto-detected project configuration.'
          );
        }

        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(path.join(projectRoot, 'AGENTS.md'))
        );
        await vscode.window.showTextDocument(doc);
      } catch (err) {
        log.error('AGENTS.md generation failed', err);
        vscode.window.showErrorMessage(`Failed to generate AGENTS.md: ${(err as Error).message}`);
      }
    })
  );
}
