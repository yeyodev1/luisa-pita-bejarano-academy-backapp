# Integración Nuvei (Link to Pay)

Estado: **código completo, apagado por bandera**. No se cobra nada hasta que
`NUVEI_ENABLED=true`.

## Qué es esta integración

Nuvei LATAM (ex-Paymentez), modalidad **Link to Pay**, red adquirente **Datafast**.
Es la modalidad que Nuvei ya certificó para este comercio en las pruebas técnicas
del 5 de agosto de 2026.

El flujo replica el de PayPhone: se genera un link, se redirige al comprador, y
al volver cae en `/pago/nuvei`. La diferencia importante es que **la confirmación
real llega por webhook servidor-a-servidor**, no por el navegador — es más
robusto que el confirm del navegador que usa PayPhone hoy.

## Credenciales del comercio

| | |
|---|---|
| Link to Pay | `LUPIBEJARANOLTP-EC-SERVER` (3DS 2.0 activo, OTP activo) |
| Recurrencia (no usada aún) | `LUPIBEJARANO-PR-EC-SERVER` + `LUPIBEJARANO-PR-EC-CLIENT` |
| Tope por transacción | $700 — el plan más caro es $400, entra |
| Créditos | Corriente + diferido **con** intereses a 3 meses |
| IVA | 15%, incluido en el precio del plan |

El `app_key` viaja en el Excel cifrado `CREDENCIALES PRODUCCIÓN - LUPIBEJARANO.xlsx`
que Nuvei envió el 4 de agosto; la contraseña se entregó el día de las pruebas.
**Nunca se commitea** — va en `.env` y en las env vars de Vercel.

## Variables de entorno

```
NUVEI_ENABLED=false          # true solo tras la confirmación oficial de activación
NUVEI_ENV=stg                # stg | prod
NUVEI_APP_CODE=LUPIBEJARANOLTP-EC-SERVER
NUVEI_APP_KEY=<del Excel cifrado>
NUVEI_INSTALLMENTS_TYPE=0    # 0 permite cuotas, -1 solo corriente
```

## Endpoints

| Método | Ruta | Auth | Para qué |
|---|---|---|---|
| GET | `/api/payments/nuvei/health` | pública | Dice si Nuvei está habilitado; el frontend la usa para elegir pasarela |
| POST | `/api/payments/nuvei/create-link` | pública | Crea el link de pago y el registro `pending` |
| POST | `/api/payments/nuvei/webhook` | pública, firmada | Confirmación de Nuvei; se valida con `stoken` |
| GET | `/api/payments/nuvei/status/:devReference` | pública | Estado para la vista de retorno |

El webhook es público a propósito: lo llama Nuvei, no un usuario. Su autenticidad
se prueba con el `stoken` = `md5(transaction_id_app_code_user_id_app_key)`,
comparado en tiempo constante. Sin stoken válido responde 401 y no toca nada.

## Idempotencia

`clientTransactionId` (el `dev_reference` que ve Nuvei) es único en Mongo y es la
llave. El webhook corre dentro de una transacción y sale temprano si el pago ya
está `approved`, así que los reintentos de Nuvei no duplican accesos ni correos.

## Rollout

1. Recibir de Nuvei el correo de **confirmación oficial de activación**.
2. Registrar la URL del webhook en el dashboard de Nuvei:
   `https://luisa-pita-bejarano-backapp.vercel.app/api/payments/nuvei/webhook`
3. Cargar `NUVEI_APP_CODE` y `NUVEI_APP_KEY` en Vercel (Production y Preview).
4. Probar en `NUVEI_ENV=stg` con las tarjetas de prueba de la doc.
5. Poner `NUVEI_ENV=prod` y `NUVEI_ENABLED=true`. El checkout cambia solo: el
   frontend consulta `/nuvei/health` y usa Nuvei si está activo, si no PayPhone.

Para volver atrás basta `NUVEI_ENABLED=false` — vuelve a PayPhone sin desplegar.

> ⚠️ Nuvei factura las transacciones de prueba que no se reversen.

## Pendiente

- Cargar el `app_key` (requiere abrir el Excel cifrado).
- Registrar la URL del webhook en el dashboard.
- Confirmar con Nuvei el valor exacto de `installments_type` para "diferido con
  intereses 3 meses"; hoy queda configurable y por defecto en 0.

## Regla de acceso

Todas las pasarelas otorgan acceso por `src/helpers/access.helper.ts`. Una
**compra siempre reinicia** desde la fecha del pago — un plan anual da 12 meses
exactos, no se acumula con acceso vigente (regla documentada en
`createManualPayment`). La única excepción es la **extensión manual del admin**,
que sí acumula: ahí el admin regala meses en vez de vender un plan.
