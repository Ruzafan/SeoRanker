import { randomBytes } from 'node:crypto';
import type Stripe from 'stripe';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, setupTestDatabase } from '@seo/db/testing';
import type { PrismaClient } from '@seo/db';
import { AppError } from '../errors.js';
import { assertQuota } from '../pipeline/quota.js';
import {
  createStripeBilling,
  getBilling,
  handleStripeWebhook,
  openBillingPortal,
  startCheckout,
  type Billing,
  type StripeApi,
} from './billing.js';
import type { CoreDeps } from './deps.js';

const db = await setupTestDatabase('core_billing');
const WEBHOOK_SECRET = 'whsec_test_secret';
const PRICES = { starter: 'price_starter', pro: 'price_pro', agency: 'price_agency' };
// Instancia real solo para firmar/verificar webhooks (no hace peticiones de red).
const realStripe = createStripeBilling('sk_test_dummy', {
  webhookSecret: WEBHOOK_SECRET,
  prices: PRICES,
  webOrigin: 'https://app.test',
  automaticTax: false,
}).api as unknown as Stripe;

function subscription(
  id: string,
  opts: { status: Stripe.Subscription.Status; price: string; customer: string; orgId?: string },
): Stripe.Subscription {
  return {
    id,
    object: 'subscription',
    status: opts.status,
    customer: opts.customer,
    cancel_at_period_end: false,
    metadata: opts.orgId ? { organizationId: opts.orgId } : {},
    items: {
      object: 'list',
      data: [{ id: `si_${id}`, price: { id: opts.price }, current_period_end: 1_900_000_000 }],
    },
  } as unknown as Stripe.Subscription;
}

class FakeStripe implements StripeApi {
  subs = new Map<string, Stripe.Subscription>();
  checkoutParams: Stripe.Checkout.SessionCreateParams[] = [];
  updates: { id: string; params: Stripe.SubscriptionUpdateParams }[] = [];
  customers = {
    create: async () => ({ id: 'cus_new' }),
  };
  checkout = {
    sessions: {
      create: async (params: Stripe.Checkout.SessionCreateParams) => {
        this.checkoutParams.push(params);
        return { url: 'https://checkout.stripe.test/s/1' };
      },
    },
  };
  billingPortal = {
    sessions: { create: async () => ({ url: 'https://billing.stripe.test/p/1' }) },
  };
  subscriptions = {
    retrieve: async (id: string) => {
      const s = this.subs.get(id);
      if (!s) throw new Error(`no sub ${id}`);
      return s;
    },
    update: async (id: string, params: Stripe.SubscriptionUpdateParams) => {
      this.updates.push({ id, params });
      const current = this.subs.get(id);
      if (!current) throw new Error(`no sub ${id}`);
      const price = params.items?.[0]?.price ?? '';
      const next = subscription(id, {
        status: 'active',
        price,
        customer: String(current.customer),
      });
      this.subs.set(id, next);
      return next;
    },
  };
  webhooks = realStripe.webhooks;
}

function signed(event: Record<string, unknown>): { body: Buffer; signature: string } {
  const payload = JSON.stringify(event);
  return {
    body: Buffer.from(payload),
    signature: realStripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }),
  };
}

