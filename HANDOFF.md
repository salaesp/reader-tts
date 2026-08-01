# Handoff — Reader TTS

Estado al momento de entregar: **aplicación funcional y verificada end-to-end en
local**, sin desplegar. Falta crear las credenciales reales (Google Cloud,
Cloudflare) y validar la llamada real a OpenRouter.

Este documento es para retomar el trabajo desde tu máquina. El `README.md` tiene
la referencia completa; acá está lo que necesitás saber para arrancar y lo que
no es obvio leyendo el código.

---

## 1. Arranque local

```bash
git clone <repo> && cd reader-tts
npm install

# Secretos locales
cp .dev.vars.example .dev.vars
openssl rand -base64 32   # → SESSION_SECRET
openssl rand -base64 32   # → ENCRYPTION_KEY (tiene que decodificar a 32 bytes)

# Base local (aplica las migraciones)
npm run db:local

# Levantar
npm run pages:dev         # build + wrangler pages dev en http://127.0.0.1:8788
```

`GOOGLE_CLIENT_ID` podés dejarlo vacío al principio: el login no va a funcionar,
pero podés probar toda la API con una cookie de sesión falsa (ver §5).

Para iterar sobre la UI con hot reload, dejá `npm run pages:dev` corriendo en una
terminal y `npm run dev` en otra: Vite levanta en `:5173` y hace proxy de `/api`
al Worker.

```bash
npm test          # 92 tests
npm run build     # typecheck + build
```

---

## 2. Lo primero que hay que hacer

**Averiguar cuál de los dos proveedores te funciona.** Ahora hay dos y se
eligen desde Ajustes sin tocar código:

| | OpenRouter | ElevenLabs |
|---|---|---|
| Endpoint | `POST /v1/audio/speech` | `POST /v1/text-to-speech/{voice_id}` |
| Key | `sk-or-v1-…` | `sk_…` |
| Modelo por defecto | `google/gemini-3.1-flash-tts-preview` | `eleven_multilingual_v2` |
| Voces | por modelo, no publicadas (se infieren del slug) | las de tu cuenta, por nombre |

Comprobarlo desde la terminal, con cualquiera de los dos:

```bash
# OpenRouter
curl -X POST https://openrouter.ai/api/v1/audio/speech \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"google/gemini-3.1-flash-tts-preview","input":"Hola, probando.","voice":"Kore","response_format":"mp3"}' \
  --output prueba.mp3

# ElevenLabs — primero mirá qué voces tenés
curl -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v2/voices

curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/<VOICE_ID>?output_format=mp3_44100_128" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hola, probando.","model_id":"eleven_multilingual_v2"}' \
  --output prueba.mp3
```

Lo mismo desde la app: **Ajustes → Proveedor de voz**, pegás la key y tocás
**Probar voz**. El error del proveedor se muestra tal cual, que es lo que hace
falta para saber si el problema es la key, el crédito, el modelo o la voz.

**Si el audio suena a robot y aparece «se usa la voz del navegador»**, es el
fallback: la síntesis en la nube falló y el reproductor siguió con Web Speech
para no cortar la lectura. El banner ahora incluye el motivo — antes solo decía
que estaba usando la voz del navegador y el error real quedaba invisible, que es
la forma más fácil de perder una tarde con esto.

Para cambiar los defaults del proyecto: `DEFAULT_TTS_MODEL`,
`DEFAULT_TTS_VOICE`, `DEFAULT_ELEVENLABS_MODEL` y `DEFAULT_TTS_PROVIDER` en
`shared/types.ts`.

## 3. Credenciales que faltan

