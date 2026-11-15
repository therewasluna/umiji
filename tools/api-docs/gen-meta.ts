// Dumps what the wiki's API page needs from the running backend code: the OpenAPI document, every
// route's roles and API-token scope, the error codes and the webhook events. build-spec.py turns it
// into docs/api/spec.json. See build-spec.py for how to run both.
import 'zod/compile';
import fs from 'node:fs';

import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';

import { SCOPE_ENDPOINT, SCOPE_RESOURCE } from '@common/decorators/scopes';
import { createOpenApiDocumentFactory } from '@common/utils/startup-app/build-openapi-document';
import { CONTROLLERS_INFO, ROOT } from '@libs/contracts/api';
import { ERRORS, EVENTS, ROLE } from '@libs/contracts/constants';

// the workspace keeps the backend repo next to this one
import { AppModule } from '../../../backend/src/app.module';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

async function main() {
    const app = await NestFactory.create(AppModule, { preview: true, logger: false });
    app.setGlobalPrefix(ROOT);

    const routes: unknown[] = [];
    for (const mod of (app as any).container.getModules().values()) {
        for (const wrapper of mod.controllers.values()) {
            const cls = wrapper.metatype;
            if (!cls) continue;
            const classRoles = Reflect.getMetadata(ROLE, cls);
            const classGuards = Reflect.getMetadata(GUARDS_METADATA, cls) ?? [];
            for (const name of Object.getOwnPropertyNames(cls.prototype)) {
                const fn = cls.prototype[name];
                if (typeof fn !== 'function' || name === 'constructor') continue;
                const method = Reflect.getMetadata(METHOD_METADATA, fn);
                if (method === undefined) continue;
                routes.push({
                    controller: cls.name,
                    handler: name,
                    method: METHODS[method],
                    base: Reflect.getMetadata(PATH_METADATA, cls),
                    path: Reflect.getMetadata(PATH_METADATA, fn),
                    resource: Reflect.getMetadata(SCOPE_RESOURCE, cls) ?? null,
                    roles: Reflect.getMetadata(ROLE, fn) ?? classRoles ?? null,
                    guards: [...classGuards, ...(Reflect.getMetadata(GUARDS_METADATA, fn) ?? [])].map(
                        (g: { name: string }) => g.name,
                    ),
                    scope: Reflect.getMetadata(SCOPE_ENDPOINT, fn) ?? null,
                });
            }
        }
    }

    const openapi = (await createOpenApiDocumentFactory(app))();
    const out = { root: ROOT, openapi, routes, controllers: CONTROLLERS_INFO, errors: ERRORS, events: EVENTS };
    fs.writeFileSync(process.env.META_OUT ?? 'api-meta.json', JSON.stringify(out));
    console.log(`${routes.length} routes written to ${process.env.META_OUT ?? 'api-meta.json'}`);
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
