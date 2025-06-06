/* eslint-disable max-statements */

const fetch = require('node-fetch');

/**
 * @typedef {import('fastify').FastifyRequest} FastifyRequest
 * @typedef {import('fastify').FastifyReply} FastifyReply
 * @typedef {import('../warehouse').WarehouseApp} WarehouseApp
 */

/**
 * HTTP Request Handler
 *
 * @callback FastifyHandler
 * @param {FastifyRequest} req Fastify request object
 * @param {FastifyReply} res Fastify response object
 */

module.exports =
  /**
   * Initialize Object routes
   *
   * @param {WarehouseApp} fastify Warehouse app instance
   * @returns {Promise<void>} Promise representing routes initialization result
   */
  async function (fastify) {
    fastify.route({
      method: 'GET',
      url: '/objects/:name',
      preHandler: fastify.auth([fastify.verifyAuthentication]),
      schema: {
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        },
        querystring: {
          type: 'object',
          properties: {
            accepted_variants: { type: 'string' },
            version: { type: 'string' },
            env: { type: 'string' }
          }
        },
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                env: { type: 'string' },
                version: { type: 'string' },
                data: {
                  type: ['string', 'object'],
                  additionalProperties: true
                },
                variant: { type: 'string' }
              }
            }
          }
        }
      },
      handler:
        /**
         * @type {FastifyHandler}
         */
        // eslint-disable-next-line no-unused-vars
        async (req, res) => {
          const {
            params: { name },
            query: {
              version: v,
              accepted_variants: acceptedVariants,
              env = 'production'
            }
          } = req;

          let allObjVariants;
          let version = v;
          if (!version) {
            const obj = await fastify.getObject({ name, env });
            if (!obj) {
              throw fastify.httpErrors.notFound(
                `Object '${name}' not found in '${env}'`
              );
            }
            version = obj.headVersion || obj.latestVersion;
            // If no version is specified, we want a client
            // to cache the result for only 60 seconds
            res.header('Cache-Control', 'public, max-age: 60');
          } else {
            allObjVariants = await fastify.getAllObjectVariants({
              name,
              env,
              version
            });
            if (allObjVariants.length === 0) {
              throw fastify.httpErrors.notFound(
                `Version ${version} not found in '${env}'`
              );
            }

            // If a version is specified, the response can be
            // cached for longer time since it's unlikely to change
            res.header('Cache-Control', 'public, max-age: 86400');
          }

          /** @type {string[]|null} */
          const variants = acceptedVariants
            ? acceptedVariants
              .split(',')
              .map((variant) => variant.trim())
              .filter((variant) => variant !== '')
            : null;

          if (!variants && allObjVariants) {
            return allObjVariants;
          } else if (!variants) {
            return fastify.getAllObjectVariants({
              name,
              env,
              version
            });
          }

          const objectVariants = await fastify.getObjectVariants({
            name,
            env,
            version,
            variants
          });

          const variantsHashMap = objectVariants.reduce((acc, objVar) => {
            acc[objVar.variant] = objVar;
            return acc;
          }, {});

          for (const vKey of variants) {
            const objVar = variantsHashMap[vKey];
            if (objVar) {
              return [objVar];
            }
          }

          return [];
        }
    });

    fastify.route({
      method: 'GET',
      url: '/head/:name',
      schema: {
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        },
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                environment: { type: 'string' },
                headVersion: { type: ['string', 'null'] },
                latestVersion: { type: 'string' }
              }
            }
          }
        }
      },
      preHandler: fastify.auth([fastify.verifyAuthentication]),
      handler:
        /**
         * @type {FastifyHandler}
         */
        async (req, res) => {
          const {
            params: { name }
          } = req;
          const envs = await fastify.getEnvs({ name });
          const heads = await Promise.all(
            envs.map(async ({ env }) => {
              const obj = await fastify.getObject({ name, env });
              if (!obj) return null;
              const { headVersion, latestVersion } = obj;
              return { environment: env, headVersion, latestVersion };
            })
          );

          res.header('Cache-Control', 'public, max-age: 60');
          res.send(heads.filter((head) => head != null));
        }
    });

    fastify.route({
      method: 'GET',
      url: '/head/:name/:env',
      schema: {
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            env: { type: 'string' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              headVersion: { type: ['string', 'null'] },
              latestVersion: { type: 'string' }
            }
          }
        }
      },
      preHandler: fastify.auth([fastify.verifyAuthentication]),
      handler:
        /**
         * @type {FastifyHandler}
         */
        async (req, res) => {
          const {
            params: { name, env }
          } = req;
          const obj = await fastify.getObject({ name, env });
          if (!obj) {
            throw fastify.httpErrors.notFound(
              `Object '${name}' not found in '${env}'`
            );
          }

          const { headVersion, latestVersion } = obj;
          res.header('Cache-Control', 'public, max-age: 60');
          res.send({
            headVersion,
            latestVersion
          });
        }
    });

    fastify.route({
      method: 'POST',
      url: '/objects',
      preHandler: fastify.auth([fastify.verifyAuthentication]),
      schema: {
        body: {
          type: 'object',
          required: ['name', 'version', 'data'],
          properties: {
            name: { type: 'string' },
            version: { type: 'string' },
            env: { type: 'string' },
            variant: { type: 'string' },
            expiration: { type: ['string', 'number'] },
            data: { type: ['object', 'string'] }
          }
        },
        response: {
          201: {
            type: 'object',
            properties: {
              created: { type: 'boolean' }
            }
          }
        }
      },
      handler:
        /**
         * @type {FastifyHandler}
         */
        async (req, res) => {
          const {
            body: {
              name,
              version,
              data,
              env: envOrAlias,
              variant = '_default',
              expiration = null
            }
          } = req;

          if (envOrAlias) {
            let env = envOrAlias;
            let forceCreateEnv = true;
            const envAlias = await fastify.getEnvAlias({
              name,
              alias: envOrAlias
            });

            if (envAlias) {
              env = envAlias.env;
              forceCreateEnv = false;
            }

            await fastify.putObjectVariant(
              {
                name,
                version,
                env,
                data,
                variant,
                expiration
              },
              { forceCreateEnv }
            );

            if (fastify.log.security) {
              fastify.log.security({
                success: true,
                message: `Object "${name}" variant "${variant}" sucessfully created in "${env}"`,
                // eslint-disable-next-line max-len
                category: 'database', // see https://www.elastic.co/guide/en/ecs/current/ecs-allowed-values-event-category.html#ecs-event-category-database
                // eslint-disable-next-line max-len
                type: ['creation', 'allowed'], // see https://www.elastic.co/guide/en/ecs/current/ecs-allowed-values-event-type.html#ecs-event-type-creation
                method: req.method,
                url: req.url,
                requestId: req.id,
                sourceAddress: req.ip,
                host: req.hostname
              });
            }
          } else {
            const envs = await fastify.getEnvs({ name });

            if (envs.length < 1) {
              throw fastify.httpErrors.badRequest(
                'You must define at least one an environment or specify one with this request to create one'
              );
            }

            await Promise.all(
              envs.map(({ env }) => {
                return fastify.putObjectVariant({
                  name,
                  version,
                  env,
                  data,
                  variant,
                  expiration
                });
              })
            );

            if (fastify.log.security) {
              fastify.log.security({
                success: true,
                message: `Object "${name}" variant "${variant}" sucessfully created in "${envs.join(
                  ', '
                )}"`,
                // eslint-disable-next-line max-len
                category: 'database', // see https://www.elastic.co/guide/en/ecs/current/ecs-allowed-values-event-category.html#ecs-event-category-database
                // eslint-disable-next-line max-len
                type: ['creation', 'allowed'], // see https://www.elastic.co/guide/en/ecs/current/ecs-allowed-values-event-type.html#ecs-event-type-creation
                method: req.method,
                url: req.url,
                requestId: req.id,
                sourceAddress: req.ip,
                host: req.hostname
              });
            }
          }

          res.header('Cache-Control', 'no-storage');
          res.status(201).send({ created: true });
        }
    });

    fastify.route({
      method: 'GET',
      url: '/objects/:name/versions',
      schema: {
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        },
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                version: { type: 'string' },
                environments: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        }
      },
      preHandler: fastify.auth([fastify.verifyAuthentication]),
      handler:
        /**
         * @type {FastifyHandler}
         */
        async (req, res) => {
          const {
            params: { name }
          } = req;

          const envs = await fastify.getEnvs({ name });
          const versionsByEnv = await Promise.all(
            envs.map(async ({ env }) => {
              const v = await fastify.getAllObjectVersions({ name, env });
              return { env, v };
            })
          );

          const versionToEnvs = new Map();
          versionsByEnv.forEach(({ env, v }) => {
            for (const ver of v) {
              if (!versionToEnvs.has(ver)) {
                versionToEnvs.set(ver, [env]);
              } else {
                versionToEnvs.get(ver).push(env);
              }
            }
          });

          const allVersions = [];
          for (const [version, environments] of versionToEnvs.entries()) {
            allVersions.push({ version, environments });
          }

          res.send(allVersions);
        }
    });

    fastify.route({
      method: 'DELETE',
      url: '/objects/:name/:env',
      schema: {
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            env: { type: 'string' }
          }
        },
        response: {
          204: {}
        }
      },
      preHandler: fastify.auth([fastify.verifyAuthentication]),
      handler:
        /**
         * @type {FastifyHandler}
         */
        async (req, res) => {
          const {
            params: { name, env }
          } = req;
          const obj = await fastify.getObject({ name, env });
          if (!obj) {
            throw fastify.httpErrors.notFound(
              `Object '${name}' not found in '${env}'`
            );
          }
          await fastify.deleteObject({ name, env });

          if (fastify.log.security) {
            fastify.log.security({
              success: true,
              message: `Object "${name}" sucessfully deleted in "${env}"`,
              category: 'database',
              type: ['deletion', 'allowed'],
              method: req.method,
              url: req.url,
              requestId: req.id,
              sourceAddress: req.ip,
              host: req.hostname
            });
          }

          res.header('Cache-Control', 'no-storage');
          res.status(204);
        }
    });

    fastify.route({
      method: 'DELETE',
      url: '/objects/:name/:env/:version',
      preHandler: fastify.auth([fastify.verifyAuthentication]),
      schema: {
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            env: { type: 'string' },
            version: { type: 'string' }
          }
        },
        querystring: {
          type: 'object',
          properties: {
            variant: { type: 'string' }
          }
        },
        response: {
          204: {}
        }
      },
      handler:
        /**
         * @type {FastifyHandler}
         */
        async (req, res) => {
          const {
            params: { name, env, version },
            query: { variant }
          } = req;

          const [obj, objVersions] = await Promise.all([
            fastify.getObject({ name, env }),
            fastify.getAllObjectVersions({ name, env })
          ]);

          if (!obj) {
            throw fastify.httpErrors.notFound(
              `Object '${name}' not found in '${env}'`
            );
          }

          if (!objVersions.includes(version)) {
            throw fastify.httpErrors.notFound(
              `Version ${version} not found in '${env}'`
            );
          }

          if (!variant) {
            await fastify.deleteObjectVersion({ name, env, version });

            if (fastify.log.security) {
              fastify.log.security({
                success: true,
                message: `Object "${name}@${version}" sucessfully deleted in "${env}"`,
                category: 'database',
                type: ['deletion', 'allowed'],
                method: req.method,
                url: req.url,
                requestId: req.id,
                sourceAddress: req.ip,
                host: req.hostname
              });
            }
          } else {
            const objVariant = await fastify.getObjectVariant({
              name,
              env,
              version,
              variant
            });
            if (!objVariant) {
              throw fastify.httpErrors.notFound(
                `Variant '${variant}' not found in '${env}'`
              );
            }
            await fastify.deleteObjectVariant({ name, env, version, variant });

            if (fastify.log.security) {
              fastify.log.security({
                success: true,
                message: `Object "${name}@${version}" variant "${variant}" sucessfully deleted in "${env}"`,
                category: 'database',
                type: ['deletion', 'allowed'],
                method: req.method,
                url: req.url,
                requestId: req.id,
                sourceAddress: req.ip,
                host: req.hostname
              });
            }
          }

          // Since this happens outside a Dynamo transaction,
          // if the operation fails due to optimistic locking
          // or network error, we may want retry this
          // operation in isolation.

          // TODO (jdaeli): consider to expose a route to expose
          // this operation so that can be run in isolation
          await fastify.checkAndFixCorruptedHead({ name, env });

          res.header('Cache-Control', 'no-storage');
          res.status(204);
        }
    });

    fastify.route({
      method: 'PUT',
      url: '/objects/:name/:env',
      preHandler: fastify.auth([fastify.verifyAuthentication]),
      schema: {
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            env: { type: 'string' }
          }
        },
        body: {
          type: 'object',
          properties: {
            head: { type: 'string' },
            fromEnv: { type: 'string' }
          }
        },
        response: {
          204: {}
        }
      },
      handler:
        /**
         * @type {FastifyHandler}
         */
        async (req, res) => {
          const {
            params: { name, env },
            body: { fromEnv }
          } = req;

          let {
            body: { head: headVersion }
          } = req;

          if (!headVersion && !fromEnv) {
            throw fastify.httpErrors.badRequest(
              'Missing parameter: head or fromEnv must be specified'
            );
          }

          if (fromEnv) {
            const fromEnvVersion = await fastify.getObject({
              name,
              env: fromEnv
            });
            if (!fromEnvVersion || !fromEnvVersion.headVersion) {
              throw fastify.httpErrors.notFound(
                'Invalid fromEnv parameter value'
              );
            }
            headVersion = fromEnvVersion.headVersion;
          }

          const [obj, hasObjectVersion = false] = await Promise.all([
            fastify.getObject({ name, env }),
            fastify.hasObjectVersion({ name, env, version: headVersion })
          ]);

          if (!obj) {
            throw fastify.httpErrors.notFound(
              `Object '${name}' not found in '${env}'`
            );
          }

          if (!hasObjectVersion) {
            throw fastify.httpErrors.notFound(
              `Version ${headVersion} not found in '${env}'`
            );
          }

          const {
            headTimestamp: prevTimestamp,
            headVersion: prevHeadVersion
          } = obj;

          if (headVersion === prevHeadVersion) {
            throw fastify.httpErrors.conflict(
              `Version ${headVersion} is already set for object '${name}' in '${env}'`
            );
          }

          await fastify.setHead({
            name,
            env,
            version: headVersion,
            prevTimestamp
          });

          const sendHooks = async () => {
            const hooks = await fastify.getHooks({ name });
            const body = JSON.stringify({
              event: 'NEW_RELEASE',
              data: {
                object: name,
                environment: env,
                version: headVersion,
                previousVersion: prevHeadVersion
              }
            });

            hooks.map(async (hook) => {
              try {
                await fetch(hook.url, {
                  method: 'POST',
                  body,
                  headers: { 'Content-Type': 'application/json' }
                });
              } catch (err) {
                fastify.log.error(err);
              }
            });
          };

          // Fire and forget hook calls
          sendHooks();

          if (fastify.log.security) {
            fastify.log.security({
              success: true,
              message: `Object "${name}" head sucessfully set to "${headVersion}" in "${env}"`,
              category: 'database',
              type: ['change', 'allowed'],
              method: req.method,
              url: req.url,
              requestId: req.id,
              sourceAddress: req.ip,
              host: req.hostname
            });
          }

          res.header('Cache-Control', 'no-storage');
          res.status(204);
        }
    });

    fastify.route({
      method: 'PUT',
      url: '/objects/:name/:env/rollback',
      preHandler: fastify.auth([fastify.verifyAuthentication]),
      schema: {
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            env: { type: 'string' }
          }
        },
        body: {
          type: 'object',
          properties: {
            hops: { type: 'number', minimum: 1, maximum: 20, default: 1 }
          }
        },
        response: {
          204: {}
        }
      },
      handler:
        /**
         * @type {FastifyHandler}
         */
        async (req, res) => {
          const {
            params: { name, env },
            body: { hops = 1 }
          } = req;

          const [obj, objVersions] = await Promise.all([
            fastify.getObject({ name, env }),
            fastify.getAllObjectVersions({ name, env })
          ]);

          if (!obj) {
            throw fastify.httpErrors.notFound(
              `Object '${name}' not found in '${env}'`
            );
          }

          // Recursivly find version back to N hops
          let timestamp = obj.headTimestamp;
          let hop = 0;
          let record;
          while (timestamp && hop < hops + 1) {
            record = await fastify.getHistoryRecord({ name, env, timestamp });
            timestamp = record.prevTimestamp;
            hop++;
          }

          if (hop < 2 || !record) {
            throw fastify.httpErrors.notFound(
              `Object '${name}' in '${env}' does not have a previous version to rollback to`
            );
          }

          const { headVersion: version } = record;

          // This can happen if the version has been deleted
          if (!objVersions.includes(version)) {
            throw fastify.httpErrors.gone(
              `Version ${version} in '${env}' has been deleted`
            );
          }

          const {
            headTimestamp: prevTimestamp,
            headVersion: prevHeadVersion
          } = obj;

          if (version === prevHeadVersion) {
            throw fastify.httpErrors.conflict(
              `Object '${name}' in '${env}' is already rolled back to version '${version}'`
            );
          }

          await fastify.setHead({
            name,
            env,
            version,
            prevTimestamp
          });

          if (fastify.log.security) {
            fastify.log.security({
              success: true,
              message: `Object "${name}" head sucessfully set to "${version}" in "${env}"`,
              category: 'database',
              type: ['change', 'allowed'],
              method: req.method,
              url: req.url,
              requestId: req.id,
              sourceAddress: req.ip,
              host: req.hostname
            });
          }

          res.header('Cache-Control', 'no-storage');
          res.status(204);
        }
    });

    fastify.route({
      method: 'GET',
      url: '/logs/:name/:env',
      schema: {
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            env: { type: 'string' }
          }
        },
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                version: { type: 'string' },
                releaseDate: { type: 'string', format: 'date-time' }
              }
            }
          }
        }
      },
      preHandler: fastify.auth([fastify.verifyAuthentication]),
      handler:
        /**
         * @type {FastifyHandler}
         */
        async (req, res) => {
          const {
            params: { name, env }
          } = req;
          // Get the object and all its head changes
          const [obj, records] = await Promise.all([
            fastify.getObject({ name, env }),
            fastify.getHistoryRecords({ name, env })
          ]);

          if (!obj) {
            throw fastify.httpErrors.notFound(
              `Object '${name}' not found in '${env}'`
            );
          }

          // Sort head changes by timestamp in decreasing order
          records.sort((a, b) => b.timestamp - a.timestamp);
          const output = records.map((item) => ({
            version: item.headVersion,
            releaseDate: new Date(item.timestamp)
          }));

          res.header('Cache-Control', 'public, max-age: 60');
          res.send(output);
        }
    });
  };

/* eslint-enable max-statements */
