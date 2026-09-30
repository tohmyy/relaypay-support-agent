const STOPWORDS = new Set(
  (
    'a an and are as at be but by can could do does did for from had has have how i if in into is it ' +
    'its me my no not of on or our please should so than that the their them then there these they ' +
    'this to us was we were what when where which who why will with would you your tell about ' +
    'happens happen much many get'
  ).split(' '),
);

// Brand term appears in nearly every chunk, so it only helps when nothing else is left.
const BRAND = 'relaypay';

/** Builds a safe OR tsquery string ("charge | fee") from a natural-language question. */
export function buildQuery(question: string): string {
  const terms = [
    ...new Set(
      question
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
    ),
  ];
  const informative = terms.filter((t) => t !== BRAND);
  return (informative.length > 0 ? informative : terms).join(' | ');
}
