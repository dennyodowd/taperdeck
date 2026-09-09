/** Smoke-check the screen queries against live data. Read-only. */
import { config as loadEnv } from "dotenv";
import { createDb } from "../db/client.ts";
import { getArtistHeader, getArtistStats, getSongTable, getGuests, getRecentShows } from "../lib/queries/artist.ts";
import { getShowHeader, getSetlist, getShowStats, getRun, getShowGuests, getAdjacentShows } from "../lib/queries/show.ts";
import { getLandingCounts, getHeldBands, getFeed, searchHeldBands } from "../lib/queries/landing.ts";

loadEnv({ path: ".env.local", quiet: true });
const db = createDb(process.env.DATABASE_URL!);

console.log("=== landing ===");
console.log(" counts:", await getLandingCounts(db));
console.log(" bands:", (await getHeldBands(db)).map(b => `${b.name}(${b.shows}/${b.maxGap})`).join(", "));
console.log(" search 'go':", (await searchHeldBands(db, "go")).map(b => b.name).join(", "));
const feed = await getFeed(db, 8);
console.log(` feed (${feed.length}):`);
for (const f of feed) console.log(`   ${f.kind.padEnd(12)} ${f.eventDate} ${f.artistName} — ${f.headline} ${f.stat ?? ""} ${f.note ?? ""}`);

console.log("\n=== artist: Goose ===");
const a = await getArtistHeader(db, "b925a474-d245-4217-bc13-2e153d82bebb");
console.log(" header:", a);
console.log(" stats:", await getArtistStats(db, a!.id));
const songs = await getSongTable(db, a!.id);
console.log(` songs: ${songs.length}; top:`, songs.slice(0,3).map(s=>`${s.name}(gap ${s.currentGap}, ${s.timesPlayed}x, ${s.lastCity})`));
console.log(" guests:", (await getGuests(db, a!.id)).slice(0,3));
console.log(" recent:", (await getRecentShows(db, a!.id, 2)));

console.log("\n=== show detail ===");
const sid = (await getRecentShows(db, a!.id, 1))[0].showId;
const h = await getShowHeader(db, sid);
console.log(" header:", h);
console.log(" stats:", await getShowStats(db, sid));
console.log(" adjacent:", await getAdjacentShows(db, a!.id, h!.eventDate));
const set = await getSetlist(db, sid);
console.log(` setlist (${set.length}):`);
for (const s of set.slice(0,6)) console.log(`   set${s.setIndex} #${s.position} ${s.name} tape=${s.isTape} gapThatNight=${s.gapThatNight} firstHeld=${s.isFirstHeld}`);
const run = await getRun(db, a!.id, sid); console.log(` run: night ${run.position} of ${run.length} —`, run.shows.map(r=>`${r.eventDate}${r.isCurrent?"*":""}`).join(" "));
console.log(" guests:", await getShowGuests(db, sid, a!.id));
