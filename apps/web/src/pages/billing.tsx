import { Check, CreditCard, ExternalLink } from 'lucide-react';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PAID_PLAN_IDS, PLANS, isPaidPlanId, type PlanId } from '@seo/shared';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Notice,
  PageHeader,
  Spinner,
  cx,
} from '../components/ui';
import { formatDate } from '../lib/format';
import { useBilling, useBillingPortal, useCheckout, withToast } from '../lib/hooks';

const STATUS_LABEL: Record<string, string> = {
  active: 'Activa',
  trialing: 'En prueba',
  past_due: 'Pago pendiente',
  canceled: 'Cancelada',
  unpaid: 'Impagada',
  incomplete: 'Incompleta',
  incomplete_expired: 'Caducada',
  paused: 'Pausada',
};

const ORDER: PlanId[] = ['free', 'starter', 'pro', 'agency'];

export function BillingPage() {
  const { data, isLoading, error } = useBilling();
  const checkout = useCheckout();
  const portal = useBillingPortal();
  const [params, setParams] = useSearchParams();

  // Vuelta de Stripe Checkout: el plan lo activa el webhook, que puede tardar unos segundos.
  useEffect(() => {
    const result = params.get('checkout');
    if (!result) return;
    if (result === 'success') toast.success('Pago completado. Tu plan se activa en unos segundos.');
    setParams({}, { replace: true });
  }, [params, setParams]);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBanner error={error} />;

  const current = PLANS[ORDER.includes(data.plan as PlanId) ? (data.plan as PlanId) : 'free'];
  const u = data.usage;

  return (
    <>
      <PageHeader
        title="Plan y facturación"
        description="Los límites son de toda la cuenta: los artículos del mes se suman entre todas tus tiendas."
        actions={
          data.hasCustomer &&
          data.canManage &&
          data.configured && (
            <Button
              variant="secondary"
              icon={ExternalLink}
              loading={portal.isPending}
              onClick={() => void withToast(portal.mutateAsync())}
            >
              Facturas y método de pago
            </Button>
          )
        }
      />

      {!data.configured && (
        <div className="mb-4">
          <Notice tone="blue" title="Los pagos aún no están activados en este servidor">
            El administrador debe configurar Stripe. Mientras tanto puedes usar el plan actual.
          </Notice>
        </div>
      )}
      {data.status === 'past_due' && (
        <div className="mb-4">
          <Notice title="No se pudo cobrar la última factura">
            Actualiza tu método de pago para no perder el plan {current.name}.
          </Notice>
        </div>
      )}
      {!data.canManage && (
        <div className="mb-4">
          <Notice tone="blue" title="Solo el propietario de la cuenta puede cambiar el plan" />
        </div>
      )}

      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">Plan actual</p>
            <p className="flex items-center gap-2 text-lg font-semibold">
              {current.name}
              {data.status && (
                <Badge tone={data.status === 'active' ? 'green' : 'amber'}>
                  {STATUS_LABEL[data.status] ?? data.status}
                </Badge>
              )}
            </p>
            {data.currentPeriodEnd && (
              <p className="text-xs text-stone-500">
                {data.cancelAtPeriodEnd ? 'Termina el ' : 'Se renueva el '}
                {formatDate(data.currentPeriodEnd)}
              </p>
            )}
          </div>
          <UsageMeter label="Artículos este mes" used={u.articles} limit={u.articlesLimit} />
          <UsageMeter label="Tiendas" used={u.sites} limit={u.maxSites} />
          <UsageMeter label="Usuarios" used={u.members} limit={u.maxMembers} />
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {ORDER.map((id) => {
          const p = PLANS[id];
          const isCurrent = id === current.id;
          return (
            <Card
              key={id}
              className={cx('flex flex-col', isCurrent && 'border-teal-600 dark:border-teal-500')}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{p.name}</h2>
                {isCurrent && <Badge tone="green">Tu plan</Badge>}
              </div>
              <p className="mt-2">
                <span className="text-3xl font-semibold tabular-nums">{p.priceEur} €</span>
                <span className="text-sm text-stone-500"> /mes + IVA</span>
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                    {f}
                  </li>
                ))}
              </ul>
              {isPaidPlanId(id) && !isCurrent && (
                <Button
                  className="mt-5"
                  icon={CreditCard}
                  variant={id === 'pro' ? 'primary' : 'secondary'}
                  disabled={!data.configured || !data.canManage}
                  loading={checkout.isPending && checkout.variables === id}
                  onClick={() =>
                    void withToast(
                      checkout.mutateAsync(id),
                      data.status === 'active' ? `Plan cambiado a ${p.name}` : undefined,
                    )
                  }
                >
                  {PAID_PLAN_IDS.indexOf(id) < PAID_PLAN_IDS.indexOf(current.id as never)
                    ? `Bajar a ${p.name}`
                    : `Pasar a ${p.name}`}
                </Button>
              )}
              {id === 'free' && !isCurrent && data.hasCustomer && (
                <p className="mt-5 text-xs text-stone-500">
                  Para volver a Free, cancela la suscripción desde «Facturas y método de pago».
                </p>
              )}
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-stone-500">
        Pago seguro con Stripe. Los cambios de plan se prorratean; puedes cancelar cuando quieras y
        mantienes el plan hasta el final del periodo pagado.
      </p>
    </>
  );
}

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : Math.min(100, (used / Math.max(1, limit)) * 100);
  return (
    <div className="min-w-[9rem]">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="font-semibold tabular-nums">
        {used} <span className="text-sm font-normal text-stone-500">/ {limit ?? '∞'}</span>
      </p>
      {limit !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
          <div
            className={cx('h-full rounded-full', pct >= 100 ? 'bg-red-600' : 'bg-teal-600')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
