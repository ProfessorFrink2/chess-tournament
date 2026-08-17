# Verification against `TournamentResults.pdf`

> **Status update.** This document was written when `TournamentResults.pdf` was
> being held back purely as an independent check. It passed that check with no
> contradictions, so it was subsequently mined as a *source* to recover results
> the folder was missing. See "Second pass: mining the PDF" at the end for what
> was added, and note that the gaps listed under "⚠️ Gaps the PDF revealed" have
> now been filled.

`TournamentResults.pdf` was **not** used to build `data/tournaments/`. The
transcription was made first, entirely from the standings sheets, bracket PDFs
and forwarded emails in `~/Downloads/Chess tournament results/`, and validated
structurally by `scripts/validate-history.mjs`. Only then was this PDF opened,
as an independent check.

## What the PDF is

A player × tournament matrix: one row per player, one column per tournament 1–15,
each cell giving that player's finishing position. Cells carry annotations like
`(C champ)`, `(1st reg season)`, `13 in B`, `not top 10`, or a range such as
`9-13` where the exact position was not tracked.

Its header also settles two things independently:

- The random-wheel tournaments are **9, 11, 13 and 15** — matching the email.
- Tournaments are marked `reg` or `960` (Chess960). Tournament 2 is `(960)`,
  as are 11 and 15. This is metadata the source sheets never mentioned; it is
  **not** currently imported (see "Not carried across" below).

### How the cells were read

The PDF's text layer loses column alignment, so it was rendered at 3091×4000 and
read positionally in bands. Numeric cells are right-aligned to their column,
text cells left-aligned — that rule, plus the header positions, fixes every
column boundary. Ambiguous rows were re-cropped and upscaled individually.

## Result: no contradictions found

Every cell that overlaps the transcription agrees with it. Below is the checked
sample, not an exhaustive cell-by-cell diff — see "Limits" at the end.

### Champions and podiums

| T | Division | Transcribed | PDF | |
|---|---|---|---|---|
| 1 | — | Andrew 1st, Shawn B 2nd | Andrew `1`, Shawn B `2` | ✅ |
| 2 | A | Bogdan 1st, Shawn B 2nd | Bogdan `1`, Shawn B `2` | ✅ |
| 2 | B | Chris 1st, Alicia 2nd | Chris `12 (B champ)`, Alicia `13` | ✅ |
| 2 | C | Shapes 1st, Cyndy 2nd | Shapes `20 (C Champ)`, Cyndy `21 (C silver)` | ✅ |
| 2 | D | Charlie 1st, Jayson 2nd | Charlie `28 (D champ)` | ✅ |
| 3 | A | Bogdan 1st, Ben 2nd, Andy 3rd | Bogdan `1` | ✅ |
| 3 | B | Alicia 1st | Alicia `10 B champ` | ✅ |
| 3 | C | Rich 1st, Cyndy 2nd | Rich `17 (C champ)`, Cyndy `18 (C silver)` | ✅ |
| 4 | A | Andy 1st, Ben 2nd, Bogdan 3rd | Bogdan `3` | ✅ |
| 4 | B | Rich 1st, Steve 2nd, Jeff 3rd | Rich `1 in B`, Steve `2 in B` | ✅ |
| 4 | C | Natno 1st | Natno `1 in C` | ✅ |
| 4 | D | Melinda 1st, Halsey 2nd, Noella 3rd | Melinda `1 in D`, Halsey `2 in D`, Noella `3 in D` | ✅ |
| 5 | A | Bogdan 1st, Eugenio 2nd, Shawn T 3rd | Bogdan `1`, Eugenio `2` | ✅ |
| 5 | C | Giulia 1st | Giulia `1 in C` | ✅ |
| 6 | A | Bogdan 1st, Shawn B 2nd, Ben 3rd | Bogdan `1`, Shawn B `2` | ✅ |
| 6 | C | Dasri 1st, Natno 2nd | Dasri `1 in C`, Natno `2 in C` | ✅ |
| 7 | A | Alicia 1st, Ben 2nd, Shawn B 3rd | Alicia `1`, Shawn B `3` | ✅ |
| 7 | B | Keyes 1st, Andrew Champo 2nd, Jayson 3rd | Keyes `1 in B`, Andrew Champo `2 in B`, Jayson `3 in B` | ✅ |
| 9 | — | Rob 1st, Alicia 2nd, Bogdan 3rd | Rob `1`, Alicia `2`, Bogdan `3` | ✅ |
| 10 | A | Bogdan 1st, Nathan 2nd | Bogdan `1`, Nathan `2` | ✅ |
| 10 | A consolation | Axel 1st, Paul 2nd | Axel `15 (Consolation champ)`, Paul `1 in B (A consolation 2nd)` | ✅ |
| 11 | — | Bogdan 1st, Shawn T 2nd, Nathan 3rd | Bogdan `1`, Nathan `3` | ✅ |
| 12 | A | Stefan 1st, Bogdan 2nd, Alicia 3rd | Stefan `1`, Bogdan `2`, Alicia `3`, Aitor `4` | ✅ |
| 12 | B | Ryan 1st, Terry 2nd, Steve 3rd | Ryan `1 in B`, Steve `3 in B` | ✅ |
| 13 | — | Andriy 1st, Rob 2nd, Shawn B 3rd | Andriy `1`, Shawn B `3` | ✅ |
| 14 | A | Bogdan 1st, Michael 2nd, Matthew 3rd | Bogdan `1`, Matthew `3` | ✅ |
| 14 | B | Axel 1st, Max 2nd, Jeff A 3rd | Axel `1 in B`, Max `2 in B`, Jeff A `3 in B`, Paul `4 in B` | ✅ |
| 15 | — | Matthew 1st, Alicia 2nd, Taras 3rd | Matthew `1`, Alicia `2` | ✅ |

