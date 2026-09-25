import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { EnqueueInput, JobDispatcher, PipelineJobType } from '@seo/core';
import { resetDatabase, setupTestDatabase } from '@seo/db/testing';
import type { PrismaClient } from '@seo/db';
import { buildApp, LOG_REDACT_PATHS, type AppEnv } from './app.js';
import { loadEnv } from './env.js';

const db = await setupTestDatabase('api');
const ok = async (): Promise<void> => undefined;
const fail = async (): Promise<void> => {
  throw new Error('down');
};

const baseEnv: AppEnv = {
  LOG_LEVEL: 'silent',
  WEB_ORIGIN: 'http://localhost:8080',
  JWT_SECRET: 'x'.repeat(40),
  COOKIE_SECURE: false,
  REGISTRATION_ENABLED: true,
  ADMIN_EMAIL: undefined,
  LOGIN_RATE_LIMIT_MAX: 1000,
};

class FakeDispatcher implements JobDispatcher {
  calls: { type: PipelineJobType; input: EnqueueInput }[] = [];
  constructor(private readonly prisma: PrismaClient) {}
  async enqueue(type: PipelineJobType, input: EnqueueInput) {
    this.calls.push({ type, input });
    const run = await this.prisma.jobRun.create({
      data: { siteId: input.siteId, type, status: 'queued', refId: input.refId ?? null },
    });
    return { jobRunId: run.id };
  }
}

describe('salud, errores y entorno (sin BD)', () => {
  it('GET /health 200 / 503', async () => {
    if (!db) return;
    const mk = async (redis: () => Promise<void>) =>
      buildApp({
        env: baseEnv,
        health: { db: ok, redis },
        core: {
          prisma: db.prisma,
          dispatcher: new FakeDispatcher(db.prisma),
          encryptionKey: randomBytes(32),
          config: { allowPrivateHosts: true, freePlanMaxArticles: 10 },
        },
      });
    const up = await mk(ok);
    await up.ready();
    const res = await request(up.server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { db: 'ok', redis: 'ok' } });
    expect((await request(up.server).get('/api/v1/health')).status).toBe(200);
    expect((await request(up.server).get('/nope')).body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
    await up.close();

    const down = await mk(fail);
    await down.ready();
    const bad = await request(down.server).get('/health');
    expect(bad.status).toBe(503);
    expect(bad.body).toEqual({ status: 'degraded', checks: { db: 'ok', redis: 'error' } });
    await down.close();
  });
});

describe('loadEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://a:b@localhost:5432/x',
    REDIS_URL: 'redis://localhost:6379',
    WEB_ORIGIN: 'http://localhost:8080',
    JWT_SECRET: 'j'.repeat(32),
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
  it('falla listando lo que falta', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL[\s\S]*ENCRYPTION_KEY/);
  });
  it('arranca fallando si ENCRYPTION_KEY no mide 32 bytes', () => {
    expect(() => loadEnv({ ...valid, ENCRYPTION_KEY: randomBytes(16).toString('base64') })).toThrow(
      /32 bytes/,
    );
    expect(() => loadEnv({ ...valid, ENCRYPTION_KEY: '' })).toThrow(/ENCRYPTION_KEY/);
  });
  it('exige JWT_SECRET de 32+ caracteres', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'corto' })).toThrow(/JWT_SECRET/);
  });
  it('trata vacío como no definido y aplica defaults por entorno', () => {
    const dev = loadEnv({ ...valid, ADMIN_EMAIL: '', REGISTRATION_ENABLED: '' });
    expect(dev.ADMIN_EMAIL).toBeUndefined();
    expect(dev.REGISTRATION_ENABLED).toBe(true);
    expect(dev.ALLOW_PRIVATE_HOSTS).toBe(true);
    const prod = loadEnv({ ...valid, NODE_ENV: 'production' });
    expect(prod.COOKIE_SECURE).toBe(true);
    expect(prod.ALLOW_PRIVATE_HOSTS).toBe(false);
  });
});

