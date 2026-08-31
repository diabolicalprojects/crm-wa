import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*.spec.ts'],
    // Sin exclusiones por nombre de archivo. Antes se omitían `openwa*` y
    // `whatsapp*`, lo que dejaba fuera de la corrida justo las pruebas de la
    // ingesta del webhook y la verificación HMAC: se escribían y nunca se
    // ejecutaban, así que no protegían nada.
    exclude: ['**/node_modules/**', '**/.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['apps/api/src/**/*.ts', 'apps/web/app/lib/**/*.ts'],
      exclude: [
        '**/*.spec.ts',
        'apps/api/src/main.ts',
        'apps/api/src/app.module.ts',
      ],
      // Trinquete sobre la cobertura real de todo el backend, no sobre un
      // subconjunto elegido. El umbral anterior era de 80% pero excluía los
      // archivos grandes sin pruebas —el worker, el adaptador de OpenWA— así
      // que medía lo que ya estaba cubierto. Estos números son bajos y honestos:
      // súbelos conforme se agreguen pruebas, nunca bajes el piso.
      thresholds: { lines: 45, statements: 45, functions: 42, branches: 40 },
    },
  },
});
