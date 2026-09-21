# Migrar datos desde la versión anterior

Si ya has creado clubes, categorías, competiciones o inscripciones en la versión anterior:

## Paso 1 · Exportar la versión anterior

En la aplicación antigua entra como administradora y ve a:

**Configuración → Exportar campeonato**

Guarda el archivo JSON.

## Paso 2 · Publicar la nueva web

Sigue `PUBLICAR_EN_RAILWAY.md` y crea la cuenta administradora inicial.

## Paso 3 · Importar

En la nueva web entra como administradora:

**Configuración → Importar JSON**

Selecciona el archivo exportado.

La aplicación restaurará categorías, competiciones, inscripciones, sorteos, historial, resultados y configuración compatibles.

## Importante sobre las contraseñas de los clubes

Las credenciales no se exportan ni importan en texto ni como hashes reutilizables. Esto es deliberado por seguridad.

Después de una migración, revisa **Clubes** y establece/restablece el usuario y contraseña de cada club que vaya a acceder a la nueva web. Puedes mantener el mismo nombre de usuario si lo deseas, pero deberás asignar una nueva contraseña si esa cuenta no existe en el nuevo servidor.

## Comprobación posterior

Antes de abrir las inscripciones reales comprueba:

- número de categorías;
- competiciones y fechas;
- categorías habilitadas y precios;
- número de inscripciones por club;
- sorteos confirmados e historial;
- que un usuario de club no pueda ver otro club.