describe('logs', () => {
  it('redactan authorization, password, credentials y apiKey', () => {
    let out = '';
    const stream = new Writable({
      write(chunk, _enc, cb) {
        out += String(chunk);
        cb();
      },
    });
    const log = pino({ redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' } }, stream);
    log.info({
      req: { headers: { authorization: 'Bearer SECRETO1', cookie: 'token=SECRETO2' } },
      body: {
        password: 'SECRETO3',
        credentials: 'SECRETO4',
        apiKey: 'SECRETO5',
        wpAppPassword: 'SECRETO6',
      },
    });
    expect(out).not.toMatch(/SECRETO/);
    expect(out).toContain('[REDACTED]');
  });
});

describe.skipIf(!db)('API (integración con Postgres)', () => {
  const prisma = db?.prisma as PrismaClient; // solo se usa si db existe (describe.skipIf)
  const PW = 'contraseña-larga-123';
  const WP_SECRET = 'abcd efgh ijkl mnop';
  let app: FastifyInstance;
  let dispatcher: FakeDispatcher;
  let freeLimit = 10;
  let allowPrivate = true;

  async function makeApp(overrides: Partial<AppEnv> = {}) {
    dispatcher = new FakeDispatcher(prisma);
    app = await buildApp({
      env: { ...baseEnv, ...overrides },
      health: { db: ok, redis: ok },
      core: {
        prisma,
        dispatcher,
        encryptionKey: randomBytes(32),
        config: { allowPrivateHosts: allowPrivate, freePlanMaxArticles: freeLimit },
      },
    });
    await app.ready();
  }

  /** Registra un usuario (nueva organización) y devuelve un agente con su cookie de sesión. */
  async function signup(email: string) {
    const agent = request.agent(app.server);
    const res = await agent.post('/api/v1/auth/register').send({ email, password: PW });
    expect(res.status).toBe(201);
    return agent;
  }

  const siteBody = {
    name: 'Mi Tienda',
    url: 'https://tienda.es/',
    language: 'es',
    country: 'ES',
    wpUsername: 'admin',
    wpAppPassword: WP_SECRET,
  };

  beforeEach(async () => {
    await resetDatabase(prisma);
    freeLimit = 10;
    allowPrivate = true;
    if (app) await app.close();
    await makeApp();
  });
  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  describe('auth', () => {
    it('registro, sesión por cookie httpOnly/SameSite=Lax, me y logout', async () => {
      const agent = request.agent(app.server);
      const reg = await agent
        .post('/api/v1/auth/register')
        .send({ email: 'A@Test.com', password: PW });
      expect(reg.status).toBe(201);
      const cookie = String(reg.headers['set-cookie']);
      expect(cookie).toMatch(/token=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(reg.body).toMatchObject({
        email: 'a@test.com',
        role: 'owner',
        plan: 'free',
        isAdmin: false,
      });
      expect(JSON.stringify(reg.body)).not.toMatch(/passwordHash|argon2/);

      expect((await agent.get('/api/v1/auth/me')).body.email).toBe('a@test.com');
      expect((await request(app.server).get('/api/v1/auth/me')).status).toBe(401);

      await agent.post('/api/v1/auth/logout').expect(204);
      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    });

    it('la contraseña se guarda con argon2id', async () => {
      await signup('a@test.com');
      const u = await prisma.user.findFirstOrThrow();
      expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('login: credenciales erróneas → INVALID_CREDENTIALS (misma respuesta con o sin usuario)', async () => {
      await signup('a@test.com');
      const wrongPw = await request(app.server)
        .post('/api/v1/auth/login')
        .send({ email: 'a@test.com', password: 'mal' });
      const noUser = await request(app.server)
        .post('/api/v1/auth/login')
        .send({ email: 'z@test.com', password: 'mal' });
      expect(wrongPw.status).toBe(401);
      expect(wrongPw.body).toEqual(noUser.body);
      expect(wrongPw.body.error.code).toBe('INVALID_CREDENTIALS');
      const good = await request(app.server)
        .post('/api/v1/auth/login')
        .send({ email: 'a@test.com', password: PW });
      expect(good.status).toBe(200);
    });

    it('registro deshabilitado: solo el primer usuario (bootstrap) puede registrarse', async () => {
      await app.close();
      await makeApp({ REGISTRATION_ENABLED: false });
      expect((await request(app.server).get('/api/v1/auth/config')).body).toEqual({
        registrationOpen: true,
      });
      await signup('primero@test.com');
      expect((await request(app.server).get('/api/v1/auth/config')).body).toEqual({
        registrationOpen: false,
      });
      const res = await request(app.server)
        .post('/api/v1/auth/register')
        .send({ email: 'otro@test.com', password: PW });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('REGISTRATION_DISABLED');
    });

    it('email duplicado → EMAIL_TAKEN; validación → VALIDATION_ERROR', async () => {
      await signup('a@test.com');
      const dup = await request(app.server)
        .post('/api/v1/auth/register')
        .send({ email: 'a@test.com', password: PW });
      expect(dup.body.error.code).toBe('EMAIL_TAKEN');
      const bad = await request(app.server)
        .post('/api/v1/auth/register')
        .send({ email: 'no-email', password: 'x' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rate limit estricto en /auth/login', async () => {
      await app.close();
      await makeApp({ LOGIN_RATE_LIMIT_MAX: 3 });
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        statuses.push(
          (
            await request(app.server)
              .post('/api/v1/auth/login')
              .send({ email: 'a@test.com', password: 'x' })
          ).status,
        );
      }
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
      const limited = await request(app.server)
        .post('/api/v1/auth/login')
        .send({ email: 'a@test.com', password: 'x' });
      expect(limited.body.error.code).toBe('RATE_LIMITED');
    });

    it('las rutas de recurso exigen sesión', async () => {
      for (const path of ['/api/v1/sites', '/api/v1/articles/x', '/api/v1/admin/organizations']) {
        expect((await request(app.server).get(path)).status).toBe(401);
      }
    });
  });

  describe('sitios y credenciales', () => {
    it('cifra las credenciales y nunca las devuelve (ni enmascaradas)', async () => {
      const agent = await signup('a@test.com');
      const created = await agent.post('/api/v1/sites').send(siteBody);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        url: 'https://tienda.es',
        hasCredentials: true,
        platform: 'wordpress',
      });
      expect(created.body.settings).toMatchObject({
        wordCount: 1200,
        cadence: 'off',
        autoPublish: false,
      });

      const list = await agent.get('/api/v1/sites');
      const one = await agent.get(`/api/v1/sites/${created.body.id}`);
      const all = JSON.stringify([created.body, list.body, one.body]);
      expect(all).not.toContain(WP_SECRET);
      expect(all).not.toContain('admin');
      expect(all).not.toMatch(/credentials"/);

      const row = await prisma.site.findFirstOrThrow();
      expect(row.credentials).toMatch(/^v1\./);
      expect(row.credentials).not.toContain(WP_SECRET);
    });

    it('PATCH: mezcla settings, rota credenciales y mantiene lo demás', async () => {
      const agent = await signup('a@test.com');
      const { body: site } = await agent.post('/api/v1/sites').send(siteBody);
      const before = (await prisma.site.findFirstOrThrow()).credentials;
      const res = await agent.patch(`/api/v1/sites/${site.id}`).send({
        settings: { seeds: ['figuras', 'coleccionables'], cadence: 'daily', wordCount: 1500 },
        brandVoice: 'Cercano y experto',
      });
      expect(res.status).toBe(200);
      expect(res.body.settings).toMatchObject({
        seeds: ['figuras', 'coleccionables'],
        cadence: 'daily',
        wordCount: 1500,
        autoPublish: false,
      });
      expect(res.body.brandVoice).toBe('Cercano y experto');
      expect((await prisma.site.findFirstOrThrow()).credentials).toBe(before);

      await agent
        .patch(`/api/v1/sites/${site.id}`)
        .send({ wpAppPassword: 'nueva-password-123' })
        .expect(200);
      expect((await prisma.site.findFirstOrThrow()).credentials).not.toBe(before);
    });

    it('valida settings (wordCount fuera de rango, cadencia inválida)', async () => {
      const agent = await signup('a@test.com');
      const { body: site } = await agent.post('/api/v1/sites').send(siteBody);
      const r1 = await agent
        .patch(`/api/v1/sites/${site.id}`)
        .send({ settings: { wordCount: 50 } });
      const r2 = await agent
        .patch(`/api/v1/sites/${site.id}`)
        .send({ settings: { cadence: 'cada-hora' } });
      expect([r1.status, r2.status]).toEqual([400, 400]);
    });

    it('SSRF: rechaza localhost e IPs privadas en producción', async () => {
      allowPrivate = false;
      await app.close();
      await makeApp();
      const agent = await signup('a@test.com');
      for (const url of [
        'http://localhost',
        'http://127.0.0.1:8080',
        'http://192.168.1.10',
        'http://169.254.169.254/latest',
      ]) {
        const res = await agent.post('/api/v1/sites').send({ ...siteBody, url });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_URL');
      }
    });

    it('DELETE borra el sitio y sus datos en cascada', async () => {
      const agent = await signup('a@test.com');
      const { body: site } = await agent.post('/api/v1/sites').send(siteBody);
      await agent.post(`/api/v1/sites/${site.id}/keywords`).send({ terms: ['uno dos'] });
      await agent.delete(`/api/v1/sites/${site.id}`).expect(204);
      expect(await prisma.keyword.count()).toBe(0);
      expect((await agent.get(`/api/v1/sites/${site.id}`)).status).toBe(404);
    });

    it('test-connection sin credenciales devuelve el código NO_CREDENTIALS', async () => {
      const agent = await signup('a@test.com');
      const { body: site } = await agent.post('/api/v1/sites').send(siteBody);
      await prisma.site.update({ where: { id: site.id }, data: { credentials: '' } });
      const res = await agent.post(`/api/v1/sites/${site.id}/test-connection`);
      expect(res.body).toMatchObject({ ok: false, message: 'NO_CREDENTIALS' });
    });
  });

  describe('keywords, artículos y colas', () => {
    async function setup() {
      const agent = await signup('a@test.com');
      const { body: site } = await agent.post('/api/v1/sites').send(siteBody);
      return { agent, site };
    }

    it('alta manual (normaliza y omite duplicados), listado con filtros y orden', async () => {
      const { agent, site } = await setup();
      const res = await agent
        .post(`/api/v1/sites/${site.id}/keywords`)
        .send({ terms: ['Figuras  Anime', 'figuras anime', 'peluches'] });
      expect(res.body).toEqual({ created: 2, skipped: 0 });
      const again = await agent
        .post(`/api/v1/sites/${site.id}/keywords`)
        .send({ terms: ['peluches'] });
      expect(again.body).toEqual({ created: 0, skipped: 1 });

      const list = await agent.get(`/api/v1/sites/${site.id}/keywords?search=ANIME`);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0]).toMatchObject({
        term: 'figuras anime',
        status: 'pending',
        source: 'manual',
      });
    });

    it('generate encola outline, no permite repetir y descarta en lote', async () => {
      const { agent, site } = await setup();
      await agent.post(`/api/v1/sites/${site.id}/keywords`).send({ terms: ['uno uno', 'dos dos'] });
      const kws = (await agent.get(`/api/v1/sites/${site.id}/keywords`)).body.items as {
        id: string;
        term: string;
      }[];
      const first = kws[0]!;

      const gen = await agent.post(`/api/v1/keywords/${first.id}/generate`);
      expect(gen.status).toBe(202);
      expect(gen.body.jobRunId).toBeTruthy();
      expect(dispatcher.calls[0]).toMatchObject({
        type: 'outline',
        input: { siteId: site.id, refId: first.id, chain: 'ready' },
      });
      expect((await prisma.keyword.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(
        'queued',
      );
      const again = await agent.post(`/api/v1/keywords/${first.id}/generate`);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('INVALID_STATE');

      const batch = await agent
        .post(`/api/v1/sites/${site.id}/keywords/batch`)
        .send({ ids: kws.map((k) => k.id), action: 'discard' });
      expect(batch.body).toEqual({ processed: 1, skipped: 1 }); // la encolada no se descarta
    });

    it('cuota del plan free: QUOTA_EXCEEDED (402) al llegar al tope', async () => {
      freeLimit = 1;
      await app.close();
      await makeApp();
      const { agent, site } = await setup();
      await agent.post(`/api/v1/sites/${site.id}/keywords`).send({ terms: ['aa aa', 'bb bb'] });
      const kws = (await agent.get(`/api/v1/sites/${site.id}/keywords`)).body.items as {
        id: string;
      }[];
      expect((await agent.post(`/api/v1/keywords/${kws[0]!.id}/generate`)).status).toBe(202);
      const blocked = await agent.post(`/api/v1/keywords/${kws[1]!.id}/generate`);
      expect(blocked.status).toBe(402);
      expect(blocked.body.error.code).toBe('QUOTA_EXCEEDED');
      expect((await prisma.keyword.findUniqueOrThrow({ where: { id: kws[1]!.id } })).status).toBe(
        'pending',
      );
    });

    it('discover encola sin seeds (se deducen del contenido); analyze-voice encola', async () => {
      const { agent, site } = await setup();
      expect((await agent.post(`/api/v1/sites/${site.id}/keywords/discover`)).status).toBe(202);
      await agent.patch(`/api/v1/sites/${site.id}`).send({ settings: { seeds: ['figuras'] } });
      expect((await agent.post(`/api/v1/sites/${site.id}/keywords/discover`)).status).toBe(202);
      expect((await agent.post(`/api/v1/sites/${site.id}/analyze-voice`)).status).toBe(202);
      expect(dispatcher.calls.map((c) => c.type)).toEqual(['discover', 'discover', 'brand-voice']);
    });

    it('artículos: edición saneada, publicar/regenerar encolan y respetan estados', async () => {
      const { agent, site } = await setup();
      const article = await prisma.article.create({
        data: {
          siteId: site.id,
          title: 'T',
          slug: 't',
          status: 'ready',
          contentHtml: '<p>x</p>',
          outline: { sections: [] },
        },
      });

      const patched = await agent.patch(`/api/v1/articles/${article.id}`).send({
        title: 'Nuevo título',
        metaDescription: 'Meta',
        contentHtml: '<h1>Hola</h1><script>alert(1)</script><p>uno dos tres</p>',
      });
      expect(patched.status).toBe(200);
      expect(patched.body.contentHtml).toBe('<h2>Hola</h2><p>uno dos tres</p>');
      expect(patched.body.wordCount).toBe(4);
      expect(
        (await agent.patch(`/api/v1/articles/${article.id}`).send({ slug: 'Slug Malo' })).status,
      ).toBe(400);

      const pub = await agent.post(`/api/v1/articles/${article.id}/publish`);
      expect(pub.status).toBe(202);
      expect(dispatcher.calls.at(-1)).toMatchObject({
        type: 'publish',
        input: { refId: article.id },
      });
      expect((await agent.post(`/api/v1/articles/${article.id}/publish`)).status).toBe(409); // ya publicándose
      expect(
        (await agent.patch(`/api/v1/articles/${article.id}`).send({ title: 'x' })).status,
      ).toBe(409);

      await prisma.article.update({ where: { id: article.id }, data: { status: 'ready' } });
      const regen = await agent.post(`/api/v1/articles/${article.id}/regenerate`);
      expect(regen.status).toBe(202);
      expect(dispatcher.calls.at(-1)).toMatchObject({ type: 'write' });
      expect(
        (await prisma.article.findUniqueOrThrow({ where: { id: article.id } })).contentHtml,
      ).toBeNull();
    });

    it('jobs, uso y stats reflejan solo datos reales', async () => {
      const { agent, site } = await setup();
      const stats0 = (await agent.get(`/api/v1/sites/${site.id}/stats`)).body;
      expect(stats0).toMatchObject({
        publishedThisMonth: 0,
        pendingKeywords: 0,
        inProgress: 0,
        recentJobs: [],
      });
      expect(stats0.usage).toMatchObject({
        articles: 0,
        costCents: 0,
        plan: 'free',
        articlesLimit: 10,
      });

      await agent.post(`/api/v1/sites/${site.id}/keywords`).send({ terms: ['algo raro'] });
      const kw = (await agent.get(`/api/v1/sites/${site.id}/keywords`)).body.items[0];
      await agent.post(`/api/v1/keywords/${kw.id}/generate`);
      const jobs = await agent.get(`/api/v1/sites/${site.id}/jobs`);
      expect(jobs.body.total).toBe(1);
      expect(jobs.body.items[0]).toMatchObject({ type: 'outline', status: 'queued' });
      expect((await agent.get(`/api/v1/sites/${site.id}/stats`)).body.inProgress).toBeGreaterThan(
        0,
      );
    });
  });

  describe('aislamiento entre organizaciones (Fase 7)', () => {
    it('otra organización recibe 404 en TODAS las rutas de datos ajenos y no ve nada en los listados', async () => {
      const a = await signup('a@test.com');
      const b = await signup('b@test.com');
      const { body: site } = await a.post('/api/v1/sites').send(siteBody);
      await a.post(`/api/v1/sites/${site.id}/keywords`).send({ terms: ['privada uno'] });
      const kw = (await a.get(`/api/v1/sites/${site.id}/keywords`)).body.items[0];
      const article = await prisma.article.create({
        data: {
          siteId: site.id,
          keywordId: kw.id,
          title: 'Secreto',
          slug: 's',
          status: 'ready',
          contentHtml: '<p>x</p>',
          outline: {},
        },
      });

      const attempts: [string, string, unknown?][] = [
        ['get', `/api/v1/sites/${site.id}`],
        ['patch', `/api/v1/sites/${site.id}`, { name: 'hack' }],
        ['delete', `/api/v1/sites/${site.id}`],
        ['post', `/api/v1/sites/${site.id}/test-connection`],
        ['post', `/api/v1/sites/${site.id}/analyze-voice`],
        ['get', `/api/v1/sites/${site.id}/keywords`],
        ['post', `/api/v1/sites/${site.id}/keywords`, { terms: ['intruso'] }],
        ['post', `/api/v1/sites/${site.id}/keywords/discover`],
        ['post', `/api/v1/sites/${site.id}/keywords/batch`, { ids: [kw.id], action: 'discard' }],
        ['patch', `/api/v1/keywords/${kw.id}`, { status: 'discarded' }],
        ['delete', `/api/v1/keywords/${kw.id}`],
        ['post', `/api/v1/keywords/${kw.id}/generate`],
        ['get', `/api/v1/sites/${site.id}/articles`],
        ['get', `/api/v1/articles/${article.id}`],
        ['patch', `/api/v1/articles/${article.id}`, { title: 'hack' }],
        ['delete', `/api/v1/articles/${article.id}`],
        ['post', `/api/v1/articles/${article.id}/publish`],
        ['post', `/api/v1/articles/${article.id}/regenerate`],
        ['get', `/api/v1/sites/${site.id}/jobs`],
        ['get', `/api/v1/sites/${site.id}/usage`],
        ['get', `/api/v1/sites/${site.id}/stats`],
      ];
      for (const [method, path, body] of attempts) {
        const res = await (b as unknown as Record<string, (p: string) => request.Test>)[method]!(
          path,
        ).send(body as object);
        expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
        expect(JSON.stringify(res.body)).not.toMatch(/privada|Secreto|Mi Tienda/);
      }
      expect((await b.get('/api/v1/sites')).body).toEqual([]);

      // Y nada cambió en la organización propietaria.
      expect(await prisma.keyword.count()).toBe(1);
      expect((await prisma.site.findUniqueOrThrow({ where: { id: site.id } })).name).toBe(
        'Mi Tienda',
      );
      expect(dispatcher.calls).toHaveLength(0);

      // Cada organización ve lo suyo.
      const { body: siteB } = await b.post('/api/v1/sites').send({ ...siteBody, name: 'Sitio B' });
      expect((await b.get('/api/v1/sites')).body.map((s: { name: string }) => s.name)).toEqual([
        'Sitio B',
      ]);
      expect((await a.get(`/api/v1/sites/${siteB.id}`)).status).toBe(404);
    });
  });

  describe('vista de administración', () => {
    it('solo ADMIN_EMAIL la ve (404 para el resto) y no expone credenciales', async () => {
      await app.close();
      await makeApp({ ADMIN_EMAIL: 'admin@test.com' });
      const admin = await signup('admin@test.com');
      const user = await signup('user@test.com');
      await user.post('/api/v1/sites').send(siteBody);

      expect((await user.get('/api/v1/admin/organizations')).status).toBe(404);
      expect((await user.get('/api/v1/auth/me')).body.isAdmin).toBe(false);
      expect((await admin.get('/api/v1/auth/me')).body.isAdmin).toBe(true);

      const res = await admin.get('/api/v1/admin/organizations');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const withSite = res.body.find((o: { sites: unknown[] }) => o.sites.length === 1);
      expect(withSite.users[0].email).toBe('user@test.com');
      expect(withSite.sites[0]).toMatchObject({ name: 'Mi Tienda', articles: 0, keywords: 0 });
      expect(JSON.stringify(res.body)).not.toMatch(/credentials|passwordHash|abcd/);
    });

    it('sin ADMIN_EMAIL configurado nadie accede', async () => {
      const a = await signup('a@test.com');
      expect((await a.get('/api/v1/admin/organizations')).status).toBe(404);
    });
  });
});