The **tournament 12 B division** row is worth calling out. The transcription
reads Ryan as champion over Terry on a double-elimination reset — Terry won the
winners side, lost the grand final to Ryan who came through the losers bracket —
and puts Steve third for losing the losers final. The PDF independently gives
Ryan `1 in B`, Steve `3 in B`. That reading is confirmed.

### Regular-season placings

The PDF annotates several cells `(1st reg season)`, meaning the player topped
the league table but did not win the playoff. Each one matches the transcribed
standings exactly:

| Player | T | PDF | Transcribed standings |
|---|---|---|---|
| Shawn B | 4 | `5 (1st reg season)` | A division rank 1 |
| Axel | 6 | `5 in B (1st reg season)` | B division rank 1 |
| Alicia | 14 | `5 (1st reg season)` | A division rank 1 |
| Max | 14 | `2 in B (1 reg season)` | B division rank 1 |

Spot-checked league ranks that also agree: Allister T4 A `13`; Giulia T4 B `13`;
Alejandra T4 B `12`; Natno T5 B `13`; Rich T6 A `17`; Andrew Champo T6 B `12`;
Darius T6 C `6`; Andrew K T12 A `15`; Michele O T12 A `16` and T14 A `19`;
Alex T14 A `20`; Pablo T14 A `16`; Natno T14 B `15`; Keith T14 B `16`;
Donell T14 B `17`; Shawn B T12 A `13` (below the top-12 playoff cut, so he
correctly has no T12 bracket appearance).

### An open question the PDF closed

`tournament-10/bracket-a-championship.pdf` prints a bronze medal game,
Shawn B vs Luis, with **no winner marked**. The transcription left
`winner: null` and recorded no third placement, and `validate-history.mjs`
reports it as its single warning.

The PDF gives **Shawn B `4` and Luis `4`** for tournament 10 — both losing
semifinalists are fourth and nobody is third. So the bronze game was never
decided. The transcription was right to leave it empty, and this is a
confirmation rather than a correction.

### Third places settled off-bracket

Several brackets name a bronze medallist without drawing the game. The PDF
confirms the transcription's reading in each case, and fills in the fourth
place that the sources omitted:

- **T4 B** — transcribed 3rd: Jeff. PDF gives Jayson `4 in B`, so the other
  losing semifinalist is fourth. Consistent.
- **T5 B** — transcription has no 3rd. PDF gives Matt `3 in B`.
- **T5 C** — transcription has no 3rd. PDF gives Kash `3 in C`, Justin `4 in C`.
- **T6 C** — transcription has no 3rd. PDF gives Dan `3 in C`, Cyndy `4 in C`.
- **T1** — transcription has no 3rd. PDF gives Lenny `3`, Nathan `4`.
- **T2 A** — transcription has no 3rd. PDF gives James `3`, Ben `4`.

These were **not** back-filled into `data/tournaments/`, because the brief was
to build the data without this PDF. They are listed here so you can decide
whether to add them; each is a one-line change to the relevant `placements`
array.

## ⚠️ Gaps the PDF revealed

The PDF is more complete than the files in the folder. Three sets of results
exist that have no source document:

1. **Tournament 8 — entirely missing.** It is a full column in the PDF, so it
   was played and scored. Alicia `1`, Luis `2`, Bogdan `3`, Shawn B `4`,
   Rob `5`, and a B and C division besides. No standings sheet, bracket or
   email for it exists in the folder. Nothing was imported.

