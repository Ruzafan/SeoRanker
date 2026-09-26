import Stripe from 'stripe';
import type { Organization, PrismaClient } from '@seo/db';
import {
  PAID_PLAN_IDS,
  planFor,
  type BillingDto,
  type CheckoutInput,
  type CheckoutResultDto,
  type PaidPlanId,
} from '@seo/shared';
import { AppError } from '../errors.js';
import { articlesLimitForPlan, organizationArticlesThisMonth } from '../pipeline/quota.js';
import type { CoreDeps } from './deps.js';

/** Subconjunto del SDK de Stripe que usamos; permite inyectar un doble en tests. */
export interface StripeApi {
  customers: {
    create(params: Stripe.CustomerCreateParams): Promise<{ id: string }>;
  };
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null }>;
    };
  };
  billingPortal: {
    sessions: {
      create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }>;
    };
  };
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>;
    update(id: string, params: Stripe.SubscriptionUpdateParams): Promise<Stripe.Subscription>;
  };
  webhooks: {
    constructEvent(payload: string | Buffer, header: string, secret: string): Stripe.Event;
  };
}

export interface BillingConfig {
  webhookSecret: string;
  /** Price ID de Stripe de cada plan de pago. */
  prices: Record<PaidPlanId, string>;
  /** Origen del panel, para las URLs de vuelta de Checkout y del portal. */
  webOrigin: string;
  /** Stripe Tax: calcula el IVA según el país del cliente. Requiere activarlo en Stripe. */
  automaticTax: boolean;
}

export interface Billing {
  api: StripeApi;
  config: BillingConfig;
}

export function createStripeBilling(secretKey: string, config: BillingConfig): Billing {
  return { api: new Stripe(secretKey), config };
}

/** Estados en los que la suscripción da acceso al plan (past_due: periodo de gracia de Stripe). */
const ENTITLED = new Set<Stripe.Subscription.Status>(['active', 'trialing', 'past_due']);

function requireBilling(deps: CoreDeps): Billing {
  if (!deps.billing) {
    throw new AppError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server', {
      httpStatus: 503,
    });
  }
  return deps.billing;
}

async function requireOwner(
  prisma: PrismaClient,
  userId: string,
): Promise<{ email: string; organization: Organization }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { organization: true },
  });
  if (user.role !== 'owner') {
    throw new AppError('OWNER_REQUIRED', 'Only the organization owner can manage billing', {
      httpStatus: 403,
    });
  }
  return user;
}

function planForPrice(billing: Billing, priceId: string | undefined): PaidPlanId | null {
  return PAID_PLAN_IDS.find((p) => billing.config.prices[p] === priceId) ?? null;
}

export async function getBilling(
  deps: CoreDeps,
  organizationId: string,
  userId: string,
): Promise<BillingDto> {
  const [org, user, sites, members, articles] = await Promise.all([
    deps.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    deps.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } }),
    deps.prisma.site.count({ where: { organizationId } }),
    deps.prisma.user.count({ where: { organizationId } }),
    organizationArticlesThisMonth(deps.prisma, organizationId),
  ]);
  const plan = planFor(org.plan);
  return {
    configured: !!deps.billing,
    plan: plan.id,
    status: org.subscriptionStatus,
    currentPeriodEnd: org.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: org.cancelAtPeriodEnd,
    hasCustomer: !!org.stripeCustomerId,
    canManage: user.role === 'owner',
    usage: {
      articles,
      articlesLimit: articlesLimitForPlan(org.plan, deps.config),
      sites,
      maxSites: plan.maxSites,
      members,
      maxMembers: plan.maxMembers,
    },
  };
}

/**
 * Contratar o cambiar de plan. Sin suscripción viva → sesión de Stripe Checkout (url).
 * Con suscripción viva → se cambia el precio en el acto con prorrateo (url = null).
 */
