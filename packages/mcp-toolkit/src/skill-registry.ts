import type { Audience } from '@getmunin/core';

export interface RegisteredSkill {
  uri: string;
  name: string;
  description: string;
  audiences: readonly Audience[];
  mimeType: string;
  content: string;
  public: boolean;
}

export class SkillRegistry {
  private readonly byUri = new Map<string, RegisteredSkill>();

  register(skill: RegisteredSkill): void {
    if (this.byUri.has(skill.uri)) {
      throw new Error(`Duplicate skill URI: ${skill.uri}`);
    }
    this.byUri.set(skill.uri, skill);
  }

  list(audience?: Audience): RegisteredSkill[] {
    const all = Array.from(this.byUri.values());
    if (!audience) return all;
    return all.filter((s) => s.audiences.includes(audience));
  }

  listPublic(): RegisteredSkill[] {
    return Array.from(this.byUri.values()).filter((s) => s.public);
  }

  get(uri: string): RegisteredSkill | undefined {
    return this.byUri.get(uri);
  }

  size(): number {
    return this.byUri.size;
  }
}
