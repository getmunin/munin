import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { createZodValidationPipe } from 'nestjs-zod';
import { ZodError } from 'zod';

export const ZodValidationPipe: new () => PipeTransform = createZodValidationPipe({
  createValidationException: (error: unknown) => {
    if (!(error instanceof ZodError)) {
      return new BadRequestException({ message: 'validation_failed' });
    }
    const fieldErrors = error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    const summary = fieldErrors
      .map((fe) => (fe.field ? `${fe.field}: ${fe.message}` : fe.message))
      .join('; ');
    return new BadRequestException({
      message: `validation_failed: ${summary}`,
      fieldErrors,
    });
  },
});
