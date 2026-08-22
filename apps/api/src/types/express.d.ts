/**
 * Express `Request` augmentation.
 *
 * Express has no notion of "the authenticated user" — `requireAuth` attaches
 * one, and without this file TypeScript rejects `req.userId` as a property
 * that does not exist. Declaration merging adds it to Express's own interface
 * rather than to a subclass, so every handler, middleware and route sees it
 * with no casts and no wrapper type.
 *
 * Mechanics worth knowing, because they are easy to get wrong:
 *
 * - The `Express` namespace is global, not imported. `@types/express` declares
 *   it that way so applications can extend it; that is the whole mechanism.
 * - `export {}` at the bottom is load-bearing. Without at least one top-level
 *   import or export, TypeScript treats this file as a *script* whose
 *   declarations are already global, and `declare global` is then an error.
 *   With it, the file is a module and `declare global` reaches outward.
 * - The file is picked up because tsconfig's `include` is `src/**\/*`. It is
 *   never imported by anything, and it must not be — it emits no runtime code.
 *
 * `userId` is optional on purpose. It is only present on routes that sit
 * behind `requireAuth`, and a non-optional `string` would be a lie everywhere
 * else — public routes would silently typecheck against a value that is
 * `undefined` at runtime. The cost is that protected handlers must narrow it.
 * If that becomes tiresome, the alternative is a separate `AuthenticatedRequest`
 * type used only on protected routes; that is a design call, not a config one.
 */

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export {};
