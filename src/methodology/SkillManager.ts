/**
 * Skill Manager — loads skill definitions, matches triggers against user
 * requests, and composes overlapping skill instructions.
 *
 * Integrates with the existing SkillTriggerEngine for trigger matching
 * and provides deduplication for overlapping skill instructions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TaskClassification } from './types.js';

// ─── Skill Definition ───────────────────────────────────────────────────────

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  triggerPatterns: string[];
  instructions: string;
  priority: number;
  version: string;
  dependencies?: string[];
}

export interface SkillMatch {
  skill: SkillDefinition;
  relevanceScore: number;
  matchedPatterns: string[];
}

export interface ComposedInstructions {
  instructions: string;
  skillIds: string[];
  totalTokens: number;
  deduplicatedSections: number;
}

// ─── Skill Manager ──────────────────────────────────────────────────────────

export class SkillManager {
  private skills: Map<string, SkillDefinition> = new Map();
  private compiledPatterns: Map<string, RegExp[]> = new Map();
  private loaded = false;

  /**
   * Load skills from a directory.
   * Each skill is expected to be a directory with a SKILL.md file.
   */
  loadFromDirectory(skillsDir: string): number {
    this.skills.clear();
    this.compiledPatterns.clear();

    if (!fs.existsSync(skillsDir)) {
      this.loaded = true;
      return 0;
    }

    let loaded = 0;
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(skillsDir, entry.name);
      const skillFile = path.join(skillDir, 'SKILL.md');

      if (!fs.existsSync(skillFile)) continue;

      try {
        const content = fs.readFileSync(skillFile, 'utf-8');
        const skill = this.parseSkillMd(entry.name, content);
        if (skill) {
          this.skills.set(skill.id, skill);
          this.compilePatterns(skill);
          loaded++;
        }
      } catch {
        // Skip invalid skill files
      }
    }

    this.loaded = true;
    return loaded;
  }

  /**
   * Register a skill programmatically.
   */
  registerSkill(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
    this.compilePatterns(skill);
  }

  /**
   * Match skills against a user request.
   * Returns matched skills sorted by relevance score (highest first).
   */
  match(
    query: string,
    classification?: TaskClassification
  ): SkillMatch[] {
    const matches: SkillMatch[] = [];

    for (const [id, skill] of this.skills) {
      const patterns = this.compiledPatterns.get(id) ?? [];
      const matchedPatterns: string[] = [];
      let score = 0;

      for (let i = 0; i < patterns.length; i++) {
        if (patterns[i]!.test(query)) {
          matchedPatterns.push(skill.triggerPatterns[i] ?? patterns[i]!.source);
          score += 1;
        }
      }

      // Boost score based on task type alignment
      if (classification) {
        score += this.taskTypeBoost(skill, classification);
      }

      if (matchedPatterns.length > 0) {
        matches.push({
          skill,
          relevanceScore: Math.min(score / Math.max(skill.triggerPatterns.length, 1), 1.0),
          matchedPatterns,
        });
      }
    }

    return matches.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Compose instructions from multiple skill matches.
   * Deduplicates overlapping sections and respects priority ordering.
   */
  compose(
    matches: SkillMatch[],
    maxTokens: number = 4000
  ): ComposedInstructions {
    if (matches.length === 0) {
      return { instructions: '', skillIds: [], totalTokens: 0, deduplicatedSections: 0 };
    }

    // Sort by priority (highest first), then by relevance
    const sorted = [...matches].sort((a, b) => {
      const priorityDiff = b.skill.priority - a.skill.priority;
      if (priorityDiff !== 0) return priorityDiff;
      return b.relevanceScore - a.relevanceScore;
    });

    // Collect unique instruction sections
    const seenSections = new Set<string>();
    const sections: string[] = [];
    const skillIds: string[] = [];
    let totalTokens = 0;
    let deduplicated = 0;

    for (const match of sorted) {
      const instructions = match.skill.instructions;
      const normalizedSections = this.splitIntoSections(instructions);

      for (const section of normalizedSections) {
        const normalized = this.normalizeForDedup(section);

        if (seenSections.has(normalized)) {
          deduplicated++;
          continue;
        }

        const sectionTokens = Math.ceil(section.length / 4);
        if (totalTokens + sectionTokens > maxTokens) continue;

        seenSections.add(normalized);
        sections.push(section);
        totalTokens += sectionTokens;
      }

      skillIds.push(match.skill.id);
    }

    return {
      instructions: sections.join('\n\n'),
      skillIds,
      totalTokens,
      deduplicatedSections: deduplicated,
    };
  }

  /**
   * Get a skill by ID.
   */
  getSkill(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  /**
   * Get all loaded skill IDs.
   */
  getLoadedSkillIds(): string[] {
    return [...this.skills.keys()];
  }

  /**
   * Check if skills have been loaded.
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  /**
   * Parse a SKILL.md file into a SkillDefinition.
   */
  private parseSkillMd(dirName: string, content: string): SkillDefinition | null {
    const name = this.extractHeader(content) ?? dirName;
    const description = this.extractSection(content, 'description') ?? '';
    const triggers = this.extractSection(content, 'triggers') ?? '';
    const instructions = this.extractInstructions(content);

    const triggerPatterns = triggers
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));

    if (triggerPatterns.length === 0 && instructions.length === 0) {
      return null;
    }

    return {
      id: dirName,
      name,
      description: description.slice(0, 200),
      triggerPatterns,
      instructions,
      priority: triggerPatterns.length,
      version: '1.0.0',
    };
  }

  /**
   * Extract the first markdown header.
   */
  private extractHeader(content: string): string | null {
    const match = content.match(/^#\s+(.+)$/m);
    return match?.[1] ?? null;
  }

  /**
   * Extract a named section from markdown.
   */
  private extractSection(content: string, sectionName: string): string | null {
    const regex = new RegExp(`##\\s+${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
    const match = content.match(regex);
    return match?.[1]?.trim() ?? null;
  }

  /**
   * Extract the instructions portion of a SKILL.md.
   * This is everything after the metadata sections.
   */
  private extractInstructions(content: string): string {
    const lines = content.split('\n');
    let instructionStart = -1;
    let headerCount = 0;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.startsWith('## ')) {
        headerCount++;
        if (headerCount >= 2) {
          instructionStart = i;
          break;
        }
      }
    }

    if (instructionStart === -1) return content;
    return lines.slice(instructionStart).join('\n').trim();
  }

  /**
   * Compile trigger patterns into RegExp objects.
   */
  private compilePatterns(skill: SkillDefinition): void {
    const patterns = skill.triggerPatterns.map((p) => {
      try {
        return new RegExp(p, 'i');
      } catch {
        return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
    });
    this.compiledPatterns.set(skill.id, patterns);
  }

  /**
   * Calculate a relevance boost based on task type alignment.
   */
  private taskTypeBoost(skill: SkillDefinition, classification: TaskClassification): number {
    const name = skill.name.toLowerCase();
    let boost = 0;

    switch (classification.type) {
      case 'test':
        if (name.includes('test') || name.includes('tdd')) boost += 0.3;
        break;
      case 'debug':
        if (name.includes('debug')) boost += 0.3;
        break;
      case 'review':
        if (name.includes('review') || name.includes('audit')) boost += 0.3;
        break;
      case 'architect':
        if (name.includes('architect') || name.includes('design')) boost += 0.3;
        break;
      case 'refactor':
        if (name.includes('refactor') || name.includes('clean')) boost += 0.3;
        break;
      case 'generate':
        if (name.includes('implement') || name.includes('build') || name.includes('create')) boost += 0.2;
        break;
    }

    return boost;
  }

  /**
   * Split instructions into logical sections (by headers or paragraphs).
   */
  private splitIntoSections(instructions: string): string[] {
    const sections = instructions.split(/\n(?=#{1,3}\s)/);
    if (sections.length <= 1) {
      return instructions.split(/\n\n+/).filter((s) => s.trim().length > 0);
    }
    return sections.filter((s) => s.trim().length > 0);
  }

  /**
   * Normalize text for deduplication comparison.
   */
  private normalizeForDedup(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }
}
