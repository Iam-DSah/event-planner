/**
 * Prettier configuration.
 *
 * This file is deliberately empty. Every Prettier 3 default already matches
 * what is in this repo — 2-space indent, semicolons, double quotes, trailing
 * commas, 80 columns — so restating them would be settings that have to be
 * justified in review for no gain. The file exists so editors and any future
 * CI agree the project is Prettier-formatted at all; the empty object is the
 * whole statement.
 *
 * Measured before the first run — `npx prettier --list-different .` reports
 * 11 files:
 *
 *   121 lines  db/migrations/20260820045850_initial_schema.ts
 *    28 lines  db/knexfile.ts
 *              ^ day-2 files, written with single quotes; the default is double
 *    16 lines  lib/jwt.ts        multi-line call collapsed onto fewer lines
 *    12 lines  lib/env.ts        indentation
 *     7 lines  middleware/errorHandler.ts
 *     4 lines  server.ts, docker-compose.yml
 *     2 lines  knex.ts, domainErrors.ts, password.ts, notFoundHandler.ts
 *              ^ missing trailing newline, nothing else
 *
 * Nothing there is a behaviour change, and the migration has already been
 * applied — reformatting its source cannot affect a database. But it is a
 * large cosmetic diff across files from three different days, so run it as
 * its own commit rather than folding it into a feature.
 *
 * @type {import("prettier").Config}
 */
export default {};
