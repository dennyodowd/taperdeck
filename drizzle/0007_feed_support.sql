-- Support for the artist page, show detail and landing feed.

-- ---------------------------------------------------------------------------
-- Guest lookups.
--
-- `guest` is jsonb with no index, and the designs lean on it hard: "14th show with
-- Goose", "67 across 100 shows", "and 11 more who sat in once each", plus a whole feed
-- type. Every one of those aggregates by guest identity.
-- ---------------------------------------------------------------------------

CREATE INDEX performances_guest_mbid_idx
  ON performances ((guest ->> 'mbid'))
  WHERE guest IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Gap bar scale, per artist.
--
-- The bar is always relative to THAT ARTIST'S OWN longest gap, never a global maximum:
-- a full bar means "the coldest thing this band has", which is the only comparison a fan
-- is making. Every row on a 357-row page needs this number, so it is computed once here
-- rather than per render.
--
-- The floor of 24 stops a band whose longest gap is 6 from rendering three-quarter bars
-- for a two-show absence.
--
-- Because the scale moves between artists, the bar is never the value — the integer is
-- printed beside every bar and each list states its scale. See docs/design-system.md.
-- ---------------------------------------------------------------------------

CREATE VIEW artist_gap_scale AS
SELECT a.id AS artist_id,
       max(g.current_gap)::integer AS longest_gap,
       GREATEST(COALESCE(max(g.current_gap), 0), 24)::integer AS scale_max,
       (SELECT s.name
          FROM song_gap g2
          JOIN songs s ON s.id = g2.song_id
         WHERE g2.artist_id = a.id
         ORDER BY g2.current_gap DESC, s.name
         LIMIT 1) AS longest_gap_song
  FROM artists a
  LEFT JOIN song_gap g ON g.artist_id = a.id
 GROUP BY a.id;
