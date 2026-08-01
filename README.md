# Reader TTS

Aplicación web instalable (PWA) para escuchar EPUBs con voces de IA.

- Subís tus `.epub` y quedan guardados en tu cuenta
- Text-to-speech vía **OpenRouter** o **ElevenLabs**, a elección y con modelo configurable
- Recuerda dónde quedaste, en cada dispositivo
- Interfaz y lectura en **español** e **inglés**
- Login con **Google**
- Funciona sin conexión con los libros ya descargados

## Cómo está armado

| Capa | Tecnología |
|---|---|
| Front | React 19 + TypeScript + Vite + Tailwind v4 |
| PWA | `vite-plugin-pwa` (Workbox) |
| EPUB | JSZip + DOMParser + DOMPurify (renderer propio) |
| Server | Cloudflare Pages Functions |
| Datos | Cloudflare D1 (SQLite), migraciones versionadas |
| Archivos | Cloudflare KV (epubs y portadas) |

### Decisiones que conviene conocer

**Las API keys nunca llegan al navegador.** Se guardan cifradas con AES-GCM en
D1 y solo se descifran dentro del Worker, que hace la llamada al proveedor y
devuelve el audio. Además evita depender del CORS de cada proveedor.

**Cada proveedor guarda su propia key, modelo y voz.** Cambiar de OpenRouter a
ElevenLabs y volver no pierde la configuración del otro, así se pueden comparar
sin recargar nada. El proveedor activo es `tts_provider` en `settings`.

**El audio se cachea solo en el dispositivo**, en IndexedDB, con clave
`sha256(proveedor|modelo|voz|texto)`. Volver a escuchar un capítulo en el mismo
navegador no se cobra de nuevo; hacerlo en otro dispositivo sí, porque no hay
copia en el servidor.

**Los archivos van a KV, no a R2.** R2 exige registrar una tarjeta aunque el
free tier no cobre. KV lo evita, a cambio de un tope de 25 MiB por EPUB y de no
soportar descargas parciales (Range). El acceso está aislado en
`functions/lib/storage.ts` para poder volver a R2 cambiando un solo archivo.

**La velocidad se aplica en el reproductor**, no en la API: un mismo audio
generado sirve para todas las velocidades y el cambio es instantáneo.

**Renderer de EPUB propio en vez de `epub.js`.** epub.js dibuja cada capítulo
dentro de un iframe, lo que hace muy difícil resaltar la oración que se está
leyendo. Acá el XHTML se parsea, se sanitiza y se renderiza en el documento
principal, con cada oración envuelta en un `<span data-sentence>`.

**Login con Google Identity Services en modo popup**, no redirect: un redirect
saca a la PWA instalada del modo standalone en Android/iOS.

## Puesta en marcha

### 1. Google Cloud — credenciales OAuth

