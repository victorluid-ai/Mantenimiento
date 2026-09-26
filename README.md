# Mantenimiento preventivo — Grupo Essencia

Esqueleto para el seguimiento del mantenimiento preventivo de las máquinas de cocina. Permite dar de alta una cocina, elegir equipos del catálogo semilla (marca y modelo reales) y marcar cada tarea como hecha o pendiente. El estado se guarda en el navegador (`localStorage`, clave `essencia.mantenimiento.v1`).

No hay cuentas, servidor ni varios locales: una cocina por navegador.

## Cómo ejecutarlo en local

Hace falta un servidor estático. Abrir `index.html` como archivo no carga el catálogo.

```bash
python3 -m http.server 8080
```

Entra en [http://127.0.0.1:8080](http://127.0.0.1:8080).

No hay dependencias que instalar. Python 3 solo sirve los archivos.

## Datos

`data/equipment-catalog.json` es el catálogo semilla: 15 equipos, con `manual_url`, tareas citadas y `legal_note`. Dos equipos (campana Giatsu SoftAir y Hoshizaki IM-240) no traen checklist: no había manual PDF verificable y no se inventan tareas.

## Nota legal

Los manuales de fabricante están protegidos por copyright (Directiva 2001/29/CE y TRLPI en España). Se puede enlazar a la página oficial de descarga o al PDF publicado por el fabricante o un distribuidor autorizado. No se debe redistribuir, alojar ni copiar el PDF completo en la aplicación ni en el repositorio.

El checklist cita la fuente y es un resumen operativo, no una reproducción del manual. Quien use el equipo debe conservar el manual original. Esta aplicación no sustituye el mantenimiento técnico autorizado ni las obligaciones de seguridad alimentaria (APPCC/HACCP).

El texto íntegro está en el campo `legal_note` del JSON y en el pie de la aplicación.
