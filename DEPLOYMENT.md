# Deployment — SOLO VERCEL

> **⚠️ NETLIFY ESTÁ ABANDONADO en toda la academia. No usar, no configurar, no deployar ahí.**

## Configuración actual

| | |
|---|---|
| Proyecto Vercel | `luisa-pita-bejarano-backapp` |
| Team | `proyectos-de-diego` (`team_ZB0eFNsqFQo6bL8QgAMAWUHa`) |
| Repo | `yeyodev1/luisa-pita-bejarano-academy-backapp` |
| Rama por defecto (GitHub) | `develop` — aquí se trabaja y aquí caen los PRs |
| Rama de producción (Vercel) | `main` — fijada explícitamente en el proyecto |
| Flujo | commitear en `develop` → deploy de preview automático → PR `develop` → `main` → producción |
| API en producción | https://luisa-pita-bejarano-backapp.vercel.app |

> Cambiar el default de GitHub a `develop` **no** afecta producción: Vercel tiene
> `productionBranch: main` guardado en el proyecto. Nada se publica hasta que se mergea a `main`.

## CORS

La whitelist vive en `src/app.ts`. Incluye `luisapitabejarano.com`, `www`, los subdominios
de la academia y los aliases de Vercel del frontend. Cualquier dominio nuevo del frontend
debe agregarse ahí o el navegador bloqueará las llamadas.

## Frontend

Repo aparte: `yeyodev1/luisa-pita-bejarano-academy-frontapp`, proyecto Vercel
`luisa-pita-bejarano-academy-frontapp`, sirviendo `luisapitabejarano.com`.