### Google Cloud
1. Proyecto nuevo o existente en [console.cloud.google.com](https://console.cloud.google.com/).
2. Pantalla de consentimiento OAuth (External).
3. Credenciales → ID de cliente OAuth → **Aplicación web**.
4. **Orígenes autorizados de JavaScript**:
   - `http://localhost:5173`
   - `http://127.0.0.1:8788`
   - `https://<tu-proyecto>.pages.dev`
5. No necesitás URIs de redirección ni client secret: el flujo es por popup.

### Cloudflare
El paso a paso completo, con una comprobación por etapa, está en el README
(«2. Cloudflare» y «3. Desplegar»). Resumido:

```bash
npx wrangler pages project create reader-tts --production-branch main
npx wrangler d1 create reader-tts          # pegá el database_id en wrangler.toml
npx wrangler kv namespace create FILES     # pegá el id en wrangler.toml
npm run db:remote                          # crea las tablas: d1 create deja la base vacía
npx wrangler pages secret put SESSION_SECRET
npx wrangler pages secret put ENCRYPTION_KEY
npm run pages:deploy
```

`GOOGLE_CLIENT_ID` va en `[vars]` de `wrangler.toml` (no es secreto: el browser
lo necesita).

**Los ids de D1 y KV valen para una sola cuenta de Cloudflare.** El del repo es
el de la cuenta original; en una cuenta nueva hay que crear los recursos y
pegar los valores nuevos. Cloudflare valida los bindings al recibir el deploy,
así que un id que no está en la cuenta rechaza todos los deploys por igual, sin
importar qué cambió en el código — un modo de falla que desde el log parece «el
deploy está roto» y no «esta línea está mal». Por eso todo comando que toque
esos recursos (`pages:deploy`, `db:remote`, `db:status`) corre antes
`scripts/check-bindings.mjs`. Cada uno chequea solo lo que usa: aplicar
migraciones no exige un KV que no toca.

### OpenRouter / ElevenLabs
Las keys se cargan **desde Ajustes dentro de la app**, no en el repo ni en
variables de entorno. Quedan cifradas en D1, una por proveedor.

---

## 4. Mapa del código

Dónde tocar según lo que quieras cambiar:

| Quiero… | Archivo |
|---|---|
| Cambiar modelo/voz/proveedor por defecto | `shared/types.ts` |
| Tocar cómo se llama a un proveedor | `functions/lib/tts/openrouter.ts`, `functions/lib/tts/elevenlabs.ts` |
| Agregar un tercer proveedor | `functions/lib/tts/` (interfaz en `types.ts`) + `TtsProvider` en `shared/types.ts` |
| Tocar el tamaño de los fragmentos de TTS | `src/lib/segmenter.ts` (`TARGET_CHUNK_CHARS`) |
| Cambiar cómo se parsea el EPUB | `src/lib/epub.ts` |
| Cambiar el resaltado de oraciones | `src/lib/annotate.ts` |
| Tocar reproducción, prefetch, fallback | `src/lib/player.ts` |
| Agregar/cambiar textos | `src/i18n/es.json`, `src/i18n/en.json` |
| Agregar un endpoint | `functions/api/…` |
| Cambiar el esquema de datos | `wrangler d1 migrations create` → archivo nuevo en `migrations/` |

```
functions/            backend (Cloudflare Pages Functions)
  api/_middleware.ts  resuelve la sesión y convierte errores en JSON
  api/auth/session.ts login con Google, sesión, logout
  api/books/          listar, subir, descargar, portada, progreso
  api/settings.ts     preferencias + API keys cifradas (una por proveedor)
  api/tts/            proxy de síntesis y lista de modelos
  lib/tts/            clientes de OpenRouter y ElevenLabs tras una interfaz común
  lib/                cripto, sesión, verificación de tokens de Google
src/
  lib/                epub, segmenter, annotate, player, tts, store, api, router
  pages/              Login, Library, Reader, Settings
shared/types.ts       tipos compartidos front ↔ backend
scripts/dev/          utilidades de desarrollo (ver §5)
```

---

## 5. Trabajar sin Google OAuth

Mientras no tengas el Client ID, podés probar toda la API con una cookie de
sesión firmada con tu `SESSION_SECRET` local:

```bash
# Crear un usuario en la D1 local
npx wrangler d1 execute reader-tts --local --command \
  "INSERT OR REPLACE INTO users (id,google_sub,email,name,picture,created_at,last_seen_at)
   VALUES ('dev-user','sub-dev','dev@example.com','Dev User',NULL,0,0)"

TOKEN=$(node scripts/dev/mint-session.mjs dev-user)

curl -b "rt_session=$TOKEN" http://127.0.0.1:8788/api/auth/session
curl -b "rt_session=$TOKEN" http://127.0.0.1:8788/api/books

# Un EPUB de prueba con capítulos en español e inglés
node scripts/dev/make-sample-epub.mjs sample.epub
curl -b "rt_session=$TOKEN" -F "file=@sample.epub" -F "title=Prueba" \
  http://127.0.0.1:8788/api/books
```

También sirve para usar la UI: pegá la cookie con las DevTools
(Application → Cookies → `rt_session`) y recargá.

El token solo lo acepta tu Worker local, porque depende de tu `SESSION_SECRET`.

---

## 6. Decisiones que conviene no romper

Cosas que parecen mejorables pero están así a propósito:

**Las API keys nunca van al browser.** Se cifran con AES-GCM en D1 y se
descifran solo dentro del Worker. Si algún día tentás llamar al proveedor
directo desde el cliente, perdés eso y quedás atado a su CORS.

**Modelo y voz se guardan por proveedor, no compartidos.** Los ids no tienen
nada que ver entre sí (`openai/gpt-4o-mini-tts` vs `eleven_multilingual_v2`), y
el punto de tener dos proveedores es poder ir y volver comparando sin
reconfigurar cada vez.

**El hash de caché incluye el proveedor.** Dos proveedores pueden devolver audio
distinto para el mismo texto, modelo y voz; sin el proveedor en la clave, el
primero que se reprodujo se quedaría pegado.

**La velocidad no se manda a la API.** Se aplica con `playbackRate` del elemento
`<audio>`. Así un mismo audio generado sirve para todas las velocidades (el hash
de caché no incluye la velocidad) y el cambio es instantáneo. Varios modelos
además rechazan el parámetro `speed`.

**Las migraciones corren solas en el deploy.** `pages:deploy` hace build,
aplica lo pendiente y recién ahí sube. El orden es a propósito: los cambios son
aditivos, así que el código viejo tolera el esquema nuevo, pero el código nuevo
contra una base sin migrar no. Wrangler lleva la cuenta en `d1_migrations`, así
que aplicar dos veces no hace nada. Los archivos ya aplicados no se editan: se
agrega uno nuevo.

**Los archivos van a KV, no a R2.** R2 exige registrar una tarjeta aunque el
free tier no cobre nada. KV lo evita, a cambio de un tope de 25 MiB por EPUB y
de no soportar Range requests. Todo el acceso pasa por
`functions/lib/storage.ts`, así que volver a R2 es reescribir ese archivo solo.

**El audio no se cachea en el servidor.** Se streamea desde OpenRouter y la
única copia queda en IndexedDB del dispositivo, con el mismo hash. Escuchar el
mismo pasaje en un segundo dispositivo se cobra de nuevo; era el precio de no
necesitar R2.

**Renderer de EPUB propio, no `epub.js`.** epub.js dibuja cada capítulo en un
iframe, lo que hace muy difícil resaltar la oración que se está leyendo y mapear
el progreso. Acá las oraciones se calculan **sobre el DOM ya renderizado**
(`annotate.ts`), por eso cada offset apunta a un nodo real.

**Los saltos de línea dentro de un texto se convierten a espacios, no a saltos de
párrafo.** El XHTML de los EPUB viene indentado y esos saltos partían oraciones a
la mitad. La sustitución es 1:1 en longitud justamente para no invalidar los
offsets. Está en `buildTextIndex` con test de regresión.

**Login por popup, no redirect.** Un redirect saca a la PWA instalada del modo
standalone en Android/iOS y el usuario no vuelve.

**`unlock()` se llama sincrónicamente en el gesto del usuario.** iOS solo permite
reproducir audio como resultado directo de un tap; se reproduce un MP3 mudo para
habilitar el elemento y después se reutiliza siempre el mismo.

**Un 401 significa "sesión vencida", nunca "key inválida".** Si OpenRouter
rechaza la key, el endpoint devuelve 403 `invalid_api_key`. Mezclarlos hacía que
la app te mandara al login por un problema de key.

---

## 7. Qué está verificado y qué no

Verificado con Chromium contra D1 y el almacenamiento local:

- Subida de EPUB, descarga byte-idéntica, portada, borrado (incluye limpiar los archivos)
- Apertura del libro, render de capítulos, lista de capítulos, navegación
- Retomar en la posición guardada
- Resaltado de la oración correcta y "tocar una oración para leer desde ahí"
- Aislamiento entre usuarios (404 al pedir el libro de otro)
- Cifrado de la key (verificado que en la base hay ciphertext)
- i18n es/en, manifest válido, service worker activo
- Modo offline: biblioteca y libro descargado siguen funcionando
- 92 tests unitarios

**No verificado:**

- **La síntesis real, en los dos proveedores** — `openrouter.ai` y
  `api.elevenlabs.io` están bloqueados por allowlist de egreso en el entorno
  donde se trabajó. Está probado todo el camino hasta la salida (validación,
  ruteo por proveedor, caché, manejo de errores, y que la petición sale al host
  correcto con los headers correctos), pero no la generación de audio ni la
  forma exacta de las respuestas de éxito.
- **El login con Google** — necesita un Client ID real. La verificación del token
  (firma RS256 contra el JWKS de Google, `aud`, `iss`, `exp`) tiene tests, pero
  el flujo completo con Google no se ejecutó.
- **iOS/Safari** — la lógica de `unlock()` y MediaSession está escrita para el
  comportamiento de iOS pero solo se probó en Chromium.

---

## 8. Ideas para seguir

Ninguna es necesaria para que funcione; en orden aproximado de valor:

1. **Descarga de capítulo completo** — pre-generar el audio de todo un capítulo
   para escucharlo después sin conexión.
2. **Estimación de costo** — mostrar cuánto saldría un libro antes de empezar
   (hay caracteres por capítulo y precio por modelo en `/api/tts/models`).
3. **Marcadores y notas.**
4. **Ajustes de lectura** — tamaño de letra, tema claro, ancho de columna.
5. **Detección automática de idioma por libro** — hoy sale de `dc:language` del
   EPUB para el metadato, pero la segmentación usa el ajuste global.
6. **Limpiar la caché de audio por antigüedad** — hoy se borra manualmente desde
   Ajustes o al eliminar el libro.
7. **Más idiomas** — la infraestructura de i18n ya está; sumar un JSON y el
   locale al segmentador.

---

## 9. Problemas comunes

| Síntoma | Causa probable |
|---|---|
| Login no aparece / "Falta configurar GOOGLE_CLIENT_ID" | Falta la variable, o el origen no está en los orígenes autorizados de GCP |
| `no_api_key` al reproducir | No cargaste la key en Ajustes |
| `invalid_api_key` | OpenRouter rechazó la key: revisala o fijate si tiene crédito |
| `tts_failed` | El modelo elegido no acepta síntesis o está caído; el detalle trae el mensaje del proveedor |
| `no_voice_selected` | ElevenLabs sin voz elegida. Abrí Ajustes: se completa sola con la primera voz de la cuenta |
| `tts_quota_exceeded` | ElevenLabs sin créditos en el plan |
| Suena la voz del navegador sin pedirlo | Falló la síntesis en la nube y entró el fallback; el banner del lector dice por qué |
| `ENCRYPTION_KEY must decode to exactly 32 bytes` | Usá `openssl rand -base64 32` |
| La sesión se pierde al recargar en local | La cookie es `Secure` solo en https; en `http://127.0.0.1` no debería pasar. Revisá que estés en 127.0.0.1 y no en un dominio raro |
| El audio no arranca en el celular | Tiene que salir de un tap; si tocaste play y no suena, revisá el volumen de medios |
| Se acumula mucho almacenamiento | Ajustes → borrar audio guardado en este dispositivo |
