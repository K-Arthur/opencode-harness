/**
 * AGENTS.md Generator — auto-detects technology stack from project files
 * and generates or updates AGENTS.md with conventions, commands, and structure.
 *
 * Detects:
 * - Package managers (npm, yarn, pnpm, bun)
 * - Frameworks (React, Vue, Svelte, Next.js, Express, etc.)
 * - Languages (TypeScript, Python, Go, Rust, etc.)
 * - Test frameworks (Jest, Vitest, Mocha, Playwright, etc.)
 * - Build tools (esbuild, webpack, vite, turbo, etc.)
 * - Linting (ESLint, Prettier, Ruff, etc.)
 * - CI/CD (GitHub Actions, GitLab CI, etc.)
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Tech Detection ─────────────────────────────────────────────────────────

export interface TechStack {
  languages: string[];
  frameworks: string[];
  packageManager: string;
  buildTool: string;
  testFrameworks: string[];
  linters: string[];
  ciSystem: string[];
  runtime: string;
}

export interface ProjectStructure {
  srcDirs: string[];
  testDirs: string[];
  configFiles: string[];
  entryPoints: string[];
}

export interface AgentsMdResult {
  content: string;
  techStack: TechStack;
  structure: ProjectStructure;
  existingFile: boolean;
  sectionsUpdated: string[];
}

export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
  main?: string;
  module?: string;
  exports?: Record<string, unknown>;
}

// ─── Agents.md Generator ────────────────────────────────────────────────────

export class AgentsMdGenerator {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Generate or update AGENTS.md for the project.
   * If an existing AGENTS.md is found, only updates the auto-generated sections.
   */
  generate(): AgentsMdResult {
    const techStack = this.detectTechStack();
    const structure = this.detectStructure();
    const agentsPath = path.join(this.projectRoot, 'AGENTS.md');
    const existing = fs.existsSync(agentsPath);

    let existingContent = '';
    let sectionsUpdated: string[] = [];

    if (existing) {
      existingContent = fs.readFileSync(agentsPath, 'utf-8');
    }

    const generated = this.composeAgentsMd(techStack, structure, existingContent);

    if (existing) {
      sectionsUpdated = this.detectUpdatedSections(existingContent, generated);
    }

    return {
      content: generated,
      techStack,
      structure,
      existingFile: existing,
      sectionsUpdated,
    };
  }

  /**
   * Detect the project's technology stack.
   */
  detectTechStack(): TechStack {
    return {
      languages: this.detectLanguages(),
      frameworks: this.detectFrameworks(),
      packageManager: this.detectPackageManager(),
      buildTool: this.detectBuildTool(),
      testFrameworks: this.detectTestFrameworks(),
      linters: this.detectLinters(),
      ciSystem: this.detectCI(),
      runtime: this.detectRuntime(),
    };
  }

  /**
   * Detect the project's directory structure.
   */
  detectStructure(): ProjectStructure {
    const entries = this.safeReaddir(this.projectRoot);

    const srcDirs = entries.filter((e) => {
      const fullPath = path.join(this.projectRoot, e);
      return fs.statSync(fullPath).isDirectory() && /^(src|lib|app|pages|components|modules)/.test(e);
    });

    const testDirs = entries.filter((e) => {
      const fullPath = path.join(this.projectRoot, e);
      return fs.statSync(fullPath).isDirectory() && /^(tests?|spec|__tests__|e2e)/.test(e);
    });

    const configFiles = entries.filter((e) =>
      /\.(json|yaml|yml|toml|config\.\w+)$/.test(e) || /\.(eslintrc|prettierrc|tsconfig)/.test(e)
    );

    const entryPoints: string[] = [];
    const pkg = this.readPackageJson();
    if (pkg) {
      if (pkg.main) entryPoints.push(pkg.main);
      if (pkg.module) entryPoints.push(pkg.module);
      if (pkg.exports) entryPoints.push(...Object.keys(pkg.exports));
    }

    return { srcDirs, testDirs, configFiles, entryPoints };
  }

  // ─── Detection Methods ──────────────────────────────────────────────────

  private detectLanguages(): string[] {
    const languages = new Set<string>();

    if (this.fileExists('tsconfig.json')) languages.add('TypeScript');
    if (this.globExists('*.jsx', '*.tsx')) languages.add('JSX');
    if (this.fileExists('package.json')) languages.add('JavaScript');
    if (this.globExists('*.py', 'requirements.txt', 'pyproject.toml', 'setup.py')) languages.add('Python');
    if (this.globExists('*.go', 'go.mod')) languages.add('Go');
    if (this.globExists('*.rs', 'Cargo.toml')) languages.add('Rust');
    if (this.globExists('*.java', 'pom.xml', 'build.gradle')) languages.add('Java');
    if (this.globExists('*.cs', '*.csproj')) languages.add('C#');
    if (this.globExists('*.rb', 'Gemfile')) languages.add('Ruby');

    return [...languages];
  }

  private detectFrameworks(): string[] {
    const frameworks: string[] = [];

    const pkg = this.readPackageJson();
    if (!pkg) return frameworks;

    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const depNames = Object.keys(deps).join(' ');

    if (/react/i.test(depNames)) frameworks.push('React');
    if (/next/i.test(depNames)) frameworks.push('Next.js');
    if (/vue/i.test(depNames)) frameworks.push('Vue');
    if (/svelte/i.test(depNames)) frameworks.push('Svelte');
    if (/nuxt/i.test(depNames)) frameworks.push('Nuxt');
    if (/express/i.test(depNames)) frameworks.push('Express');
    if (/fastify/i.test(depNames)) frameworks.push('Fastify');
    if (/nestjs|@nestjs/i.test(depNames)) frameworks.push('NestJS');
    if (/koa/i.test(depNames)) frameworks.push('Koa');
    if (/hono/i.test(depNames)) frameworks.push('Hono');
    if (/astro/i.test(depNames)) frameworks.push('Astro');
    if (/remix/i.test(depNames)) frameworks.push('Remix');
    if (/solid-js/i.test(depNames)) frameworks.push('SolidJS');
    if (/angular|@angular/i.test(depNames)) frameworks.push('Angular');
    if (/tailwindcss/i.test(depNames)) frameworks.push('Tailwind CSS');
    if (/prisma/i.test(depNames)) frameworks.push('Prisma');
    if (/drizzle/i.test(depNames)) frameworks.push('Drizzle');

    return frameworks;
  }

  private detectPackageManager(): string {
    if (this.fileExists('pnpm-lock.yaml')) return 'pnpm';
    if (this.fileExists('yarn.lock')) return 'yarn';
    if (this.fileExists('bun.lockb') || this.fileExists('bun.lock')) return 'bun';
    if (this.fileExists('package-lock.json')) return 'npm';
    if (this.fileExists('package.json')) return 'npm';
    if (this.fileExists('requirements.txt') || this.fileExists('pyproject.toml')) return 'pip';
    if (this.fileExists('go.mod')) return 'go modules';
    if (this.fileExists('Cargo.toml')) return 'cargo';
    return 'unknown';
  }

  private detectBuildTool(): string {
    if (this.fileExists('esbuild.js') || this.keyInPackageJson('esbuild')) return 'esbuild';
    if (this.keyInPackageJson('vite')) return 'Vite';
    if (this.keyInPackageJson('webpack')) return 'Webpack';
    if (this.keyInPackageJson('turbo')) return 'Turborepo';
    if (this.keyInPackageJson('rollup')) return 'Rollup';
    if (this.keyInPackageJson('parcel')) return 'Parcel';
    return 'unknown';
  }

  private detectTestFrameworks(): string[] {
    const frameworks: string[] = [];

    const pkg = this.readPackageJson();
    if (!pkg) {
      if (this.globExists('pytest.ini', 'conftest.py')) frameworks.push('pytest');
      if (this.globExists('Cargo.toml')) frameworks.push('cargo test');
      return frameworks;
    }

    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const depNames = Object.keys(deps).join(' ');
    const scripts = pkg.scripts ?? {};
    const scriptValues = Object.values(scripts).join(' ');

    if (/jest/i.test(depNames)) frameworks.push('Jest');
    if (/vitest/i.test(depNames)) frameworks.push('Vitest');
    if (/mocha/i.test(depNames)) frameworks.push('Mocha');
    if (/playwright/i.test(depNames)) frameworks.push('Playwright');
    if (/cypress/i.test(depNames)) frameworks.push('Cypress');
    if (/@testing-library/i.test(depNames)) frameworks.push('Testing Library');
    if (/node\s+--test/.test(scriptValues)) frameworks.push('Node.js test runner');

    return frameworks;
  }

  private detectLinters(): string[] {
    const linters: string[] = [];

    if (this.fileExists('.eslintrc') || this.fileExists('.eslintrc.js') ||
        this.fileExists('.eslintrc.json') || this.fileExists('.eslintrc.yml') ||
        this.fileExists('eslint.config.js') || this.fileExists('eslint.config.mjs')) {
      linters.push('ESLint');
    }

    if (this.fileExists('.prettierrc') || this.fileExists('.prettierrc.js') ||
        this.fileExists('.prettierrc.json') || this.fileExists('prettier.config.js')) {
      linters.push('Prettier');
    }

    if (this.keyInPackageJson('prettier')) linters.push('Prettier');
    if (this.keyInPackageJson('@typescript-eslint')) linters.push('typescript-eslint');

    if (this.globExists('ruff.toml', '.ruff.toml')) linters.push('Ruff');
    if (this.globExists('.flake8')) linters.push('Flake8');

    return linters;
  }

  private detectCI(): string[] {
    const ci: string[] = [];
    const ghPath = path.join(this.projectRoot, '.github', 'workflows');
    if (fs.existsSync(ghPath) && fs.statSync(ghPath).isDirectory()) ci.push('GitHub Actions');
    if (this.fileExists('.gitlab-ci.yml')) ci.push('GitLab CI');
    if (this.fileExists('.circleci')) ci.push('CircleCI');
    if (this.fileExists('Jenkinsfile')) ci.push('Jenkins');
    if (this.fileExists('.travis.yml')) ci.push('Travis CI');
    return ci;
  }

  private detectRuntime(): string {
    const pkg = this.readPackageJson();
    if (!pkg) {
      if (this.fileExists('go.mod')) return 'Go';
      if (this.fileExists('Cargo.toml')) return 'Rust';
      if (this.globExists('*.py')) return 'Python';
      return 'unknown';
    }

    const engines: Record<string, string> = pkg.engines ?? {};
    if (engines['node']) return `Node.js ${engines['node']}`;
    if (engines['bun']) return 'Bun';
    if (engines['deno']) return 'Deno';

    if (this.fileExists('bun.lockb') || this.fileExists('bun.lock')) return 'Bun';
    return 'Node.js';
  }

  // ─── AGENTS.md Composition ──────────────────────────────────────────────

  private composeAgentsMd(
    tech: TechStack,
    structure: ProjectStructure,
    existingContent: string
  ): string {
    const sections: string[] = [];

    // Preserve any manually written sections from existing file
    const manualSections = this.extractManualSections(existingContent);

    // Auto-generated header
    sections.push(this.generateAutoHeader(tech, structure));

    // Project Overview
    sections.push(this.generateProjectOverview(tech, structure));

    // Commands
    sections.push(this.generateCommands(tech));

    // Architecture
    if (structure.srcDirs.length > 0) {
      sections.push(this.generateArchitecture(tech, structure));
    }

    // Testing
    if (tech.testFrameworks.length > 0) {
      sections.push(this.generateTestingSection(tech));
    }

    // Code Style
    if (tech.linters.length > 0) {
      sections.push(this.generateCodeStyle(tech));
    }

    // CI/CD
    if (tech.ciSystem.length > 0) {
      sections.push(this.generateCISection(tech));
    }

    // Manual sections (preserved)
    for (const [name, content] of manualSections) {
      sections.push(`## ${name}\n\n${content}`);
    }

    return sections.join('\n\n');
  }

  private generateAutoHeader(tech: TechStack, structure: ProjectStructure): string {
    const langList = tech.languages.join(', ') || 'Unknown';
    const fwList = tech.frameworks.join(', ') || 'None detected';

    return [
      '# Project Configuration',
      '',
      `<!-- Auto-generated by OpenCode Methodology System -->`,
      `<!-- Last updated: ${new Date().toISOString().split('T')[0]} -->`,
      '',
      `- **Languages:** ${langList}`,
      `- **Frameworks:** ${fwList}`,
      `- **Package Manager:** ${tech.packageManager}`,
      `- **Build Tool:** ${tech.buildTool}`,
      `- **Runtime:** ${tech.runtime}`,
    ].join('\n');
  }

  private generateProjectOverview(tech: TechStack, structure: ProjectStructure): string {
    const lines = [
      '## Project Overview',
      '',
    ];

    if (structure.entryPoints.length > 0) {
      lines.push(`**Entry points:** ${structure.entryPoints.join(', ')}`);
    }

    if (structure.srcDirs.length > 0) {
      lines.push(`**Source directories:** ${structure.srcDirs.join(', ')}`);
    }

    if (structure.testDirs.length > 0) {
      lines.push(`**Test directories:** ${structure.testDirs.join(', ')}`);
    }

    return lines.join('\n');
  }

  private generateCommands(tech: TechStack): string {
    const lines = ['## Commands', ''];
    const pm = tech.packageManager;
    const runCmd = pm === 'npm' ? 'npm run' : pm === 'pnpm' ? 'pnpm' : pm === 'yarn' ? 'yarn' : pm === 'bun' ? 'bun' : pm;

    const pkg = this.readPackageJson();
    const scripts: Record<string, string> = pkg?.scripts ?? {};

    if (scripts['build']) lines.push(`- **Build:** \`${runCmd} build\``);
    if (scripts['watch']) lines.push(`- **Watch:** \`${runCmd} watch\``);
    if (scripts['test'] || scripts['test:unit']) lines.push(`- **Test:** \`${runCmd} test\``);
    if (scripts['lint'] || scripts['typecheck']) lines.push(`- **Lint:** \`${runCmd} lint\``);
    if (scripts['typecheck']) lines.push(`- **Typecheck:** \`${runCmd} typecheck\``);
    if (scripts['coverage']) lines.push(`- **Coverage:** \`${runCmd} coverage\``);

    if (lines.length <= 2) {
      lines.push('No scripts detected in package.json.');
    }

    return lines.join('\n');
  }

  private generateArchitecture(tech: TechStack, structure: ProjectStructure): string {
    const lines = [
      '## Architecture',
      '',
      'Source directories:',
    ];

    for (const dir of structure.srcDirs) {
      const dirPath = path.join(this.projectRoot, dir);
      if (fs.existsSync(dirPath)) {
        try {
          const subdirs = fs.readdirSync(dirPath, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
          if (subdirs.length > 0) {
            lines.push(`- \`${dir}/\`: ${subdirs.slice(0, 5).join(', ')}${subdirs.length > 5 ? '...' : ''}`);
          } else {
            lines.push(`- \`${dir}/\``);
          }
        } catch {
          lines.push(`- \`${dir}/\``);
        }
      }
    }

    return lines.join('\n');
  }

  private generateTestingSection(tech: TechStack): string {
    const lines = [
      '## Testing',
      '',
      `**Frameworks:** ${tech.testFrameworks.join(', ')}`,
    ];

    if (tech.testFrameworks.includes('Jest') || tech.testFrameworks.includes('Vitest')) {
      lines.push('', 'Test file patterns: `*.test.ts`, `*.spec.ts`, `*.test.tsx`');
    }

    return lines.join('\n');
  }

  private generateCodeStyle(tech: TechStack): string {
    const lines = [
      '## Code Style',
      '',
      `**Linters:** ${tech.linters.join(', ')}`,
    ];

    if (tech.linters.includes('ESLint')) {
      lines.push('', 'Run `npm run lint` to check for issues.');
    }
    if (tech.linters.includes('Prettier')) {
      lines.push('Run `npx prettier --write .` to format.');
    }

    return lines.join('\n');
  }

  private generateCISection(tech: TechStack): string {
    return [
      '## CI/CD',
      '',
      `**System:** ${tech.ciSystem.join(', ')}`,
    ].join('\n');
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private extractManualSections(content: string): Map<string, string> {
    const manual = new Map<string, string>();
    const autoSectionNames = new Set([
      'Project Overview', 'Commands', 'Architecture',
      'Testing', 'Code Style', 'CI/CD', 'Project Configuration',
    ]);

    const sectionRegex = /^## (.+)$/gm;
    let match: RegExpExecArray | null;
    const sections: { name: string; start: number }[] = [];

    while ((match = sectionRegex.exec(content)) !== null) {
      sections.push({ name: match[1]!, start: match.index });
    }

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]!;
      if (autoSectionNames.has(section.name)) continue;

      const start = content.indexOf('\n', section.start) + 1;
      const nextSection = sections[i + 1];
      const end = nextSection ? nextSection.start : content.length;
      const body = content.slice(start, end).trim();

      if (body.length > 0) {
        manual.set(section.name, body);
      }
    }

    return manual;
  }

  private detectUpdatedSections(oldContent: string, newContent: string): string[] {
    const updated: string[] = [];
    const autoSectionNames = [
      'Project Overview', 'Commands', 'Architecture',
      'Testing', 'Code Style', 'CI/CD',
    ];

    for (const name of autoSectionNames) {
      const oldSection = this.extractSection(oldContent, name);
      const newSection = this.extractSection(newContent, name);
      if (oldSection !== newSection) {
        updated.push(name);
      }
    }

    return updated;
  }

  private extractSection(content: string, name: string): string | null {
    const regex = new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'm');
    const match = content.match(regex);
    return match?.[1]?.trim() ?? null;
  }

  private fileExists(relativePath: string): boolean {
    return fs.existsSync(path.join(this.projectRoot, relativePath));
  }

  private globExists(...patterns: string[]): boolean {
    return patterns.some((p) => {
      try {
        const files = fs.readdirSync(this.projectRoot);
        return files.some((f) => {
          if (p.startsWith('*.')) {
            return f.endsWith(p.slice(1));
          }
          return f === p;
        });
      } catch {
        return false;
      }
    });
  }

  private readJson(relativePath: string): Record<string, unknown> | null {
    try {
      const content = fs.readFileSync(path.join(this.projectRoot, relativePath), 'utf-8');
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private readPackageJson(): PackageJson | null {
    const data = this.readJson('package.json');
    if (!data) return null;
    return {
      dependencies: data['dependencies'] as Record<string, string> | undefined,
      devDependencies: data['devDependencies'] as Record<string, string> | undefined,
      scripts: data['scripts'] as Record<string, string> | undefined,
      engines: data['engines'] as Record<string, string> | undefined,
      main: data['main'] as string | undefined,
      module: data['module'] as string | undefined,
      exports: data['exports'] as Record<string, unknown> | undefined,
    };
  }

  private keyInPackageJson(key: string): boolean {
    const pkg = this.readPackageJson();
    if (!pkg) return false;
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    return key in deps;
  }

  private safeReaddir(dirPath: string): string[] {
    try {
      return fs.readdirSync(dirPath);
    } catch {
      return [];
    }
  }
}
