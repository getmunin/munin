import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@munin/mcp-toolkit';
import { BootstrapRegistry } from './bootstrap.registry.js';

const StatusInput = z.object({
  app: z.string().min(1).max(32),
});

const AnswerInput = z.object({
  app: z.string().min(1).max(32),
  stepId: z.string().min(1).max(64),
  value: z.unknown(),
});

@Injectable()
export class BootstrapTools {
  constructor(@Inject(BootstrapRegistry) private readonly registry: BootstrapRegistry) {}

  @McpTool({
    name: 'bootstrap_status',
    description:
      'Read the conversational config progress for one Munin app (kb / desk / crm / ...). Returns the next step to ask the user about, or `completed: true` when all steps are done.',
    audiences: ['admin'],
    scopes: [],
    input: StatusInput,
  })
  async status(args: z.infer<typeof StatusInput>) {
    const runner = this.registry.get(args.app);
    if (!runner) {
      throw new Error(
        `Unknown app "${args.app}". Available: ${this.registry.appKeys().join(', ')}`,
      );
    }
    return runner.status();
  }

  @McpTool({
    name: 'bootstrap_answer',
    description:
      'Submit the user\'s answer to a bootstrap step. The runner validates `value`, applies side effects (e.g. creates a space), and returns the updated status.',
    audiences: ['admin'],
    scopes: [],
    input: AnswerInput,
  })
  async answer(args: z.infer<typeof AnswerInput>) {
    const runner = this.registry.get(args.app);
    if (!runner) {
      throw new Error(
        `Unknown app "${args.app}". Available: ${this.registry.appKeys().join(', ')}`,
      );
    }
    return runner.answer(args.stepId, args.value);
  }
}
