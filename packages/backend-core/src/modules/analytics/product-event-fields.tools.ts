import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpTool } from '@getmunin/mcp-toolkit';
import { ProductEventFieldsInput, ProductEventFieldsService } from './product-event-fields.ts';

@Injectable()
export class ProductEventFieldsTools {
  constructor(@Inject(ProductEventFieldsService) private readonly fields: ProductEventFieldsService) {}

  @McpTool({
    name: 'analytics_get_product_event_fields',
    title: 'Analytics: Get product event field mappings',
    description:
      'Show which product event properties are copied onto the contact\'s custom fields when an event arrives on POST /v1/events (for example `threllName` → `threll_name`), and whether the org has configured any.',
    audiences: ['admin'],
    scopes: ['analytics:read'],
    input: z.object({}),
    readOnlyHint: true,
    destructiveHint: false,
  })
  get() {
    return this.fields.get();
  }

  @McpTool({
    name: 'analytics_configure_product_event_fields',
    title: 'Analytics: Configure product event field mappings',
    description:
      'Replace the list of product event properties copied onto contact custom fields. When an event that resolves to a contact carries a mapped property with a string, number or boolean value, the value is written to the custom field; an older event never overwrites a value from a newer one. Only events recorded after the change are copied. Pass an empty list to stop copying.',
    audiences: ['admin'],
    scopes: ['analytics:write'],
    input: ProductEventFieldsInput,
    readOnlyHint: false,
    destructiveHint: true,
  })
  configure(args: z.infer<typeof ProductEventFieldsInput>) {
    return this.fields.configure(args);
  }
}
