import { nirfColleges } from "./nirf-colleges";

export type College = { place: number; name: string; city: string; state: string };

type IndexedCollege = College & {
  normalizedName: string;
  nameTokens: Set<string>;
  aliasTokens: Set<string>;
  acronym: string;
  placeTokens: Set<string>;
  haystack: string;
};

// Older or informal city names people type, mapped to the names NIRF uses.
const citySynonyms: Record<string, string> = {
  trichy: "tiruchirappalli", bombay: "mumbai", madras: "chennai", calcutta: "kolkata", bangalore: "bengaluru",
  gurgaon: "gurugram", mysore: "mysuru", mangalore: "mangaluru", pondicherry: "puducherry", pondy: "puducherry",
  cochin: "kochi", calicut: "kozhikode", baroda: "vadodara", allahabad: "prayagraj", banaras: "varanasi",
  benaras: "varanasi", kashi: "varanasi", trivandrum: "thiruvananthapuram", vizag: "visakhapatnam", poona: "pune",
  belgaum: "belagavi", hubli: "hubballi", gulbarga: "kalaburagi",
};

export function normalize(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function queryWords(query: string): string[] {
  return normalize(query).split(" ").filter(Boolean).map((word) => citySynonyms[word] ?? word);
}

const indexed: IndexedCollege[] = nirfColleges.map(([name, city, state, acronym, aliases], place) => {
  const normalizedName = normalize(name);
  return {
    place, name, city, state, normalizedName,
    nameTokens: new Set(normalizedName.split(" ")),
    aliasTokens: new Set(normalize(aliases).split(" ").filter(Boolean)),
    acronym: normalize(acronym),
    placeTokens: new Set(normalize(`${city} ${state}`).split(" ")),
    haystack: `${normalizedName} ${normalize(aliases)} ${normalize(acronym)} ${normalize(`${city} ${state}`)}`,
  };
});

export const collegesAToZ: College[] = [...indexed].sort((a, b) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

function score(college: IndexedCollege, query: string, words: string[]): number {
  const startsWith = (word: string) => (token: string) => token.startsWith(word);
  let total = 0;
  for (const word of words) {
    if (college.aliasTokens.has(word)) total += 40;
    else if (college.acronym === word) total += 35;
    else if (college.nameTokens.has(word)) total += 30;
    else if (college.placeTokens.has(word)) total += 20;
    else if ([...college.aliasTokens].some(startsWith(word)) || college.acronym.startsWith(word)
      || [...college.nameTokens].some(startsWith(word))) total += 15;
    else if ([...college.placeTokens].some(startsWith(word))) total += 10;
    else if (college.haystack.includes(word)) total += 4;
    else return 0; // every word has to match something
  }
  if (college.normalizedName.startsWith(query)) total += 25;
  return total;
}

export function searchColleges(rawQuery: string): College[] {
  const words = queryWords(rawQuery);
  if (!words.length) return [];
  const query = words.join(" ");
  const scored = indexed
    .map((college) => [score(college, query, words), college] as const)
    .filter(([points]) => points > 0)
    .sort((a, b) => b[0] - a[0] || a[1].place - b[1].place); // ties: higher NIRF placement first
  if (!scored.length) return [];
  // Hide stray substring hits when a strong match exists.
  const floor = scored[0][0] >= 30 ? words.length * 10 : 0;
  return scored.filter(([points]) => points >= floor).slice(0, 40).map(([, college]) => college);
}

// Splits text into plain and matched parts so matches can be wrapped in <mark>.
export function highlightParts(text: string, rawQuery: string): { text: string; match: boolean }[] {
  const words = queryWords(rawQuery).filter((word) => word.length > 1).sort((a, b) => b.length - a.length);
  const ranges: [number, number][] = [];
  const lower = text.toLowerCase();
  for (const word of words) {
    const at = lower.indexOf(word);
    if (at >= 0 && !ranges.some(([start, end]) => at < end && at + word.length > start)) {
      ranges.push([at, at + word.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}
