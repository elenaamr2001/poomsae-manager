# Poomsae Manager Web

Versión multiusuario preparada para publicar en Internet.

## Qué incluye

- Interfaz web en español.
- Roles separados: **Organización** y **Club**.
- La organización crea competiciones, habilita categorías y fija precios.
- Cada club inicia sesión con sus credenciales y solo gestiona sus propias inscripciones.
- PostgreSQL como almacenamiento persistente.
- Contraseñas con hash `scrypt` en el servidor; nunca se almacenan en el JSON del campeonato.
- Sesiones persistentes con cookie `HttpOnly`, `SameSite=Strict` y `Secure` en producción.
- Rate limiting en login/API y cabeceras de seguridad.
- Validaciones de permisos también en el servidor.
- Sorteos, brackets, BYEs, seeds, historial, resultados, importación/exportación e impresión de la versión del campeonato.
- Dockerfile y configuración Railway.
- Healthcheck `/health`.

## Estructura

- `public/index.html`: interfaz completa.
- `server.js`: servidor web/API y autenticación.
- `schema.sql`: tablas PostgreSQL; el servidor las crea automáticamente al arrancar.
- `Dockerfile`: despliegue reproducible.
- `railway.json`: healthcheck y política de reinicio.
- `docker-compose.yml`: prueba local opcional con PostgreSQL.
- `.env.example`: variables para ejecución local sin Docker Compose.
- `PUBLICAR_EN_RAILWAY.md`: instrucciones de publicación.
- `MIGRAR_DATOS.md`: cómo llevar el campeonato de la versión anterior.
- `CHECKLIST_PRODUCCION.md`: comprobaciones antes de abrir inscripciones reales.

## Prueba local con Docker

Si tienes Docker Desktop instalado:

```bash
docker compose up --build
```

Después abre:

`http://localhost:8080`

La primera vez se mostrará el alta del usuario administrador.

Para detenerlo:

```bash
docker compose down
```

Los datos PostgreSQL permanecen en el volumen `poomsae_pgdata`. Para borrar también los datos locales:

```bash
docker compose down -v
```

## Variables de entorno

- `DATABASE_URL`: obligatoria. Cadena de conexión PostgreSQL.
- `PORT`: Railway la establece automáticamente; localmente se usa 8080.
- `NODE_ENV`: usar `production` en Internet.
- `SESSION_DAYS`: duración de sesión; por defecto 14 días.

## Seguridad de credenciales

La exportación JSON del campeonato **no contiene contraseñas**. Si importas clubes que nunca han tenido una cuenta en este servidor, aparecerán sin acceso hasta que la organización entre en **Clubes → Editar / acceso** y les asigne usuario y contraseña.

## Publicación

Sigue `PUBLICAR_EN_RAILWAY.md`.