1. Entrá a [console.cloud.google.com](https://console.cloud.google.com/) y creá
   (o elegí) un proyecto.
2. **APIs y servicios → Pantalla de consentimiento de OAuth**: tipo *External*,
   completá nombre de la app y correo de soporte.
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de
   OAuth**, tipo **Aplicación web**.
4. En **Orígenes autorizados de JavaScript** agregá:
   - `http://localhost:5173` y `http://127.0.0.1:8788` (desarrollo)
   - `https://<tu-proyecto>.pages.dev` (y tu dominio propio, si tenés)

   No hace falta configurar URIs de redirección: el flujo es por popup.
5. Copiá el **Client ID**. El *client secret* no se usa.

### 2. Cloudflare — proyecto, base y almacenamiento

Los ids de D1 y KV valen para **una sola cuenta de Cloudflare**. Los que trae el
repo son los de la cuenta original: si desplegás en otra, o si borraste los
recursos, hay que crearlos de nuevo y pegar los valores nuevos.

Cloudflare valida los bindings al recibir el deploy, así que un id que no está
en la cuenta rechaza *todos* los deploys por igual — el código que estés
subiendo no interviene. Por eso todo comando que los use (`pages:deploy`,
`db:remote`, `db:status`) chequea primero que no sean placeholders y te dice
cuál falta, en vez de dejar que la API conteste «Invalid uuid».

Seguí los pasos en este orden; cada uno tiene con qué comprobarlo.

```bash
npm install
npx wrangler login
```

**1. Crear el proyecto de Pages.** Tiene que existir antes de poder cargarle
secretos.

```bash
npx wrangler pages project create reader-tts --production-branch main
npx wrangler pages project list          # comprobación: aparece reader-tts
```

**2. Crear la base y el almacenamiento**, y pegar los dos ids en
`wrangler.toml`:

```bash
npx wrangler d1 create reader-tts        # → database_id
npx wrangler kv namespace create FILES   # → id
```

```toml
[[d1_databases]]
database_id = "…"        # reemplaza PASTE_D1_DATABASE_ID

[[kv_namespaces]]
id = "…"                 # reemplaza PASTE_KV_NAMESPACE_ID
```

```bash
npx wrangler d1 list                     # comprobación: el id coincide
npx wrangler kv namespace list
```

**3. Crear las tablas.** `d1 create` deja la base **vacía**: sin esto la app
responde 500 aunque el binding esté perfecto.

```bash
npm run db:remote
npm run db:status                        # comprobación: 0001 y 0002 aplicadas
```

**4. Configuración y secretos.** El Client ID va en `wrangler.toml` (lo necesita
el navegador, no es secreto):

```toml
[vars]
GOOGLE_CLIENT_ID = "xxxxx.apps.googleusercontent.com"
```

```bash
openssl rand -base64 32   # una salida distinta para cada uno
npx wrangler pages secret put SESSION_SECRET
npx wrangler pages secret put ENCRYPTION_KEY    # debe decodificar a 32 bytes
npx wrangler pages secret list                  # comprobación: los dos figuran
```

`ENCRYPTION_KEY` cifra las API keys guardadas: si la cambiás después, las keys
que ya estén en la base dejan de poder descifrarse y hay que volver a cargarlas
desde Ajustes.

### 3. Desplegar

```bash
npm run pages:deploy
```

Hace, en este orden: preflight de los ids → build → migraciones → subida. Las
migraciones van **antes** de la subida a propósito: los cambios de esquema son
aditivos, así que el código viejo tolera el esquema nuevo, pero el código nuevo
contra una base sin migrar no. Aplicar es idempotente, así que no necesita
guarda.

Comprobación de que quedó vivo, sin necesidad de iniciar sesión:

```bash
curl https://reader-tts.pages.dev/api/config     # devuelve el googleClientId
```

Ese endpoint **no toca D1**. Si responde pero la biblioteca tira 500 al iniciar
sesión, el problema es el binding `DB` o las migraciones, no el deploy.

#### Si preferís deploy automático por push

Conectá el repo desde el panel de Pages. Tené en cuenta que **`pages:deploy` no
se ejecuta**: Cloudflare corre el *build command* y sube `dist/`. Entonces:

- **Build command: `npm run build`**, y va sí o sí en el panel — Pages rechaza
  una sección `[build]` en el `wrangler.toml` («Configuration file for Pages
  projects does not support build»), aunque `wrangler pages dev` la acepte en
  local. Si el campo queda vacío, Cloudflare saltea el build y muere en
  `Output directory "dist" not found`: `dist/` es generado y no se commitea, así
  que sin build no hay nada que subir. Ese error es idéntico en cada commit y no
  menciona ninguno.
- Las migraciones **no** van en el build command salvo que agregues un
  `CLOUDFLARE_API_TOKEN` con permiso **D1: Edit** y `CLOUDFLARE_ACCOUNT_ID` a
  las variables de *build*; sin el token wrangler no se autentica y el build
  entero falla. Con token: `npm run build && npm run db:remote`.
- Los bindings del panel (*Settings → Bindings*) son **otro lugar** distinto del
  `wrangler.toml`: hay que cargar `DB` y `FILES` ahí también.
- Las *preview branches* usan la misma base. Si no querés que una rama migre
  producción, guardá el paso con `[ "$CF_PAGES_BRANCH" = main ]`.

Es el camino con más superficie de error de los dos. Si el deploy a mano te
alcanza, quedate con `npm run pages:deploy`.

### Cambios de esquema

```bash
npx wrangler d1 migrations create reader-tts "lo-que-cambia"
npm run db:local     # aplicar en local
npm run db:status    # ver qué falta en producción
```

Los archivos ya aplicados **no se editan**: wrangler registra cuáles corrieron
en una tabla `d1_migrations`, así que modificar uno desincroniza toda base que
ya lo aplicó. Cada cambio va en un archivo numerado nuevo.

### 4. Configurar la app

Entrá, iniciá sesión con Google y andá a **Ajustes**:

1. Elegí el **proveedor de voz**: OpenRouter o ElevenLabs.
2. Pegá la API key de ese proveedor —
   [openrouter.ai/keys](https://openrouter.ai/keys) o
   [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys).
   Cada uno guarda la suya.
3. Elegí el **modelo de TTS**. La lista se arma en tiempo real:
   - OpenRouter: los modelos que generan audio.
   - ElevenLabs: los modelos de la cuenta. `eleven_multilingual_v2` anda bien en
     español; los `turbo`/`flash` son más baratos y rápidos.
4. Elegí la **voz** y probala con *Probar voz* antes de empezar un libro. En
   ElevenLabs las voces son las de tu cuenta y se eligen por nombre.

Si al reproducir aparece «se usa la voz del navegador», el banner incluye el
error que devolvió el proveedor: ahí está la causa (key, crédito, modelo o voz).

## Desarrollo

```bash
cp .dev.vars.example .dev.vars   # completá los valores
npm run pages:dev       # migraciones + build + wrangler pages dev en :8788
```

Para iterar sobre la interfaz con recarga en caliente, `npm run dev` levanta
Vite en `:5173` y hace proxy de `/api` al `wrangler pages dev` de arriba (los dos
a la vez).

```bash
npm test          # unit tests
npm run build     # typecheck + build de producción
```

## Estructura

```
functions/            Cloudflare Pages Functions (backend)
  api/
    auth/session.ts   login con Google, sesión y logout
    books/            listado, subida, descarga, portada, progreso
    settings.ts       preferencias y API keys cifradas
    tts/              proxy de síntesis + lista de modelos
  lib/                cripto, sesión, verificación de tokens de Google
    tts/              clientes de OpenRouter y ElevenLabs tras una interfaz común
src/
  lib/
    epub.ts           parser de EPUB (container, OPF, spine, ToC, portada)
    segmenter.ts      oraciones (Intl.Segmenter) y chunks
    annotate.ts       mapea oraciones sobre el DOM renderizado
    player.ts         reproducción, prefetch, seguimiento de oración
    tts.ts            motores de nube (OpenRouter/ElevenLabs) y Web Speech
    store.ts          caché en IndexedDB (libros, archivos, audio, progreso)
  pages/              Login, Library, Reader, Settings
  i18n/               es.json / en.json
shared/types.ts       tipos compartidos entre front y functions
migrations/           esquema versionado; se aplica solo en cada deploy
```

## Límites conocidos

- Subida máxima de 25 MB por EPUB (tope de un valor en KV).
- El texto se manda al proveedor en fragmentos de ~900 caracteres; libros muy
  largos generan muchas llamadas, y el costo lo define el modelo que elijas.
- ElevenLabs sale en `mp3_44100_128`, el único formato disponible en todos los
  planes.
- La voz del navegador (Web Speech) es el respaldo sin conexión o sin API key:
  no requiere cuenta pero suena bastante peor. Se puede elegir cuál usar en
  Ajustes; las voces son las del sistema operativo, así que la lista cambia en
  cada dispositivo y la elección se guarda **local**, no en la cuenta. En
  Android las voces «en línea» de Google son las mismas que usa el «leer en voz
  alta» de Chrome.
- Algunos modelos de OpenRouter (la línea Gemini TTS) solo emiten PCM y
  rechazan un pedido de mp3 con un escueto «Provider returned 400». La síntesis
  prueba mp3 primero, reintenta en PCM y lo envuelve en WAV para que el
  navegador pueda reproducirlo; el formato que funcionó queda guardado para no
  repetir el intento fallido en cada fragmento.
- Solo se soporta EPUB. PDF y MOBI quedan fuera.
