import { Injectable } from '@nestjs/common';

export interface TranslateTextInput {
  orgId: string;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface MessageTranslator {
  translateText(input: TranslateTextInput): Promise<string>;
}

@Injectable()
export class MessageTranslatorRegistry {
  private translator: MessageTranslator | null = null;

  register(translator: MessageTranslator): void {
    this.translator = translator;
  }

  get(): MessageTranslator | null {
    return this.translator;
  }
}
