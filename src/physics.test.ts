// Pruebas de la física sin pantalla. Uso: npm test
// Falla (código de salida 1) si el Edificio 1 no resiste o el 2 no cae.
import { createBuilding, startQuake, stepBuilding, metrics, QUAKE_SECONDS, TUNE } from './physics.ts';

function run(braced: boolean, mag: number) {
  const b = createBuilding(braced, 0, 0, TUNE);
  startQuake(b);
  const dt = 1 / 60;
  const steps = Math.round((QUAKE_SECONDS + 4) / dt);
  for (let i = 0; i < steps; i++) stepBuilding(b, dt, mag, TUNE);
  const nan = b.nodes.some((n) => !Number.isFinite(n.x + n.y + n.z));
  return { ...metrics(b), nan };
}

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FALLA'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failed++;
}

for (const mag of [4, 5, 6, 6.5, 7, 8]) {
  const a = run(true, mag);
  check(`M${mag}: Edificio 1 sigue en pie`, a.status !== 'collapsed' && !a.nan, `${a.status}, ${a.driftCm} cm`);
}
for (const mag of [6, 6.5, 7, 8]) {
  const c = run(false, mag);
  check(`M${mag}: Edificio 2 colapsa`, c.status === 'collapsed' && !c.nan, `${c.status}, cima ${c.topHeight.toFixed(1)} m`);
}
{
  const a = run(true, 6.5);
  check('M6.5: Edificio 1 queda 100% estable', a.status === 'ok' && a.intactPct === 100);
  const a2 = run(true, 6.5);
  const c1 = run(false, 6.5);
  const c2 = run(false, 6.5);
  check('Es determinista (misma corrida, mismo resultado)', a.driftCm === a2.driftCm && c1.intactPct === c2.intactPct && c1.topHeight === c2.topHeight);
}
{
  const calm = run(false, 4);
  check('M4: un temblor leve no tumba al Edificio 2', calm.status !== 'collapsed');
  const huge = run(true, 9);
  check('M9: ni siquiera el Edificio 1 aguanta (honesto)', huge.status === 'collapsed');
}

console.log(failed ? `\n${failed} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exitCode = failed ? 1 : 0;
