import { Copy, Palette, Trash2, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Notice,
  PageHeader,
  Spinner,
  inputClass,
} from '../components/ui';
import {
  useBranding,
  useChangeRole,
  useInvite,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useUpdateBranding,
  withToast,
} from '../lib/hooks';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario',
  member: 'Equipo',
  viewer: 'Cliente (solo lectura y aprobación)',
};

export function OrganizationPage() {
  const { data, isLoading, error } = useMembers();
  const invite = useInvite();
  const revoke = useRevokeInvite();
  const changeRole = useChangeRole();
  const remove = useRemoveMember();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'viewer'>('viewer');
  const [link, setLink] = useState<string | null>(null);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBanner error={error} />;
  const used = data.members.length + data.invitations.length;

  return (
    <>
      <PageHeader
        title="Equipo y clientes"
        description="Invita a tu equipo o a tus clientes. Un cliente ve los artículos, comenta y los aprueba, pero no puede cambiar nada más."
      />
      <Card className="mb-6">
        <h2 className="flex items-center gap-2 font-medium">
          <Users className="h-4 w-4" /> Usuarios{' '}
          <span className="text-sm font-normal text-stone-500">
            {used}/{data.maxMembers ?? '∞'}
          </span>
        </h2>
        <ul className="mt-3 divide-y divide-stone-100 dark:divide-stone-800">
          {data.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {m.email} {m.isYou && <Badge>tú</Badge>}
              </span>
              {data.canManage && m.role !== 'owner' ? (
                <>
                  <select
                    className={`${inputClass} w-auto`}
                    value={m.role}
                    onChange={(e) =>
                      void withToast(
                        changeRole.mutateAsync({
                          id: m.id,
                          role: e.target.value as 'member' | 'viewer',
                        }),
                        'Rol cambiado',
                      )
                    }
                  >
                    <option value="member">{ROLE_LABEL.member}</option>
                    <option value="viewer">{ROLE_LABEL.viewer}</option>
                  </select>
                  <Button
                    variant="ghost"
                    icon={Trash2}
                    aria-label={`Quitar a ${m.email}`}
                    onClick={() =>
                      window.confirm(`¿Quitar a ${m.email}?`) &&
                      void withToast(remove.mutateAsync(m.id), 'Usuario quitado')
                    }
                  />
                </>
              ) : (
                <Badge tone={m.role === 'owner' ? 'blue' : 'neutral'}>
                  {ROLE_LABEL[m.role] ?? m.role}
                </Badge>
              )}
            </li>
          ))}
          {data.invitations.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-center gap-2 py-2 text-sm text-stone-500"
            >
              <span className="min-w-0 flex-1 truncate">
                {i.email} <Badge tone="amber">Invitación pendiente</Badge>
              </span>
              <span className="text-xs">{ROLE_LABEL[i.role]}</span>
              {data.canManage && (
                <Button
                  variant="ghost"
                  onClick={() => void withToast(revoke.mutateAsync(i.id), 'Invitación anulada')}
                >
                  Anular
                </Button>
              )}
            </li>
          ))}
        </ul>

        {data.canManage && (
          <form
            className="mt-4 flex flex-col gap-2 border-t border-stone-100 pt-4 dark:border-stone-800 sm:flex-row"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await withToast(invite.mutateAsync({ email, role }));
              if (r) {
                setLink(r.url);
                setEmail('');
              }
            }}
          >
            <input
              className={inputClass}
              type="email"
              required
              placeholder="email@cliente.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select
              className={`${inputClass} sm:w-64`}
              value={role}
              onChange={(e) => setRole(e.target.value as 'member' | 'viewer')}
            >
              <option value="viewer">{ROLE_LABEL.viewer}</option>
              <option value="member">{ROLE_LABEL.member}</option>
            </select>
            <Button type="submit" icon={UserPlus} loading={invite.isPending}>
              Invitar
            </Button>
          </form>
        )}
        {link && (
          <div className="mt-3">
            <Notice tone="green" title="Invitación creada: envía este enlace (caduca en 7 días)">
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate">{link}</code>
                <Button
                  variant="secondary"
                  icon={Copy}
                  onClick={() =>
                    void navigator.clipboard.writeText(link).then(() => toast.success('Copiado'))
                  }
                >
                  Copiar
                </Button>
              </div>
            </Notice>
          </div>
        )}
        {used >= (data.maxMembers ?? Infinity) && (
          <p className="mt-3 text-xs text-stone-500">
            Has llegado al límite de usuarios de tu plan.{' '}
            <Link to="/billing" className="text-teal-700 underline dark:text-teal-400">
              Ampliar
            </Link>
          </p>
        )}
      </Card>
      <BrandingCard canManage={data.canManage} />
    </>
  );
}

function BrandingCard({ canManage }: { canManage: boolean }) {
  const { data } = useBranding();
  const update = useUpdateBranding();
  const [name, setName] = useState('');
  const [logo, setLogo] = useState('');
  const [color, setColor] = useState('#0f766e');
  useEffect(() => {
    if (!data) return;
    setName(data.brandName ?? '');
    setLogo(data.brandLogoUrl ?? '');
    setColor(data.brandColor ?? '#0f766e');
  }, [data]);
  if (!data) return null;
  return (
    <Card>
      <h2 className="flex items-center gap-2 font-medium">
        <Palette className="h-4 w-4" /> Marca de los informes
      </h2>
      {!data.whiteLabel ? (
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          Los informes marca blanca (tu logo, tu nombre y tu color, sin mencionar SEO Autopilot)
          están en el plan Agency.{' '}
          <Link to="/billing" className="text-teal-700 underline dark:text-teal-400">
            Ver planes
          </Link>
        </p>
      ) : (
        <form
          className="mt-3 grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            void withToast(
              update.mutateAsync({
                brandName: name.trim() || null,
                brandLogoUrl: logo.trim() || null,
                brandColor: color,
              }),
              'Marca guardada',
            );
          }}
        >
          <Field label="Nombre de la agencia">
            <input
              className={inputClass}
              value={name}
              disabled={!canManage}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="URL del logo (https)">
            <input
              className={inputClass}
              value={logo}
              disabled={!canManage}
              onChange={(e) => setLogo(e.target.value)}
            />
          </Field>
          <Field label="Color principal">
            <input
              type="color"
              className="h-10 w-full rounded-lg"
              value={color}
              disabled={!canManage}
              onChange={(e) => setColor(e.target.value)}
            />
          </Field>
          {canManage && (
            <div className="sm:col-span-3">
              <Button type="submit" loading={update.isPending}>
                Guardar marca
              </Button>
            </div>
          )}
        </form>
      )}
    </Card>
  );
}
