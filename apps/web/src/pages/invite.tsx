import { BookOpenText } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, ErrorBanner, Field, Spinner, inputClass } from '../components/ui';
import { useAcceptInvite, useInvitation } from '../lib/hooks';

const ROLE: Record<string, string> = {
  member: 'como parte del equipo',
  viewer: 'como cliente: podrás ver, comentar y aprobar los artículos',
};

/** Alta de un invitado: el enlace trae el token; solo hay que elegir contraseña. */
export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useInvitation(token);
  const accept = useAcceptInvite();
  const [password, setPassword] = useState('');

  return (
    <div className="grid min-h-screen place-items-center bg-stone-50 px-4 dark:bg-stone-950">
      <Card className="w-full max-w-md">
        <p className="mb-4 flex items-center gap-2 font-semibold">
          <BookOpenText className="h-5 w-5 text-teal-700 dark:text-teal-400" /> SEO Autopilot
        </p>
        {isLoading && <Spinner />}
        <ErrorBanner error={error} />
        {data && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              accept.mutate({ token, password }, { onSuccess: () => navigate('/app') });
            }}
          >
            <p className="text-sm">
              <strong>{data.organizationName}</strong> te invita a unirte {ROLE[data.role] ?? ''}.
            </p>
            <Field label="Email">
              <input className={inputClass} value={data.email} disabled />
            </Field>
            <Field label="Elige una contraseña" hint="Al menos 10 caracteres.">
              <input
                className={inputClass}
                type="password"
                minLength={10}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <ErrorBanner error={accept.error} />
            <Button type="submit" className="w-full" loading={accept.isPending}>
              Crear mi cuenta
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
