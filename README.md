# Sismo 3D

Dos edificios iguales por fuera: el 1 con vigas en triángulo, el 2 sin ellas.
**Rayos X** muestra la estructura; **Temblor** sacude el suelo y gana el que tiene triángulos.

## Usar

```bash
npm install
npm run dev        # desarrollo en http://localhost:5173
npm test           # prueba la física sin pantalla (14 comprobaciones)
npm run typecheck  # TypeScript
npm run build      # genera dist/
```

Teclas: `Espacio` temblor · `X` rayos X · `L` cámara lenta · `R` reiniciar.

## Desplegar en Vercel

Es un proyecto Vite estándar y `vercel.json` ya trae la configuración.

- **Con GitHub:** sube la carpeta `sismo-3d` a un repositorio, en Vercel elige *Add New → Project*, importa el repo
  (si el repo contiene más carpetas, pon *Root Directory* = `sismo-3d`). No cambies nada más.
- **Con la terminal:** dentro de esta carpeta ejecuta `npx vercel` (y `npx vercel --prod` para producción).

No necesita variables de entorno, base de datos ni servidor.

## Estructura

```
src/physics.ts       motor de barras y nodos (XPBD), sin dependencias
src/physics.test.ts  pruebas: el 1 resiste, el 2 cae, es determinista
src/view.ts          dibujo 3D de cada edificio (Three.js)
src/main.ts          escena, cámara, controles y panel
src/style.css        diseño (vidrio oscuro, Exo + Roboto Mono)
```

## Ajustar el comportamiento

En `src/physics.ts`, el objeto `TUNE`: `jointCap` (fuerza que aguanta un edificio sin triángulos),
`braceCap` (fuerza que aguanta un arriostre) y `ampBase`/`ampGrowth` (qué tan fuerte es el temblor por magnitud).
Después de tocarlos corre `npm test` para confirmar que el Edificio 1 sigue resistiendo y el 2 sigue cayendo.
