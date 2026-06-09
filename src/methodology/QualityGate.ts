import { QualityGate, CodeDiff, GateResult, GateSeverity } from './types.js';

export interface GateCheckResult {
  name: string;
  severity: GateSeverity;
  result: GateResult;
}

export interface GateReport {
  passed: boolean;
  results: GateCheckResult[];
  blocked: string[];
  warnings: string[];
  infos: string[];
}

export class QualityGateRunner {
  private gates: QualityGate[];

  constructor(gates: QualityGate[]) {
    this.gates = gates;
  }

  async run(diff: CodeDiff): Promise<GateReport> {
    const results: GateCheckResult[] = [];
    const blocked: string[] = [];
    const warnings: string[] = [];
    const infos: string[] = [];

    for (const gate of this.gates) {
      let result: GateResult;
      try {
        result = await gate.check(diff);
      } catch {
        result = { passed: false, failures: ['Gate check threw an error'] };
      }

      results.push({
        name: gate.name,
        severity: gate.severity,
        result,
      });

      if (!result.passed) {
        switch (gate.severity) {
          case 'block':
            blocked.push(gate.name);
            break;
          case 'warn':
            warnings.push(gate.name);
            break;
          case 'info':
            infos.push(gate.name);
            break;
        }
      }
    }

    return {
      passed: blocked.length === 0,
      results,
      blocked,
      warnings,
      infos,
    };
  }
}

export function createDefaultGates(): QualityGate[] {
  const importValidation: QualityGate = {
    name: 'import-validation',
    severity: 'block',
    check: async (diff: CodeDiff): Promise<GateResult> => {
      const failures: string[] = [];
      const lines = diff.newContent.split('\n');

      for (const line of lines) {
        if (!line.startsWith('import')) continue;
        if (/from\s+['"]['"]/.test(line)) {
          failures.push(`Empty import source: ${line.trim()}`);
        }
      }

      return {
        passed: failures.length === 0,
        failures: failures.length > 0 ? failures : undefined,
      };
    },
  };

  const diffSize: QualityGate = {
    name: 'diff-size',
    severity: 'warn',
    check: async (diff: CodeDiff): Promise<GateResult> => {
      return { passed: diff.linesChanged < 400 };
    },
  };

  const duplication: QualityGate = {
    name: 'duplication',
    severity: 'block',
    check: async (diff: CodeDiff): Promise<GateResult> => {
      const lines = diff.newContent.split('\n');
      const failures: string[] = [];

      for (let i = 0; i < lines.length - 2; i++) {
        const current = lines[i]!.trim();
        if (current === '') continue;

        if (lines[i + 1]!.trim() === current && lines[i + 2]!.trim() === current) {
          failures.push(`Consecutive duplicate lines: ${current}`);
          i += 2;
        }
      }

      return {
        passed: failures.length === 0,
        failures: failures.length > 0 ? failures : undefined,
      };
    },
  };

  const complexityCeiling: QualityGate = {
    name: 'complexity-ceiling',
    severity: 'warn',
    check: async (diff: CodeDiff): Promise<GateResult> => {
      const braceCount = (diff.newContent.match(/{/g) ?? []).length;
      return { passed: braceCount <= 50 };
    },
  };

  return [importValidation, diffSize, duplication, complexityCeiling];
}
