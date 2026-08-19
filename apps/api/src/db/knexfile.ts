import { fileURLToPath } from 'node:url';
import type { Knex } from 'knex';

/**
 * Knex configuration. Read by the knex CLI (see the `knex` npm script) and
 * later by the application itself.
 */
const config: Knex.Config = {
  client: 'mysql2',

  connection: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'eventplanner',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'event_planner',

    charset: 'utf8mb4',

    // The line that makes decision D004 actually work.
    //
    // We store UTC instants in a DATETIME column. By default the mysql2 driver
    // converts JavaScript Date objects using the *server's local timezone* on
    // write, and interprets DATETIME values the same way on read. On a machine
    // set to Asia/Kathmandu that silently shifts every timestamp by 5h45m
    // between writing and reading.
    //
    // 'Z' tells the driver: treat everything as UTC in both directions. What
    // you write is what you read back.
    timezone: 'Z',

    // BIGINT can exceed JavaScript's safe integer range. These two settings
    // say: support big numbers, but hand them back as regular numbers rather
    // than strings. Safe here because our ids will never approach 2^53.
    supportBigNumbers: true,
    bigNumberStrings: false,
  },

  migrations: {
    // Absolute, derived from this file's own location. Relative paths resolve
    // differently depending on whether the knex CLI loads this file or the
    // application imports it, and that difference is a confusing hour to lose.
    directory: fileURLToPath(new URL('./migrations', import.meta.url)),
    tableName: 'knex_migrations',
    extension: 'ts',
    loadExtensions: ['.ts'],
  },
};

export default config;