describe.skipIf(!db)('facturación (Stripe)', () => {
  const prisma = db?.prisma as PrismaClient;
  let stripe: FakeStripe;
  let deps: CoreDeps;

  async function makeOrg(role = 'owner') {
    return prisma.organization.create({
      data: {
        name: 'Tienda',
        users: {
          create: { email: `${randomBytes(4).toString('hex')}@t.es`, passwordHash: 'x', role },
        },
      },
      include: { users: true },
    });
  }

  beforeEach(async () => {
    await resetDatabase(prisma);
    stripe = new FakeStripe();
    const billing: Billing = {
      api: stripe,
      config: {
        webhookSecret: WEBHOOK_SECRET,
        prices: PRICES,
        webOrigin: 'https://app.test/',
        automaticTax: false,
      },
    };
    deps = {
      prisma,
      dispatcher: { enqueue: async () => ({ jobRunId: 'x' }) },
      encryptionKey: randomBytes(32),
      config: { allowPrivateHosts: true, freePlanMaxArticles: 3 },
      billing,
    };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sin Stripe configurado: BILLING_NOT_CONFIGURED y el estado lo indica', async () => {
    const org = await makeOrg();
    const noBilling = { ...deps, billing: undefined };
    await expect(startCheckout(noBilling, org.users[0]!.id, { plan: 'pro' })).rejects.toMatchObject(
      { code: 'BILLING_NOT_CONFIGURED' },
    );
    const dto = await getBilling(noBilling, org.id, org.users[0]!.id);
    expect(dto).toMatchObject({ configured: false, plan: 'free', canManage: true });
    expect(dto.usage).toMatchObject({ articlesLimit: 3, maxSites: 1, members: 1 });
  });

  it('checkout: crea el cliente una vez y devuelve la URL de Stripe', async () => {
    const org = await makeOrg();
    const res = await startCheckout(deps, org.users[0]!.id, { plan: 'pro' });
    expect(res.url).toBe('https://checkout.stripe.test/s/1');
    const params = stripe.checkoutParams[0]!;
    expect(params).toMatchObject({
      mode: 'subscription',
      customer: 'cus_new',
      client_reference_id: org.id,
      line_items: [{ price: 'price_pro', quantity: 1 }],
      success_url: 'https://app.test/billing?checkout=success',
    });
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).stripeCustomerId,
    ).toBe('cus_new');
  });

  it('solo el propietario gestiona la facturación', async () => {
    const org = await makeOrg('member');
    await expect(startCheckout(deps, org.users[0]!.id, { plan: 'pro' })).rejects.toMatchObject({
      code: 'OWNER_REQUIRED',
    });
    await expect(openBillingPortal(deps, org.users[0]!.id)).rejects.toMatchObject({
      code: 'OWNER_REQUIRED',
    });
  });

  it('webhook: firma inválida → VALIDATION_ERROR; evento desconocido se ignora', async () => {
    await expect(handleStripeWebhook(deps, Buffer.from('{}'), 't=1,v1=bad')).rejects.toBeInstanceOf(
      AppError,
    );
    const { body, signature } = signed({
      id: 'evt_0',
      object: 'event',
      type: 'invoice.paid',
      data: { object: {} },
    });
    expect(await handleStripeWebhook(deps, body, signature)).toEqual({ handled: false });
  });

  it('webhook: checkout completado activa el plan; la baja lo devuelve a free', async () => {
    const org = await makeOrg();
    stripe.subs.set(
      'sub_1',
      subscription('sub_1', {
        status: 'active',
        price: 'price_pro',
        customer: 'cus_1',
        orgId: org.id,
      }),
    );
    const done = signed({
      id: 'evt_1',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          object: 'checkout.session',
          subscription: 'sub_1',
          client_reference_id: org.id,
        },
      },
    });
    expect(await handleStripeWebhook(deps, done.body, done.signature)).toEqual({ handled: true });
    let saved = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(saved).toMatchObject({
      plan: 'pro',
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
      subscriptionStatus: 'active',
    });
    expect(saved.currentPeriodEnd?.getTime()).toBe(1_900_000_000_000);

    // Reenviar el mismo evento es inocuo (se relee el estado de Stripe).
    await handleStripeWebhook(deps, done.body, done.signature);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).plan).toBe(
      'pro',
    );

    stripe.subs.set(
      'sub_1',
      subscription('sub_1', {
        status: 'canceled',
        price: 'price_pro',
        customer: 'cus_1',
        orgId: org.id,
      }),
    );
    const deleted = signed({
      id: 'evt_2',
      object: 'event',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', object: 'subscription' } },
    });
    await handleStripeWebhook(deps, deleted.body, deleted.signature);
    saved = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(saved).toMatchObject({ plan: 'free', subscriptionStatus: 'canceled' });
  });

  it('una suscripción antigua cancelada no pisa la vigente', async () => {
    const org = await makeOrg();
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        plan: 'agency',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_new',
        subscriptionStatus: 'active',
      },
    });
    stripe.subs.set(
      'sub_old',
      subscription('sub_old', { status: 'canceled', price: 'price_pro', customer: 'cus_1' }),
    );
    const ev = signed({
      id: 'evt_3',
      object: 'event',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_old', object: 'subscription' } },
    });
    expect(await handleStripeWebhook(deps, ev.body, ev.signature)).toEqual({ handled: false });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).plan).toBe(
      'agency',
    );
  });

  it('con suscripción viva, cambiar de plan actualiza el precio sin pasar por Checkout', async () => {
    const org = await makeOrg();
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        plan: 'starter',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        subscriptionStatus: 'active',
      },
    });
    stripe.subs.set(
      'sub_1',
      subscription('sub_1', { status: 'active', price: 'price_starter', customer: 'cus_1' }),
    );
    const res = await startCheckout(deps, org.users[0]!.id, { plan: 'agency' });
    expect(res.url).toBeNull();
    expect(stripe.updates[0]).toMatchObject({
      id: 'sub_1',
      params: { items: [{ id: 'si_sub_1', price: 'price_agency' }] },
    });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).plan).toBe(
      'agency',
    );
    expect((await openBillingPortal(deps, org.users[0]!.id)).url).toBe(
      'https://billing.stripe.test/p/1',
    );
  });

  it('el tope de artículos es de la organización, sumando todas sus tiendas', async () => {
    const org = await makeOrg();
    const [a, b] = await Promise.all(
      ['a', 'b'].map((n) =>
        prisma.site.create({
          data: { organizationId: org.id, name: n, url: `https://${n}.es`, credentials: '' },
        }),
      ),
    );
    const period = new Date().toISOString().slice(0, 7);
    await prisma.usageRecord.create({ data: { siteId: a!.id, period, articles: 2 } });
    await assertQuota(prisma, b!.id, 'generate_article', { freePlanMaxArticles: 3 });
    await prisma.usageRecord.create({ data: { siteId: b!.id, period, articles: 1 } });
    await expect(
      assertQuota(prisma, b!.id, 'generate_article', { freePlanMaxArticles: 3 }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });
});
