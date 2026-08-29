const BOOLEAN_OPERATORS = /[+\-~<>()"*@]/g;

/** InnoDB does not index tokens shorter than innodb_ft_min_token_size. */
const MIN_FULLTEXT_TOKEN = 3;

export interface SearchPlan {
  /** Indexable tokens, already in `+token*` form. Empty when there are none. */
  fulltext: string;
  /** Tokens too short to be indexed. Matched with LIKE instead. */
  like: string[];
}

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
    fulltext: indexable.map((token) => `+${token}*`).join(" "),
    like: tooShort,
  };
}

export const LIKE_ESCAPE = "!";

export function likePattern(term: string): string {
  return `%${term.replace(/[!%_]/g, (char) => `${LIKE_ESCAPE}${char}`)}%`;
}
