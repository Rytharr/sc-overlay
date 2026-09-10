/**
 * Self-check for classifyScreen's fuzzy structural anchors — the kiosk is recognized and the
 * item located even when OCR mangles the anchor glyphs (4K / high UI-scale), instead of the
 * whole screen going unrecognized. Reproduces the real 4K failures: "FABRICATION" split into
 * "FABRICA TION", and the "Tier" label read as "Tie@".
 * Run with:  npx tsx src/screen-classify.test.ts
 * Exits non-zero on any failed case.
 */
import { classifyScreen, resolveName, stripSizeGrade, bestTooltipMatch, type OcrResult, type CatalogEntry } from "./screen-read.js";

let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const CATALOG: CatalogEntry[] = [
  { name: "Palisade", item: "15ebdff2-2724-4fb3-abbf-db20e150da77" },
  { name: "TS-2", item: "8ea47c7e-f70f-469d-abc2-911cc5013854" },
  { name: "XL-1", item: "fce50a6d-690e-4b2d-9104-f3743387e1f0" },
  { name: "Aegis Dynamics S0", item: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
];

// Build an OcrResult from [text, x, y] rows (w/h don't matter for these gates).
const frame = (rows: [string, number, number][]): OcrResult => ({
  w: 3840, h: 2160,
  lines: rows.map(([text, x, y]) => ({ text, x, y, w: 200, h: 30 })),
});

// Shield: "FABRICATION" OCR-split to "FABRICA TION"; category line clean, "Tier" its own fragment.
const shield = frame([
  ["FABRICA TION KIOSK //FABRICATE", 325, 122],
  ["PALISADE", 2349, 1058],
  ["Vehicles SHIELDS", 2346, 1126],
  ["Tier", 2707, 1126],
  ["X close", 3411, 115],
]);
// Quantum drive: split title AND "Tier" mangled to "Tie@", category line mangled to "Vehicles DRIVES".
const qd = frame([
  ["FABRICA TION KIOSK //FABRICATE", 355, 140],
  ["TS-2", 2339, 1059],
  ["Vehicles DRIVES", 2339, 1125],
  ["Tie@", 2828, 1114],
  ["X close", 3411, 130],
]);
// Quantum drive "XL-1": OCR reads the digit 1 as the letter I ("XL-I") — a real Cryojenix
// contribution frame. The exact-pass 1<->I fold must still resolve it to XL-1.
const xl1 = frame([
  ["FABRICATION KIOSK //FABRICATE", 355, 140],
  ["XL-I", 2380, 1059],
  ["Vehicles QUANTUM DRIVES", 2339, 1125],
  ["Tier", 2828, 1114],
  ["X close", 3411, 130],
]);
// A non-kiosk screen must NOT be taken for a fabricator.
const notKiosk = frame([
  ["INVENTORY", 200, 100],
  ["Vehicles SHIELDS", 400, 500],
  ["Tier", 700, 500],
]);
// Another common OCR failure: a zero in a size suffix is read as the letter O, e.g. "S0"
// becomes "SO". The resolver should still match the catalog entry.
const s0 = frame([
  ["FABRICATION KIOSK //FABRICATE", 355, 140],
  ["SO", 2380, 1059],
  ["Vehicles SHIELDS", 2339, 1125],
  ["Tier", 2828, 1114],
  ["X close", 3411, 130],
]);
// Kiosk anchor present but the item area is unreadable (name/category didn't come through) ->
// a fabricator read with no item, so the capture loop can tell the user rather than fail silently.
const unreadable = frame([
  ["FABRICA TION KIOSK //FABRICATE", 355, 140],
  ["X close", 3411, 130],
]);

const shieldRead = classifyScreen(shield, CATALOG);
check("shield: split anchor still classifies as fabricator", shieldRead.kind === "fabricator", shieldRead.kind);
check("shield: resolves to Palisade", shieldRead.kind === "fabricator" && shieldRead.item === CATALOG[0].item);

const qdRead = classifyScreen(qd, CATALOG);
check("QD: split anchor + 'Tie@' still classifies", qdRead.kind === "fabricator", qdRead.kind);
check("QD: resolves to TS-2", qdRead.kind === "fabricator" && qdRead.item === CATALOG[1].item);

const xl1Read = classifyScreen(xl1, CATALOG);
check("QD: 'XL-I' (digit-1 misread) resolves to XL-1", xl1Read.kind === "fabricator" && xl1Read.item === CATALOG[2].item, xl1Read.kind === "fabricator" ? String(xl1Read.item) : xl1Read.kind);

const notRead = classifyScreen(notKiosk, CATALOG);
check("non-kiosk screen is NOT a fabricator", notRead.kind !== "fabricator", notRead.kind);

const unRead = classifyScreen(unreadable, CATALOG);
check("kiosk-but-unreadable -> fabricator with no item", unRead.kind === "fabricator" && unRead.item === null);

const s0Read = classifyScreen(s0, CATALOG);
check("size-zero 'SO' still classifies as fabricator", s0Read.kind === "fabricator");

// ── The kiosk's size/grade prefix (punkhiji, 0.1.36, 2026-08-03) ─────────────────────────────
// His radars and components "wouldn't capture". The kiosk prints a manufacturer/size/grade tag
// ahead of the name ("IND/2/B BROADSPEC") that the DATASET never carries, and the tag's tokens
// sank the whole-word overlap below its 0.6 floor — so the item resolved to nothing at all and
// the capture reported "couldn't identify this item". Not reproducible on Sub's machine: another
// player's log has the same items with no tag, so only a shared log could have found it.
{
  const PREFIX_CATALOG: CatalogEntry[] = [
    { name: "BroadSpec", item: "11111111-1111-1111-1111-111111111111" },
    { name: "BroadSpec-Go", item: "22222222-2222-2222-2222-222222222222" },
    { name: "BroadSpec-Max", item: "33333333-3333-3333-3333-333333333333" },
    { name: "Permafrost", item: "44444444-4444-4444-4444-444444444444" },
  ];
  check("the size/grade tag is stripped", stripSizeGrade("IND/2/B BroadSpec") === "BroadSpec", stripSizeGrade("IND/2/B BroadSpec"));
  check("a mixed-case manufacturer too", stripSizeGrade("Mil/2/B Permafrost") === "Permafrost", stripSizeGrade("Mil/2/B Permafrost"));
  check("an untagged name is untouched", stripSizeGrade("BroadSpec") === "BroadSpec");
  // Only a LEADING tag goes. A slash mid-name is part of the name.
  check("a slash elsewhere is untouched", stripSizeGrade("Widget A/B Thing") === "Widget A/B Thing", stripSizeGrade("Widget A/B Thing"));

  const tagged = resolveName("IND/2/B BROADSPEC", PREFIX_CATALOG);
  check("a tagged name now resolves at all", tagged.name === "BroadSpec", `${tagged.name} (${tagged.match})`);
  // Exact, not a fuzzy near-miss — the variants below only stay separable because of that.
  check("...on the EXACT pass", tagged.match === "exact", tagged.match);
  const go = resolveName("IND/2/B BROADSPEC-GO", PREFIX_CATALOG);
  check("...and -Go stays a distinct item", go.name === "BroadSpec-Go", `${go.name} (${go.match})`);
  check("an untagged name still resolves", resolveName("Permafrost", PREFIX_CATALOG).name === "Permafrost");
}

// ── Fabricator hover tooltip (bestTooltipMatch) — Rytharr, 2026-09-09 ─────────────────────────
// Unlike the selected-item panel, the hover tooltip has no category/tier row to anchor off, can
// wrap to two lines, and its position moves with whichever grid cell the cursor is over — so this
// resolves whatever names are IN the crop directly, geometry below mirrors real 3440x1440 captures.
{
  const TOOLTIP_CATALOG: CatalogEntry[] = [
    { name: "Scalpel Sniper Rifle Magazine (12 cap)", item: "aaaaaaaa-0000-0000-0000-000000000001" },
    { name: "R97 Shotgun Magazine (18 cap)", item: "aaaaaaaa-0000-0000-0000-000000000002" },
    { name: "C54 SMG Magazine (50 cap)", item: "aaaaaaaa-0000-0000-0000-000000000003" },
  ];
  // Two-line wrap, right of the hovered item — real shape from the "Scalpel" capture.
  const wrapped = [
    { text: "Scalpel Sniper Rifle", x: 1216, y: 968, w: 300, h: 34 },
    { text: "Magazine (12 cap)", x: 1216, y: 1004, w: 300, h: 34 },
  ];
  const wrappedHit = bestTooltipMatch(wrapped, TOOLTIP_CATALOG);
  check("two-line wrapped tooltip resolves as ONE name", wrappedHit?.item === TOOLTIP_CATALOG[0].item, JSON.stringify(wrappedHit));
  check("...on the exact pass", wrappedHit?.match === "exact", wrappedHit?.match);

  // Single line, no wrap.
  const single = [{ text: "R97 Shotgun Magazine (18 cap)", x: 901, y: 951, w: 340, h: 34 }];
  const singleHit = bestTooltipMatch(single, TOOLTIP_CATALOG);
  check("single-line tooltip resolves", singleHit?.item === TOOLTIP_CATALOG[1].item, JSON.stringify(singleHit));

  // Unrelated list chrome sitting in the same crop must never win over the real name beside it.
  const withChrome = [
    { text: "AMMO", x: 683, y: 420, w: 90, h: 20 },
    { text: "BLUEPRINTS", x: 683, y: 163, w: 140, h: 24 },
    { text: "1/19", x: 950, y: 1300, w: 60, h: 22 },
    { text: "C54 SMG Magazine (50 cap)", x: 659, y: 516, w: 340, h: 34 },
  ];
  const chromeHit = bestTooltipMatch(withChrome, TOOLTIP_CATALOG);
  check("real name still resolves amid list chrome", chromeHit?.item === TOOLTIP_CATALOG[2].item, JSON.stringify(chromeHit));

  // No tooltip on screen at all (just chrome) -> no match, never a wrong guess.
  const noTooltip = [
    { text: "AMMO", x: 683, y: 420, w: 90, h: 20 },
    { text: "1/19", x: 950, y: 1300, w: 60, h: 22 },
  ];
  check("no tooltip present -> null, not a guess", bestTooltipMatch(noTooltip, TOOLTIP_CATALOG) === null);

  // REAL INCIDENT (Rytharr, 2026-09-09): the live dataset has a genuinely broken row named
  // exactly "ARMOR" (a Ship.Shield component with no real name captured). A section-divider
  // line sitting bare in the crop EXACT-matched it and ticked the wrong blueprint into a real
  // collection. A section header must never resolve, no matter what garbage the dataset holds.
  const GARBAGE_CATALOG: CatalogEntry[] = [
    ...TOOLTIP_CATALOG,
    { name: "ARMOR", item: "324e5ee4-12b4-4f41-bccc-b3b001398a74" },
  ];
  const sectionHeaderOnly = [{ text: "ARMOR", x: 683, y: 420, w: 90, h: 20 }];
  check("a bare section-header line never resolves, even to a real (garbage) catalog entry",
    bestTooltipMatch(sectionHeaderOnly, GARBAGE_CATALOG) === null,
    JSON.stringify(bestTooltipMatch(sectionHeaderOnly, GARBAGE_CATALOG)));
  // A real item name that happens to START with a category word must still resolve — the
  // exclusion is "the whole line IS just the category word", not "starts with one".
  const armorPiercing: CatalogEntry[] = [{ name: "Armor Piercing Rounds", item: "bbbbbbbb-0000-0000-0000-000000000001" }];
  const piercingHit = bestTooltipMatch([{ text: "Armor Piercing Rounds", x: 683, y: 420, w: 200, h: 20 }], armorPiercing);
  check("a real name starting with a category word still resolves", piercingHit?.item === armorPiercing[0].item, JSON.stringify(piercingHit));

  // Two lines far apart on screen (not actually a wrap) must not get glued into one wrong
  // candidate — the real one still resolves on its own.
  const farApart = [
    { text: "Scalpel Sniper Rifle", x: 1216, y: 968, w: 300, h: 34 },
    { text: "C54 SMG Magazine (50 cap)", x: 659, y: 516, w: 340, h: 34 },
  ];
  const farHit = bestTooltipMatch(farApart, TOOLTIP_CATALOG);
  check("far-apart lines resolve independently, not merged", farHit?.item === TOOLTIP_CATALOG[2].item, JSON.stringify(farHit));
}

if (failed) {
  console.error(`\n${failed} case(s) FAILED`);
  process.exit(1);
}
console.log("\nall screen-classify cases passed");
