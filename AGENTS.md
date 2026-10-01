# Agent Notes — Luisa Pita Bejarano Academy Backapp

Express + Mongoose + TypeScript, desplegado en Vercel. Frontend hermano:
`../luisa-pita-bejarano-academy-frontapp`. Más contexto: `DEPLOYMENT.md`, `NUVEI.md`.

## Comandos
- `npm run build` — `tsc`. Es la única verificación (no hay tests). Córrelo antes de cada commit.
- Ramas: `develop` (entorno dev, base `academy-dev`) y `main` (producción).

## Reglas de negocio que no se deben romper

### Acceso vigente ≠ `subscriptionStatus`
`subscriptionStatus` se queda en `"active"` aunque `accessUntil` ya pasó. Acceso real =
`subscriptionStatus === "active" && (accessUntil === null || accessUntil > now)`
(ver `middlewares/auth.middleware.ts`). Toda consulta de "alumnas activas" debe incluir
`$or: [{ accessUntil: null }, { accessUntil: { $gt: now } }]`.
- `services/admin.service.ts#listUsers`: filtro `active` = vigentes; filtro `expired` =
  activos con fecha vencida o `canceled`.

### Valoraciones físicas (`services/assessment.service.ts`)
- **Obligatorio en cada registro:** `composicion.pesoKg` y las 10 `medidas`
  (busto, cintura, abdomen, cadera, brazo/muslo/pantorrilla der. e izq.).
  `assertRequiredMetrics` lo valida para alumna y admin; el mensaje de error va en español
  porque se muestra tal cual en la UI.
- **Opcional:** `% grasa`, `% músculo`, `evaluacion` y `photos`.
- **Fotos:** `checkpoint.photos = [{ pose: "frente"|"perfil"|"espalda", publicId }]`, una por pose.
  Se suben por multipart (`image`) a `POST /academy/my-assessment/photos` (alumna) o
  `POST /admin/assessments/:userId/photos` (admin). Van a Cloudinary como
  `type: "authenticated"` en `academy/assessments/<userId>/` — son privadas.
  `photosInput` rechaza publicIds fuera de la carpeta de esa alumna.
- **Lectura:** todas las respuestas pasan por `withPhotoUrls`, que agrega una `url` firmada a
  cada foto. Nunca guardes la URL en la base; solo el `publicId`.

### Recetas y clases grabadas
- Recetas: `status` `draft` | `published` | `archived`; las alumnas solo ven `published`.
  `publishedAt` se fija la primera vez que se publica (no en cada guardado).
- Título duplicado → 409 con mensaje en español (`ensureUniqueRecipeSlug`).
- El listado admin de recetas y `confirmUpload` devuelven `deliveryUrl` firmado para que el
  admin vea la portada aunque la receta siga en borrador (`deliveryUrl` no se persiste:
  `mediaAssetSchema` lo descarta).
- Clases grabadas: son enlaces (Drive/Meet), no subidas; `status` por defecto `published`.

### Correos de contenido nuevo (`services/contentAnnouncement.service.ts`)
- Se disparan **solo** si el body de create/update trae `notify: true` y el contenido queda
  `published`. Lo envía el admin con la casilla "Avisar por correo a las alumnas activas".
- **Una sola vez por contenido:** `announcedAt` se marca con un `findOneAndUpdate`
  atómico (`announcedAt: null` → fecha) antes de enviar. No lo resetees salvo que se quiera
  reenviar a propósito.
- Destinatarias: `role: "user"`, verificadas y con acceso vigente. Lotes de 100 con
  `sendMailBatch` dentro de `runInBackground` (Vercel `waitUntil`).
- Contenido publicado antes de esta función tiene `announcedAt` vacío: si se edita con
  `notify: true` se anunciaría. Por eso la UI deja la casilla desmarcada al editar.

## Correos (`helpers/mailer.ts`)
- `sendMail` / `sendMailBatch` usan Resend con cuenta de respaldo (`RESEND_FALLBACK_*`).
- Estilo de plantillas: HTML inline, Arial, `max-width: 600px`, fondo `#fffdf7`,
  botón píldora `#536d59`, pie "Luisa Pita Bejarano Academy · … Ecuador (UTC-5)".
  Escapa siempre con `escapeHtml` todo texto que venga de la base.

## Producción
- `DB_URI` y las llaves de Resend son variables *Sensitive* en Vercel: no se pueden bajar.
  Para tareas puntuales sobre datos de prod se expone un endpoint en `routes/cron.routes.ts`
  protegido con `CRON_SECRET` (con `dryRun=1` / `confirm=1`), se despliega y se llama con curl.
- Fechas y horarios en hora de Ecuador (`America/Guayaquil`).
