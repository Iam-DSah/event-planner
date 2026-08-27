/**
 * Turns what a person typed into a search plan.
 *
 * Sanitising is NOT about SQL injection — every value below is passed as a
 * bound parameter. It is that BOOLEAN mode assigns meaning to
 * `+ - ~ < > ( ) " * @`, so an unsanitised search box lets punctuation change
 * the query into something the user did not ask for:
 *
 *     AGAINST('Venue'  IN BOOLEAN MODE)  ->  415 rows
 *     AGAINST('-Venue' IN BOOLEAN MODE)  ->    0 rows
 */
const BOOLEAN_OPERATORS = /[+\-~<>()"*@]/g;

/** InnoDB does not index tokens shorter than innodb_ft_min_token_size. */
const MIN_FULLTEXT_TOKEN = 3;

export interface SearchPlan {
  /** Indexable tokens, already in `+token*` form. Empty when there are none. */
  fulltext: string;
  /** Tokens too short to be indexed. Matched with LIKE instead. */
  like: string[];
}

/**
 * Splits the query by what the FULLTEXT index can actually answer.
 *
 * THE BUG THIS EXISTS FOR: `innodb_ft_min_token_size = 3`, so "AI" is never
 * indexed, and `+AI*` expands only to INDEXED tokens beginning with "AI" — of
 * which there are none. Every term being required, the whole query came back
 * empty while the event sat on screen:
 *
 *     q=AI    total=0     "AI Conference" exists
 *     q=UX    total=0     "UX Workshop" exists
 *     q=5k    total=0     "5k Fun Run" exists
 *
 * Note that token LENGTH is not really the discriminator — `ve*` resolves fine
 * because `Venue` is indexed and shares the prefix. Length is a cheap
 * over-approximation of "might not match", and taking the slower path for a
 * query that would have worked is the right way to be wrong.
 *
 * SPLIT rather than switch: the reference implementation falls back to LIKE for
 * the ENTIRE query as soon as one short token appears, which throws away the
 * index for "AI Conference" even though "Conference" is perfectly indexable.
 * Here `Conference` still narrows through the index and `%AI%` filters what
 * survives. Only an all-short query ("AI") is a full LIKE scan.
 *
 * It also keeps the two paths semantically identical. The reference's fallback
 * matches the whole phrase as one literal substring, which is order-SENSITIVE,
 * so `Conference AI` matches under one mode and not the other. Both halves here
 * are an AND of independent terms, in any order.
 *
 * Both empty means the query was pure punctuation — the caller must match
 * nothing rather than everything.
 */
export function planSearch(input: string): SearchPlan {
  const tokens = input
    // Replaced with a SPACE, not removed. Deleting them glues words together:
    // "Yoga@Home" would become the single token "YogaHome", which matches
    // nothing, where "Yoga Home" matches both words.
    .replace(BOOLEAN_OPERATORS, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);

  const indexable = tokens.filter((t) => t.length >= MIN_FULLTEXT_TOKEN);
  const tooShort = tokens.filter((t) => t.length < MIN_FULLTEXT_TOKEN);

  return {
    // `+` makes each term required, so adding a word narrows — this box sits in
    // the filter form and must behave like a filter. `*` is mandatory for
    // prefix matching: FULLTEXT indexes whole tokens, so "Ven" matches 0 while
    // "Ven*" matches 415.
    fulltext: indexable.map((token) => `+${token}*`).join(" "),
    like: tooShort,
  };
}

/**
 * The LIKE escape character. Deliberately NOT the backslash default: writing
 * `ESCAPE '\'` correctly requires escaping through TypeScript's string literal
 * AND MySQL's, and the version that looks right is a syntax error because
 * MySQL reads `'\'` as an escaped quote. `!` needs no escaping in either
 * language, so what is written is what runs.
 */
export const LIKE_ESCAPE = "!";

/**
 * Escapes the LIKE wildcards so a literal `%` or `_` in a search term is
 * matched as itself rather than as a wildcard. The escape character is
 * replaced first, or it would double-escape the escapes added after it.
 */
export function likePattern(term: string): string {
  return `%${term.replace(/[!%_]/g, (char) => `${LIKE_ESCAPE}${char}`)}%`;
}
