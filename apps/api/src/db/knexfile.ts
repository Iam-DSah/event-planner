import { fileURLToPath } from "node:url";
import type { Knex } from "knex";

const config: Knex.Config = {
  client: "mysql2",

  connection: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "eventplanner",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "event_planner",

    charset: "utf8mb4",

    // Store UTC instants in a DATETIME column. By default the mysql2 driver
    // converts JavaScript Date objects using the *server's local timezone* on
    // write, and interprets DATETIME values the same way on read.
    timezone: "Z",

    supportBigNumbers: true,
    bigNumberStrings: false,

    connectTimeout: 5000,
  },

  acquireConnectionTimeout: 5000,

  migrations: {
    directory: fileURLToPath(new URL("./migrations", import.meta.url)),
    tableName: "knex_migrations",
    extension: "ts",
    loadExtensions: [".ts"],
  },
};

export default config;
