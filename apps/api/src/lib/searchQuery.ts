/**
 * Turns what a person typed into a MySQL BOOLEAN MODE expression.
 *
 * This is NOT about SQL injection — the result is still passed as a bound
 * parameter. It is that BOOLEAN mode assigns meaning to `+ - ~ < > ( ) " * @`,
 * so an unsanitised search box lets punctuation change the query into
 * something the user did not ask for. Measured against this database:
 *
 *     AGAINST('Venue'  IN BOOLEAN MODE)   ->  415 rows
 *     AGAINST('-Venue' IN BOOLEAN MODE)   ->    0 rows
 *
 * Someone searching for a hyphenated venue name gets silent nothing.
 */
const BOOLEAN_OPERATORS = /[+\-~<>()"*@]/g;

/**
 * Every token is `+token*`.
 *
 * `+` makes each word REQUIRED, so adding words narrows the result — what a
 * search box trains people to expect. Without it BOOLEAN mode treats words as
 * optional: `Venue Bob` returns 418 rows here (either word) against 0 for
 * `+Venue* +Bob*` (both). Noisier, and relevance ordering only re-sorts that
 * noise rather than removing it.
 *
 * `*` is mandatory for prefix matching — FULLTEXT indexes whole tokens, so
 * `Ven` matches nothing while `Ven*` matches 415. Measured, it does two more
 * things that are not obvious and that D022 had listed as costs to document:
 *
 *     +the   ->   0    +the*  ->   2     stopwords are skipped for prefixes
 *     +ve    ->   0    +ve*   -> 415     so is innodb_ft_min_token_size = 3
 *
 * The wildcard expands against tokens that ARE indexed, so both restrictions
 * stop applying. Searching "the" finding "THEIRS" is a little surprising, but
 * it is prefix search doing exactly what was asked, and it beats zero rows.
 *
 * Returns "" when nothing survives (a query of pure punctuation).
 * `AGAINST('' IN BOOLEAN MODE)` yields 0 rows without erroring — verified —
 * which is the honest answer to "I searched for nothing matchable".
 */
export function toBooleanSearchQuery(input: string): string {
  return (
    input
      // Replaced with a SPACE, not removed. Deleting them glues words together:
      // "Yoga@Home" would become the single token "YogaHome", which matches
      // nothing, where "Yoga Home" matches both words.
      .replace(BOOLEAN_OPERATORS, " ")
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .map((token) => `+${token}*`)
      .join(" ")
  );
}
