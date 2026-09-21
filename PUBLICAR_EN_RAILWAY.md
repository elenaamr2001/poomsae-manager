# Publicar Poomsae Manager en Railway

Esta es la ruta recomendada porque permite publicar el servidor Node.js y PostgreSQL en el mismo proyecto y obtener HTTPS.

## 1. Preparar GitHub

1. Descarga y descomprime el paquete.
2. Crea una cuenta en GitHub si no tienes una.
3. Crea un repositorio nuevo, preferiblemente **privado**.
4. Sube **el contenido de esta carpeta** a la raíz del repositorio. En la raíz deben verse `Dockerfile`, `server.js`, `package.json`, `schema.sql` y la carpeta `public`.
5. No subas nunca un archivo `.env` real. Está incluido en `.gitignore`.

También puedes usar Git desde tu ordenador:

```bash
git init
git add .
git commit -m "Primera versión web Poomsae Manager"
git branch -M main
git remote add origin URL_DE_TU_REPOSITORIO
git push -u origin main
```

## 2. Crear el proyecto en Railway

1. Entra en Railway y crea un **Empty Project**.
2. En el lienzo del proyecto pulsa `+ New` → `Database` → `PostgreSQL`.
3. Espera a que PostgreSQL quede desplegado.
4. Pulsa `+ New` → `GitHub Repo` y selecciona el repositorio anterior.
5. Railway detectará el `Dockerfile` de la raíz.

## 3. Conectar la aplicación con PostgreSQL

En el servicio de la aplicación abre **Variables** y añade:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
SESSION_DAYS=14
```

`Postgres` debe coincidir con el nombre real del servicio de base de datos. Usa el autocompletado de Railway si le has puesto otro nombre.

No hace falta crear las tablas manualmente: `server.js` ejecuta `schema.sql` al arrancar.

## 4. Desplegar

1. Aplica los cambios pendientes / pulsa **Deploy** si Railway lo solicita.
2. Abre los logs de la aplicación.
3. Debes ver un mensaje parecido a:

```text
Poomsae Manager Web escuchando en puerto ...
Entorno: production
```

4. El healthcheck configurado es `/health`.

## 5. Obtener el enlace público

1. Servicio de aplicación → **Settings**.
2. Busca **Networking → Public Networking**.
3. Pulsa **Generate Domain**.
4. Railway te dará una dirección `https://...up.railway.app`.
5. Ese es el enlace que puedes enviar a los clubes.

No expongas públicamente el servicio PostgreSQL: la aplicación se conecta a él por la red privada del proyecto.

## 6. Primera entrada

Al abrir el enlace por primera vez aparecerá **Primer acceso · crear cuenta de organización**.

1. Elige el usuario administrador.
2. Usa una contraseña larga y exclusiva.
3. Entra en **Clubes**.
4. Crea cada club y genera sus credenciales.
5. Entra en **Competiciones** y crea el campeonato.
6. Selecciona las categorías habilitadas y sus precios.
7. Envía a cada club:
   - el mismo enlace de la web;
   - su usuario;
   - su contraseña.

Cada club verá solo su información y sus inscripciones.

## 7. Usar un dominio propio (opcional)

Si compras, por ejemplo, `poomsaecanarias.es`, puedes usar `inscripciones.poomsaecanarias.es`.

En Railway:

1. Servicio de aplicación → **Settings → Public Networking**.
2. `+ Custom Domain`.
3. Escribe tu dominio/subdominio.
4. Railway mostrará los registros DNS que debes crear en tu proveedor de dominio.
5. Crea exactamente el `CNAME` y el `TXT` indicados.
6. Cuando se verifique, Railway emitirá automáticamente el certificado SSL y la dirección funcionará con `https://`.

## 8. Actualizar la web en el futuro

Con el repositorio enlazado a Railway, basta con subir cambios a la rama conectada. Railway reconstruirá y desplegará la nueva versión automáticamente.

Antes de cambios grandes, exporta el campeonato desde la propia aplicación y realiza un backup de PostgreSQL.

## 9. Backups recomendados

En el servicio PostgreSQL de Railway abre **Backups** y activa al menos una copia diaria o semanal. Para un campeonato real conviene además conservar periódicamente una exportación JSON descargada desde **Configuración → Exportar campeonato**.

## 10. Si el despliegue falla

Comprueba, en este orden:

1. `DATABASE_URL` existe en el servicio de la aplicación.
2. Su valor es una referencia al `DATABASE_URL` del servicio PostgreSQL.
3. `NODE_ENV=production`.
4. El repositorio tiene `Dockerfile` en la raíz.
5. Los logs no muestran un error de conexión PostgreSQL.
6. `/health` devuelve `{ "ok": true }`.

