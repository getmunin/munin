export interface AssistantDto {
  id: string;
  orgId: string;
  name: string | null;
  greeting: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillDto {
  uri: string;
  name: string;
  description: string;
  audiences: readonly string[];
  tier: 'fast' | 'smart';
  lastRunAt: string | null;
  lastRunStatus: 'pending' | 'running' | 'done' | 'failed' | 'dead' | null;
}

export interface UpdateAssistantBody {
  name?: string | null;
  greeting?: string | null;
}
