import { buildOpenApi } from '@retailgeo/core';
process.stdout.write(JSON.stringify(buildOpenApi('/api/v1'), null, 2));
