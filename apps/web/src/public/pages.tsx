import { Check, Info, ShoppingCart, X } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { PrimaryCta, PublicLayout, SectionTitle } from '../components/public-layout';
import { Badge } from '../components/ui';
import { COMPARISONS, VERTICALS } from './content';

const prose =
  'space-y-4 text-[17px] leading-relaxed text-stone-800 dark:text-stone-200 [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_a]:text-teal-700 [&_a]:underline dark:[&_a]:text-teal-400 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6';

function CtaBox() {
  return (
    <div className="mt-12 rounded-2xl bg-teal-800 p-8 text-center text-white dark:bg-teal-900">
      <p className="text-xl font-semibold">Artículos así para tu tienda, cada semana</p>
      <p className="mx-auto mt-2 max-w-lg text-teal-100">
        Conecta tu WooCommerce: el primero estará listo en minutos, con tu voz y tus productos.
      </p>
      <div className="mt-5 flex justify-center">
        <PrimaryCta />
      </div>
    </div>
  );
}

/** Ejemplo del tipo de artículo que produce el pipeline (tienda ficticia). */
export function ExampleArticlePage() {
  return (
    <PublicLayout>
      <article className="mx-auto max-w-3xl px-4 py-12">
        <div className="mb-6 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Artículo de ejemplo para una tienda ficticia de figuras de colección. Muestra lo que
            incluye cada artículo: estructura basada en lo que ya posiciona, experiencia del
            negocio, tabla comparativa, recomendación de producto y preguntas frecuentes con datos
            estructurados.
          </p>
        </div>
        <p className="text-sm text-stone-500">Keyword: «cómo limpiar figuras de resina»</p>
        <h1 className="mt-2 text-4xl font-semibold leading-tight tracking-tight">
          Cómo limpiar figuras de resina sin dañar la pintura
        </h1>
        <div className={`mt-8 ${prose}`}>
          <p>
            La resina capta el polvo con facilidad y su pintura es más delicada de lo que parece: un
            paño áspero o un producto con alcohol pueden levantar el acabado en segundos. La buena
            noticia es que basta con tres herramientas y cinco minutos al mes.
          </p>
          <p>
            En nuestra tienda revisamos cada figura antes de enviarla, y la duda que más nos llega
            después de la compra es justo esta: cómo mantenerla como el primer día.
          </p>
          <h2>Qué necesitas para limpiar una figura de resina</h2>
          <ul>
            <li>
              <strong>Pincel de cerdas suaves</strong> (de maquillaje o de pintura acrílica): para
              el polvo de los detalles.
            </li>
            <li>
              <strong>Pera de aire</strong>: sopla sin tocar la pintura.
            </li>
            <li>
              <strong>Paño de microfibra</strong> ligeramente húmedo, solo para superficies lisas.
            </li>
          </ul>
          <h2>Paso a paso</h2>
          <ol>
            <li>Retira el polvo suelto con la pera de aire, de arriba abajo.</li>
            <li>Pasa el pincel por pliegues, pelo y accesorios, sin presionar.</li>
            <li>
              Si hay manchas en zonas lisas, usa la microfibra con agua tibia y una gota de jabón
              neutro, y seca al momento.
            </li>
            <li>Deja la figura al aire diez minutos antes de volver a la vitrina.</li>
          </ol>
          <h2>Qué método usar según el tipo de suciedad</h2>
          <p>
            No todo se limpia igual. Esta tabla resume qué hacer en cada caso sin arriesgar el
            acabado:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-stone-300 dark:border-stone-700">
                  <th className="py-2 pr-4">Suciedad</th>
                  <th className="py-2 pr-4">Método</th>
                  <th className="py-2">Evita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                <tr>
                  <td className="py-2 pr-4">Polvo reciente</td>
                  <td className="py-2 pr-4">Pera de aire y pincel</td>
                  <td className="py-2">Plumeros con fibras sueltas</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Grasa de dedos</td>
                  <td className="py-2 pr-4">Microfibra con agua y jabón neutro</td>
                  <td className="py-2">Alcohol y limpiacristales</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Polvo incrustado</td>
                  <td className="py-2 pr-4">Pincel humedecido, pieza a pieza</td>
                  <td className="py-2">Sumergir la figura</td>
                </tr>
              </tbody>
            </table>
          </div>
          <h2>Cómo evitar que vuelva a llenarse de polvo</h2>
          <p>
            La forma más eficaz de reducir la limpieza es exponerla cerrada y lejos del sol directo,
            que además amarillea la resina con el tiempo. Una vitrina con cierre reduce el polvo de
            forma notable.
          </p>
          <div className="not-prose flex items-center gap-4 rounded-xl border border-stone-200 p-4 dark:border-stone-800">
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-lg bg-stone-100 text-3xl dark:bg-stone-800">
              🗄️
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Vitrina LED para figuras (ejemplo)</p>
              <p className="text-sm text-stone-500">Tarjeta de producto de tu tienda</p>
              <p className="mt-1 font-semibold">59,90 €</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white">
              <ShoppingCart className="h-4 w-4" /> Añadir
            </span>
          </div>
          <h2>Preguntas frecuentes</h2>
          <h3>¿Puedo usar alcohol para limpiar una figura de resina?</h3>
          <p>No. El alcohol disuelve muchos barnices y pinturas y deja zonas mates o manchas.</p>
          <h3>¿Cada cuánto hay que limpiarlas?</h3>
          <p>
            Fuera de vitrina, una vez al mes con pera y pincel. Dentro de una vitrina cerrada, cada
            varios meses suele bastar.
          </p>
        </div>
        <p className="mt-10 text-sm text-stone-500">
          En tu tienda, las preguntas frecuentes se publican también como datos estructurados
          (FAQPage) y la tarjeta de producto muestra el precio y el botón de compra reales.
        </p>
        <CtaBox />
      </article>
    </PublicLayout>
  );
}