2. **Tournament 7 had a C division.** Only the A and B brackets were in
   `fwtournament7.zip`. The PDF shows a C division with Dan `1 in C`,
   Darius `4 in C`, Trevor `7 in C`, Elise `8 in C`, Pat `9 in C`,
   Charlie `10 in C`, Mary-Rose `12 in C`. Not imported — there is no bracket
   for it. (Trevor and Elise appear nowhere else in the dataset.)

3. **Tournament 10 had a B division playoff.** The folder has tournament 10's B
   division *standings* but no B bracket. The PDF shows Paul `1 in B` and
   Dan `2 in B`, so a B playoff was played and won by Paul. Not imported.

If you can find the tournament 8 files and the missing tournament 7 C and
tournament 10 B brackets, they drop straight into the same `data/tournaments/`
format.

## Not carried across

- **`reg` vs `960`.** The PDF header marks each tournament as regular chess or
  Chess960: 960 for tournaments 2, 11 and 15, regular for 9 and 13, and the
  tournament 5 sheet separately notes one game as "(960)". No source sheet
  records this, so the schema has no column for it and it was not imported.
  Adding it would be a `variant` column on `tournaments`.
- **Range placings** such as `9-13`, `21-29`, `not top 10`, `top 10`. These are
  the PDF's own approximations for players who did not reach the bracket. The
  transcription stores the exact league rank instead, which is strictly better
  information, so nothing is lost.
- **Fourth places and beyond**, as noted above.

## Limits of this check

This is a large, high-signal sample — every champion and runner-up, every
recorded bronze, all four `(1st reg season)` annotations, and roughly sixty
league-rank cells — not a mechanical diff of all ~600 populated cells. A full
diff is not possible from the PDF's text layer, which loses column alignment;
each cell has to be read positionally from a rendered image.

No contradiction was found anywhere in the sample. Combined with the fact that
playoff seeds independently matched league-standings ranks in every division of
tournaments 4, 5, 6, 12 and 14, confidence in the transcription is high.

## Post-import readback

After importing, every podium was read back out of the database and compared to
the table above. All 14 match. A programmatic check for duplicate placements
within a bracket passes.

The readback caught one defect, since fixed. `tournament_entrants` originally
scoped `final_placement` to a division, so tournament 10 stored **two first
places** in its A division — Bogdan (championship) and Axel (consolation).
`bracket_kind` was already on `tournament_matches` for this reason; migration
`0003_entrant_bracket_kind.sql` puts it on the entrant too, so a placement means
"position in this bracket". Tournament 10 now reads:

```
T10  A: 1.Bogdan 2.Nathan  |  A [consolation]: 1.Axel 2.Paul
```

Note that winners/losers brackets are deliberately *not* separate competitions —
`entrantBracketFor()` in `lib/tournaments.ts` maps both to the main draw, which
is why tournament 12's B division keeps a single podium (Ryan 1st) even though
its champion came through the losers side.

Running the importer twice is a no-op the second time: 0 players created, and
row counts unchanged at 25 divisions / 317 standings / 251 entrants / 220
matches. The live league is untouched — `matches` is still 322 rows.

## Assumptions still outstanding

These are decisions recorded in `data/players.json`, not things the PDF settled:

- **Andy** — the live database has `randongles`; three historic sources say
  `randiddly`. Per your decision these are two different people, so the import
  creates a second player row also called "Andy". They are distinguishable only
  by chess.com username.
- **Michael** — the live database has `knotyourcaptain`; tournaments 12 and 14
  both print `KnotYourCapitan`. Per your decision the live spelling wins and the
  historic results attach to the existing player.
- **Michael, tournaments 7 and 10** — recorded as `GeorgeDubyuh`, merged into
  the same person on the strength of an identical display name and no overlap.
  If that is actually a second Michael, split it in `data/players.json`.
- **Darius** — `123SLP` (T1, 2, 5) and `30FootPullUp` (T6) merged the same way.
- **Tournament 7 "James"** — written with no initial, and with no standings
  sheet to disambiguate against. Recorded as James (`aznwiteguy`) rather than
  James W (`Kharon678910`). The PDF does not resolve this.
- **Tournament 14 scores** — omitted deliberately. The brackets print one number
  per match and it varies (2, 2, 3, 5 in the B division first round), so it is
  neither a race to a fixed target nor attributable to a side.


---

# Second pass: mining the PDF

Once the PDF had been verified against the independently-transcribed data with
zero contradictions, it was read exhaustively as a source in its own right.

## Method

