import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { normalizeEmail } from '../connectors/connector.ts';
import {
  ConnectorsService,
  connectionSummary,
  type ConnectionSummary,
} from '../connectors/connectors.service.ts';
import type {
  CommerceAdapter,
  CommerceOrderDetail,
  CommerceOrderSummary,
  CommerceProductDetail,
  CommerceProductSummary,
} from './commerce-adapter.ts';

@Injectable()
export class CommerceService {
  constructor(@Inject(ConnectorsService) private readonly connectors: ConnectorsService) {}

  async lookupOrders(args: {
    email: string;
    connectionId?: string;
    limit: number;
  }): Promise<{ connection: ConnectionSummary; orders: CommerceOrderSummary[] }> {
    const scope = await this.connectors.resolveScope('commerce', args.connectionId);
    const adapter = scope.adapter as CommerceAdapter;
    const orders = await this.connectors.vendorCall(() =>
      adapter.listOrdersForCustomer(this.connectors.connectionContext(scope.connection), {
        email: normalizeEmail(args.email),
        limit: args.limit,
      }),
    );
    return { connection: connectionSummary(scope.connection), orders };
  }

  async lookupOrder(args: {
    email: string;
    connectionId?: string;
    orderRef?: string;
    orderNumber?: string;
  }): Promise<{ connection: ConnectionSummary; order: CommerceOrderDetail }> {
    if (!args.orderRef && !args.orderNumber) {
      throw new BadRequestException('commerce_invalid: provide orderRef or orderNumber');
    }
    const scope = await this.connectors.resolveScope('commerce', args.connectionId);
    const adapter = scope.adapter as CommerceAdapter;
    const order = await this.connectors.vendorCall(() =>
      adapter.getOrderForCustomer(this.connectors.connectionContext(scope.connection), {
        email: normalizeEmail(args.email),
        orderRef: args.orderRef,
        orderNumber: args.orderNumber,
      }),
    );
    if (!order) {
      throw new NotFoundException('commerce_not_found: no such order for that customer');
    }
    return { connection: connectionSummary(scope.connection), order };
  }

  async searchProducts(args: {
    query: string;
    connectionId?: string;
    limit: number;
  }): Promise<{ connection: ConnectionSummary; products: CommerceProductSummary[] }> {
    const scope = await this.connectors.resolveScope('commerce', args.connectionId);
    const adapter = scope.adapter as CommerceAdapter;
    const products = await this.connectors.vendorCall(() =>
      adapter.searchProducts(this.connectors.connectionContext(scope.connection), {
        query: args.query,
        limit: args.limit,
      }),
    );
    return { connection: connectionSummary(scope.connection), products };
  }

  async getProduct(args: {
    connectionId?: string;
    productRef?: string;
    sku?: string;
  }): Promise<{ connection: ConnectionSummary; product: CommerceProductDetail }> {
    if (!args.productRef && !args.sku) {
      throw new BadRequestException('commerce_invalid: provide productRef or sku');
    }
    const scope = await this.connectors.resolveScope('commerce', args.connectionId);
    const adapter = scope.adapter as CommerceAdapter;
    const product = await this.connectors.vendorCall(() =>
      adapter.getProduct(this.connectors.connectionContext(scope.connection), {
        productRef: args.productRef,
        sku: args.sku,
      }),
    );
    if (!product) {
      throw new NotFoundException('commerce_not_found: no such product in the connected store');
    }
    return { connection: connectionSummary(scope.connection), product };
  }

  async getMyOrders(args: {
    connectionId?: string;
    limit: number;
  }): Promise<{ connection: ConnectionSummary; orders: CommerceOrderSummary[] }> {
    const email = await this.connectors.requireEndUserEmail();
    return this.lookupOrders({ email, connectionId: args.connectionId, limit: args.limit });
  }

  async getMyOrder(args: {
    connectionId?: string;
    orderRef?: string;
    orderNumber?: string;
  }): Promise<{ connection: ConnectionSummary; order: CommerceOrderDetail }> {
    const email = await this.connectors.requireEndUserEmail();
    return this.lookupOrder({ email, ...args });
  }
}