export function ComparisonPage() {
  const { slug } = useParams();
  const c = COMPARISONS.find((x) => x.slug === slug);
  if (!c) return <Navigate to="/" replace />;
  return (
    <PublicLayout>
      <article className="mx-auto max-w-4xl px-4 py-14">
        <Badge tone="blue">Comparativa</Badge>
        <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight">{c.title}</h1>
        <p className="mt-4 text-lg text-stone-600 dark:text-stone-400">{c.intro}</p>
        <div className="mt-10 overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800">
              <tr>
                <th className="p-4" />
                <th className="p-4 text-teal-700 dark:text-teal-400">SEO Autopilot</th>
                <th className="p-4 capitalize">{c.name}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {c.rows.map((r) => (
                <tr key={r.aspect}>
                  <th className="p-4 font-medium">{r.aspect}</th>
                  <td className="p-4">{r.us}</td>
                  <td className="p-4 text-stone-600 dark:text-stone-400">{r.them}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-teal-600/40 p-6">
            <h2 className="font-semibold">Elige SEO Autopilot si…</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {c.chooseUs.map((t) => (
                <li key={t} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-stone-200 p-6 dark:border-stone-800">
            <h2 className="font-semibold">Elige {c.name} si…</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {c.chooseThem.map((t) => (
                <li key={t} className="flex gap-2">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <CtaBox />
      </article>
    </PublicLayout>
  );
}

export function VerticalPage() {
  const { slug } = useParams();
  const v = VERTICALS.find((x) => x.slug === slug);
  if (!v) return <Navigate to="/" replace />;
  return (
    <PublicLayout>
      <article className="mx-auto max-w-4xl px-4 py-14">
        <Badge tone="blue">Tiendas de {v.name}</Badge>
        <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight">{v.title}</h1>
        <p className="mt-4 text-lg text-stone-600 dark:text-stone-400">{v.intro}</p>

        <section className="mt-12">
          <SectionTitle
            eyebrow="Búsquedas típicas"
            title={`Lo que pregunta el cliente de ${v.name}`}
          >
            Ejemplos del tipo de búsqueda que SEO Autopilot convierte en artículos. En tu cuenta
            verás las de tu propia tienda, puntuadas.
          </SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2">
            {v.searches.map((s) => (
              <li
                key={s}
                className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm dark:border-stone-800 dark:bg-stone-900"
              >
                «{s}»
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-semibold tracking-tight">Qué contenido funciona</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            {v.angles.map((a) => (
              <div key={a.title}>
                <h3 className="font-semibold">{a.title}</h3>
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{a.text}</p>
              </div>
            ))}
          </div>
        </section>
        <p className="mt-10 text-sm">
          ¿Quieres ver cómo queda un artículo?{' '}
          <Link to="/ejemplo" className="text-teal-700 underline dark:text-teal-400">
            Mira un ejemplo completo
          </Link>
          .
        </p>
        <CtaBox />
      </article>
    </PublicLayout>
  );
}