export async function startCheckout(
  deps: CoreDeps,
  userId: string,
  input: CheckoutInput,
): Promise<CheckoutResultDto> {
  const billing = requireBilling(deps);
  const { email, organization: org } = await requireOwner(deps.prisma, userId);
  const price = billing.config.prices[input.plan];

  if (
    org.stripeSubscriptionId &&
    org.subscriptionStatus &&
    ENTITLED.has(org.subscriptionStatus as Stripe.Subscription.Status)
  ) {
    const current = await billing.api.subscriptions.retrieve(org.stripeSubscriptionId);
    const item = current.items.data[0];
    if (!item)
      throw new AppError('INVALID_STATE', 'Subscription has no items', { httpStatus: 409 });
    const updated = await billing.api.subscriptions.update(current.id, {
      items: [{ id: item.id, price }],
      proration_behavior: 'create_prorations',
      cancel_at_period_end: false,
      metadata: { organizationId: org.id },
    });
    await applySubscription(deps.prisma, billing, org.id, updated);
    return { url: null };
  }

  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const customer = await billing.api.customers.create({
      email,
      name: org.name,
      metadata: { organizationId: org.id },
    });
    customerId = customer.id;
    await deps.prisma.organization.update({
      where: { id: org.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const base = billing.config.webOrigin.replace(/\/+$/, '');
  const session = await billing.api.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: org.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { organizationId: org.id } },
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    ...(billing.config.automaticTax
      ? {
          automatic_tax: { enabled: true },
          customer_update: { address: 'auto' as const, name: 'auto' as const },
        }
      : {}),
    success_url: `${base}/billing?checkout=success`,
    cancel_url: `${base}/billing?checkout=cancel`,
  });
  if (!session.url) throw new AppError('INTERNAL_ERROR', 'Stripe returned no checkout URL');
  return { url: session.url };
}

/** Portal de cliente de Stripe: facturas, método de pago, cancelar. */
export async function openBillingPortal(
  deps: CoreDeps,
  userId: string,
): Promise<CheckoutResultDto> {
  const billing = requireBilling(deps);
  const { organization: org } = await requireOwner(deps.prisma, userId);
  if (!org.stripeCustomerId) {
    throw new AppError('INVALID_STATE', 'Organization has no Stripe customer yet', {
      httpStatus: 409,
    });
  }
  const session = await billing.api.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${billing.config.webOrigin.replace(/\/+$/, '')}/billing`,
  });
  return { url: session.url };
}

/**
 * Webhook de Stripe. Verifica la firma y sincroniza la suscripción RELEYÉNDOLA de Stripe:
 * así el orden de llegada de los eventos da igual y reenviar un evento es inocuo.
 */
export async function handleStripeWebhook(
  deps: CoreDeps,
  rawBody: Buffer,
  signature: string | undefined,
): Promise<{ handled: boolean }> {
  const billing = requireBilling(deps);
  let event: Stripe.Event;
  try {
    event = billing.api.webhooks.constructEvent(
      rawBody,
      signature ?? '',
      billing.config.webhookSecret,
    );
  } catch (err) {
    throw new AppError('VALIDATION_ERROR', 'Invalid Stripe signature', {
      httpStatus: 400,
      cause: err,
    });
  }

  let subscriptionId: string | null;
  let orgHint: string | null = null;
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      subscriptionId =
        typeof s.subscription === 'string' ? s.subscription : (s.subscription?.id ?? null);
      orgHint = s.client_reference_id;
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      subscriptionId = event.data.object.id;
      break;
    default:
      return { handled: false };
  }
  if (!subscriptionId) return { handled: false };

  const sub = await billing.api.subscriptions.retrieve(subscriptionId);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const org = await deps.prisma.organization.findFirst({
    where: {
      OR: [
        { id: sub.metadata['organizationId'] ?? orgHint ?? '' },
        { stripeCustomerId: customerId },
      ],
    },
  });
  if (!org) return { handled: false };

  // Una suscripción antigua (ya sustituida) no debe pisar a la vigente.
  if (
    org.stripeSubscriptionId &&
    org.stripeSubscriptionId !== sub.id &&
    !ENTITLED.has(sub.status)
  ) {
    return { handled: false };
  }
  await applySubscription(deps.prisma, billing, org.id, sub);
  return { handled: true };
}

async function applySubscription(
  prisma: PrismaClient,
  billing: Billing,
  organizationId: string,
  sub: Stripe.Subscription,
): Promise<void> {
  const item = sub.items.data[0];
  const paidPlan = planForPrice(billing, item?.price.id);
  const entitled = ENTITLED.has(sub.status) && paidPlan !== null;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      plan: entitled ? paidPlan : 'free',
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
  });
}
