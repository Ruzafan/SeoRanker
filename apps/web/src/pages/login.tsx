import { zodResolver } from '@hookform/resolvers/zod';
import { BookOpenText } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router-dom';
import { loginSchema, registerSchema, type LoginInput, type RegisterInput } from '@seo/shared';
import { Button, ErrorBanner, Field, inputClass } from '../components/ui';
import { ThemeToggle } from '../components/theme';
import { useAuthConfig, useLogin, useMe, useRegister } from '../lib/hooks';

function LoginForm() {
  const login = useLogin();
  const navigate = useNavigate();
  const { register, handleSubmit, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });
  const { errors } = formState;
  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((v) => login.mutate(v, { onSuccess: () => navigate('/') }))}
    >
      <Field label="Email" error={errors.email?.message}>
        <input type="email" autoComplete="username" className={inputClass} {...register('email')} />
      </Field>
      <Field label="Contraseña" error={errors.password?.message}>
        <input
          type="password"
          autoComplete="current-password"
          className={inputClass}
          {...register('password')}
        />
      </Field>
      <ErrorBanner error={login.error} />
      <Button type="submit" loading={login.isPending} className="w-full">
        Entrar
      </Button>
    </form>
  );
}

function RegisterForm() {
  const reg = useRegister();
  const navigate = useNavigate();
  const { register, handleSubmit, formState } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
  });
  const { errors } = formState;
  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((v) => reg.mutate(v, { onSuccess: () => navigate('/') }))}
    >
      <Field label="Email" error={errors.email?.message}>
        <input type="email" autoComplete="username" className={inputClass} {...register('email')} />
      </Field>
      <Field label="Contraseña" hint="Mínimo 10 caracteres." error={errors.password?.message}>
        <input
          type="password"
          autoComplete="new-password"
          className={inputClass}
          {...register('password')}
        />
      </Field>
      <Field label="Nombre de tu organización (opcional)" error={errors.organizationName?.message}>
        <input
          className={inputClass}
          {...register('organizationName', { setValueAs: (v: string) => v || undefined })}
        />
      </Field>
      <ErrorBanner error={reg.error} />
      <Button type="submit" loading={reg.isPending} className="w-full">
        Crear cuenta
      </Button>
    </form>
  );
}

export function LoginPage() {
  const { data: me } = useMe();
  const { data: config } = useAuthConfig();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  if (me) return <Navigate to="/" replace />;
  const canRegister = config?.registrationOpen === true;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <BookOpenText className="h-8 w-8 text-teal-700 dark:text-teal-400" />
          <h1 className="text-xl font-semibold tracking-tight">SEO Autopilot</h1>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            {mode === 'login' ? 'Inicia sesión para continuar' : 'Crea tu cuenta'}
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
          {mode === 'login' || !canRegister ? <LoginForm /> : <RegisterForm />}
        </div>
        {canRegister && (
          <p className="mt-4 text-center text-sm text-stone-600 dark:text-stone-400">
            {mode === 'login' ? '¿Primera vez?' : '¿Ya tienes cuenta?'}{' '}
            <button
              type="button"
              className="font-medium text-teal-700 hover:underline dark:text-teal-400"
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? 'Crear cuenta' : 'Iniciar sesión'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