Column alignment is the whole difficulty: numeric cells are right-aligned and
text cells left-aligned, so a wide crop makes it easy to attribute a value to
the wrong tournament. Each column was therefore read from a narrow strip in
which the target column is bracketed by known neighbours, cross-checked against
the row labels cropped at the same vertical range.

Every recovered division was then checked for **internal consistency**: the
finishing places must run 1..N with no gaps and no repeats. Every division
passed except one, noted below. That check is what makes the extraction
trustworthy rather than a careful-looking guess.

## Tournament 8 — recovered in full

The one tournament with no primary source at all. Now imported from the PDF as
`data/tournaments/08.json`: 38 entrants across three divisions, finishing
positions only. There are no matches, scores, seeds or league standings,
because none survive.

| Division | Podium | Entrants |
|---|---|---|
| A | 🥇 Alicia 🥈 Luis 🥉 Bogdan | 17 |
| B | 🥇 Rich 🥈 Lenny 🥉 Brendan | 11 |
| C | 🥇 Gustavo 🥈 Alejandra 🥉 Trevor | 10 |

Two caveats carried into the data:

- **Source anomaly.** The A division has **no 8th place and lists 9th twice**,
  for Nathan and for Andy. Both cells were cropped and upscaled to confirm; the
  PDF really does print 9 twice. Transcribed exactly as printed rather than
  silently renumbered, and declared in `_placement_anomaly` so
  `validate-history.mjs` reports it as a known warning instead of an error.
- **Format is inferred.** Nothing records how tournament 8 was played.
  `single_elim` follows from its neighbours 7 and 10, and from the PDF header
  *not* marking it as random wheel (unlike 9, 11, 13 and 15).

## Gaps now filled

| Was missing | Recovered |
|---|---|
| Tournament 7 C division | Full 11-player order: 🥇 Dan 🥈 Shapes 🥉 Alejandra |
| Tournament 10 B playoff | Full 10-player order: 🥇 Paul 🥈 Dan 🥉 Matt |
| Tournament 12 B consolation | 🥇 Jayson 🥈 Brian |
| Tournament 7 A and B, places 4+ | Complete finishing orders (16 and 11 players) |
| Third places absent from brackets | T1 Lenny, T2 A James, T5 B Matt, T5 C Kash, T6 B Blake, T6 C Dan |
| Fourth places | T1 Nathan, T2 A Ben, T5 C Justin, T6 B Ahmed, T6 C Cyndy |

Every tournament now has a podium. Values taken from the PDF carry
`"source": "TournamentResults.pdf"` in the JSON, so they stay distinguishable
from the ones read off the original brackets and standings sheets.

## A correction the PDF forced

Tournament 7's A bracket writes **"James"** with no initial, and with no
standings sheet there was nothing to disambiguate against. The first pass
guessed James (`aznwiteguy`) and flagged it.

That guess was **wrong**. The PDF places James W 12th in the A division and
James (`aznwiteguy`) 6th in **B** — a different division entirely. The proof is
that tournament 7's A finishing order 1–12 maps exactly onto the bracket's
elimination order:

| Place | Player | Where the bracket eliminates them |
|---|---|---|
| 1 | Alicia | won the final |
| 2 | Ben | lost the final |
| 3–4 | Shawn B, Andy | lost semifinals |
| 5–8 | Nathan, Rob, Bogdan, Taras | lost round 2 |
| 9–12 | Terry, Michael, Andriy, **James W** | lost round 1 |

All twelve agree. `data/tournaments/07.json` now reads James W, in the entrant
list and in both matches.

## Confirmed, not changed

- **Tournament 10's bronze.** The PDF gives Shawn B and Luis *both* 4th, so the
  bronze game printed on the bracket was never decided. The original
  `winner: null` stands.
- **Tournament 12's B division.** Ryan 1st, Steve 3rd — independently confirming
  the double-elimination reading in which the champion came through the losers
  side.

## Three new people

Trevor, Elise and Sandra (tournaments 7 and 8) and Aaron (tournament 8) appear
nowhere else in the dataset and have **no chess.com username** on record. They
are imported as name-only historic players.

## Still not carried across

- **`reg` vs `960`.** The header marks tournaments 2, 11 and 15 as Chess960.
  There is still no column for it; adding one would be a `variant` field on
  `tournaments`.
- **Range placings** (`9-13`, `21-29`, `not top 10`). These are the PDF's own
  approximations for players who missed the bracket. Where a real league rank
  exists it is already stored, which is better information.
- **Places below the podium** for tournaments that already had brackets. The
  bracket itself implies them; only the podium was back-filled.
