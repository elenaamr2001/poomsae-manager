# Checklist antes de abrir inscripciones reales

## Técnica

- [ ] La URL pública usa `https://`.
- [ ] `/health` responde correctamente.
- [ ] `DATABASE_URL` apunta a PostgreSQL privado de Railway.
- [ ] `NODE_ENV=production`.
- [ ] Se ha activado un backup periódico de PostgreSQL.
- [ ] Se ha descargado una exportación JSON de prueba.

## Cuentas

- [ ] Contraseña de administración larga, exclusiva y guardada de forma segura.
- [ ] Cada club tiene un usuario propio.
- [ ] Se ha probado login con al menos un club.
- [ ] Un club solo ve/modifica sus inscripciones.
- [ ] Se ha probado el bloqueo de un club desactivando su acceso.

## Campeonato

- [ ] Competición creada con fecha y lugar correctos.
- [ ] Categorías permitidas revisadas.
- [ ] Precios generales/específicos revisados.
- [ ] Se ha probado una inscripción individual, una pareja y un trío.
- [ ] Se ha probado cerrar inscripciones y comprobar que el club ya no pueda modificar.
- [ ] Se han ejecutado las comprobaciones automáticas del apartado Configuración.
- [ ] Se ha realizado un sorteo de prueba y se ha comprobado impresión/bracket.

## Protección de datos

La web almacena nombres de deportistas y, por tanto, datos personales. Antes de uso real, define quién es responsable del tratamiento, finalidad, base jurídica, conservación y cómo informarás a clubes/deportistas. Evita recopilar datos personales que no sean necesarios para organizar el campeonato.
