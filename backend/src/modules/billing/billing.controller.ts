import { BadRequestException, Controller, Headers, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import Stripe from 'stripe';
import { Repository } from 'typeorm';
import { Company, CompanyStatus } from '../companies/company.entity';

/**
 * Implementa a automação descrita na Seção 6.3 do documento: a plataforma de
 * cobrança (aqui, Stripe — o mesmo padrão vale para Asaas/Vindi trocando o
 * SDK) avisa este endpoint sempre que um pagamento falha, é confirmado, ou a
 * assinatura é cancelada. O status da empresa é atualizado automaticamente,
 * e o SubscriptionGuard (Seção 6.2) já bloqueia o acesso na próxima requisição
 * — sem qualquer intervenção manual pelo Painel Master.
 *
 * IMPORTANTE (não verificável neste ambiente de desenvolvimento): este
 * endpoint só funciona de ponta a ponta com uma conta Stripe real configurada
 * (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) e o campo
 * `billingProviderCustomerId` preenchido em cada empresa (isso aconteceria no
 * fluxo de checkout/assinatura, que também não está implementado — ver README).
 */
@Controller('billing/webhooks')
export class BillingController {
  private readonly stripe: Stripe | null;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Company) private readonly companiesRepository: Repository<Company>,
  ) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = secretKey ? new Stripe(secretKey) : null;
  }

  @Post('stripe')
  async handleStripeWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!this.stripe) {
      throw new BadRequestException('Stripe não configurado neste ambiente (STRIPE_SECRET_KEY ausente).');
    }
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret || !request.rawBody) {
      throw new BadRequestException('Configuração de webhook incompleta.');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(request.rawBody, signature, webhookSecret);
    } catch (err) {
      throw new BadRequestException(
        `Assinatura de webhook inválida: ${err instanceof Error ? err.message : 'erro desconhecido'}`,
      );
    }

    switch (event.type) {
      case 'invoice.paid': {
        const customerId = (event.data.object as Stripe.Invoice).customer as string;
        await this.updateStatusByCustomerId(customerId, CompanyStatus.ACTIVE);
        break;
      }
      case 'invoice.payment_failed': {
        const customerId = (event.data.object as Stripe.Invoice).customer as string;
        // PAST_DUE = "período de tolerância" (Seção 6.2) — ainda não bloqueia
        // o acesso; o SubscriptionGuard trata past_due como acesso permitido.
        // Um segundo webhook (ou uma rotina agendada) promoveria past_due
        // prolongado para BLOCKED, o que fica como próximo passo natural.
        await this.updateStatusByCustomerId(customerId, CompanyStatus.PAST_DUE);
        break;
      }
      case 'customer.subscription.deleted': {
        const customerId = (event.data.object as Stripe.Subscription).customer as string;
        await this.updateStatusByCustomerId(customerId, CompanyStatus.CANCELED);
        break;
      }
      default:
        // Outros eventos do Stripe são ignorados de propósito nesta versão.
        break;
    }

    return { received: true };
  }

  private async updateStatusByCustomerId(customerId: string, status: CompanyStatus) {
    const company = await this.companiesRepository.findOne({
      where: { billingProviderCustomerId: customerId },
    });
    if (!company) return; // evento de um customer que não corresponde a nenhuma empresa conhecida
    company.status = status;
    await this.companiesRepository.save(company);
  }
}
