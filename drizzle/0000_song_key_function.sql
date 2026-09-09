-- Song identity normalisation.
--
-- songs.match_key is a STORED generated column computed from this function, and a
-- generated column requires a genuinely IMMUTABLE function. That rules out unaccent(),
-- which is only STABLE and would fail at column-creation time. normalize(..., NFD) plus
-- a combining-marks strip folds diacritics with no extension dependency and no lying
-- about volatility.
--
-- Deliberately MODERATE: case, whitespace, diacritics and smart-punctuation variants
-- only. It does not strip punctuation or leading articles. In sample.json, aggressive
-- normalisation merged zero of 192 distinct names, so over-merging two real songs is the
-- likelier silent failure -- and it fails exactly as quietly as splitting one song in two.
--
-- Changing this rewrites song identity. That is recoverable: shows.raw holds the payload
-- and performances.name_raw holds the literal name, so songs can be rebuilt from stored
-- rows without touching the 1,440/day API. Rebuild deliberately; do not let it drift.
--
-- This file is deliberately pure ASCII. Every non-ASCII character is a \uXXXX escape,
-- because combining marks are invisible in an editor and trivially mangled by a save.
--
-- Requires PostgreSQL 13+ for normalize(). Neon is well past that.

CREATE OR REPLACE FUNCTION taperdeck_song_key(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $func$
  SELECT btrim(
           regexp_replace(
             translate(
               lower(
                 -- Decompose, then drop combining diacritical marks (U+0300..U+036F).
                 regexp_replace(normalize(input, NFD), E'[\u0300-\u036F]', '', 'g')
               ),
               -- Smart quotes, primes and dash variants folded to ASCII.
               -- 18 characters in, 18 out: 7 apostrophe-like, 5 quote-like, 6 dash-like.
               -- translate() maps character-for-character, so these must stay the same
               -- length as each other.
               E'\u2018\u2019\u201A\u201B\u2032\u00B4\u0060\u201C\u201D\u201E\u201F\u2033\u2013\u2014\u2015\u2010\u2011\u2012',
               E'\'\'\'\'\'\'\'"""""------'
             ),
             -- Collapse whitespace runs to a single space.
             '\s+', ' ', 'g'
           )
         );
$func$;
