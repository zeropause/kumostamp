---
name: Kumostamp
description: Where you stopped in a series, drawn on an animation timesheet.
colors:
  red-pencil: "#d23a2c"
  red-pencil-ink: "#b52c20"
  red-wash: "#f6dcd6"
  on-red: "#ffffff"
  blue-pencil: "#2d5fb8"
  blue-wash: "#dbe4f5"
  print-cyan: "#cfe5ea"
  rule-hairline: "#a9cfd9"
  rule-printed: "#3d8fa8"
  rule-ink: "#23677d"
  sheet-paper: "#eef1ea"
  sheet-paper-2: "#e2e8df"
  sheet-paper-3: "#d5ddd2"
  ink: "#1b1f1d"
  ink-2: "#48514c"
  ink-3: "#5c6560"
  night-paper: "#121816"
  night-paper-2: "#18201d"
  night-print: "#16313a"
  night-rule-hairline: "#22414a"
  night-rule-printed: "#4ea4bd"
  night-rule-ink: "#8fd0e2"
  night-ink: "#e4ebe5"
  night-red-pencil: "#ff6a55"
  night-red-pencil-ink: "#ff8a78"
  night-blue-pencil: "#7ea6ff"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, system-ui, sans-serif"
    fontSize: "clamp(34px, 4vw, 56px)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, system-ui, sans-serif"
    fontSize: "clamp(26px, 2.6vw, 34px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.15
  body:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.12em"
  button:
    fontFamily: "Barlow Condensed, Arial Narrow, Roboto Condensed, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.02em"
  timecode-display:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "clamp(56px, 8vw, 112px)"
    fontWeight: 700
    lineHeight: 0.85
    letterSpacing: "-0.04em"
    fontFeature: "tnum"
  timecode:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "tnum"
rounded:
  none: "0px"
spacing:
  row: "24px"
  cell-x: "12px"
  cell-y: "12px"
  head-cell: "20px"
  band: "32px"
  gutter: "clamp(16px, 3vw, 32px)"
components:
  button:
    backgroundColor: "{colors.sheet-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "40px"
  button-hover:
    backgroundColor: "{colors.sheet-paper-2}"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet-paper}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "40px"
  button-resume:
    backgroundColor: "{colors.red-pencil}"
    textColor: "{colors.on-red}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: "0 22px"
    height: "52px"
  button-resume-hover:
    backgroundColor: "{colors.red-pencil-ink}"
  header-cell:
    backgroundColor: "{colors.print-cyan}"
    textColor: "{colors.rule-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "10px 20px 12px"
  table-head:
    backgroundColor: "{colors.print-cyan}"
    textColor: "{colors.rule-ink}"
    typography: "{typography.label}"
    padding: "8px 12px"
  ep-box:
    textColor: "{colors.ink}"
    typography: "{typography.timecode}"
    rounded: "{rounded.none}"
    padding: "5px 6px"
    width: "44px"
  input:
    backgroundColor: "{colors.sheet-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "40px"
  ruler:
    backgroundColor: "{colors.sheet-paper}"
    height: "26px"
  ruler-xl:
    backgroundColor: "{colors.sheet-paper}"
    height: "44px"
---

# Design System: Kumostamp

## Overview

**Creative North Star: "The Animation Timesheet"**

Progress is drawn on an anime studio timesheet. Each series is a sheet, each episode a ruled row, and the place you stopped is a red-pencil mark on a minute ruler. The page is printed stationery that someone has written on: pale green-grey stock, cyan rules and header cells printed by the form, ink type, and two pencils that carry all the meaning. Red marks where you stopped. Blue marks what you finished.

Density is that of a working form, not a showcase. Everything sits in square boxed cells divided by printed rules on a 24px row pitch. Numbers are the content, so timecodes and episode numbers are set in a tabular monospace and allowed to get monumental (the Continue band timecode reaches 112px). Labels are small condensed caps printed in the form's cyan ink, the way 作品名 / 話数 / カット boxes are labelled on a real sheet.

The night sheet is the same form re-printed in phosphor cyan on blue-black stock. It appears only when the OS asks for dark, for the library or popup opened beside a playing video at night. Paper stays the canonical ground; the night sheet keeps every rule, cell and pencil role. The world refuses the streaming-app grid of poster cards on a dark ground.

**Key Characteristics:**
- Pale green-grey sheet paper, never cream, printed as cyan layout paper: a 24px cell grid, a firmer line every 5 cells, fading out down the first screen.
- Cyan print fill marks what the form printed: title-block cells and table heads.
- Two pencils carry meaning: red for the stop, blue for finished.
- Square boxed cells everywhere; no rounded cards.
- Tabular monospace for every timecode and episode number; condensed caps for form labels.
- The minute ruler is the signature instrument.

## Colors

Printed stationery: a cool paper ground, one family of cyan print, near-black ink, and two pencil colors used as marks rather than decoration.

### Primary
- **Red Pencil** (`red-pencil`): The stop mark. The ruler's mark, the Continue band timecode, and the Resume / Jump action fill. Its pressed/hover and small-text form is **Red Pencil Ink** (`red-pencil-ink`), used for per-row and popup timecodes where the brighter red would be thin on paper. **Red Wash** (`red-wash`) is the ruler fill up to the mark.

### Secondary
- **Blue Pencil** (`blue-pencil`): Finished. Replaces red on a finished episode's ruler mark, timecode, "Finished" label and episode box. Also the focus ring color. **Blue Wash** (`blue-wash`) fills a finished ruler.

### Tertiary
- **Print Cyan** (`print-cyan`): The form's printed fill. Title-block header, table heads, the selected segment, poster placeholders, the sample note.
- **Printed Rule** (`rule-printed`): Cell borders, button and input strokes, heavy 5-minute ruler ticks, 2px section dividers.
- **Hairline Rule** (`rule-hairline`): Row rules in tables, the web page's layout-paper grid, minute ticks.
- **Rule Ink** (`rule-ink`): Text printed by the form: labels on print fill, meta lines, the episode count, link-like actions.

### Neutral
- **Sheet Paper** (`sheet-paper`): The ground and every cell's resting fill. Green-grey, deliberately not cream.
- **Sheet Paper 2 / 3** (`sheet-paper-2`, `sheet-paper-3`): Hover fill, the open add panel, field focus fill.
- **Ink** (`ink`): Primary text and the fill of ink buttons, toasts and the ruler hover readout.
- **Ink 2 / Ink 3** (`ink-2`, `ink-3`): Secondary copy and quiet metadata (hosts, dates, alt titles).

### Night sheet
The `night-*` tokens replace their daylight counterparts under `prefers-color-scheme: dark` (or `data-theme="dark"`). Roles do not change: night paper is the ground, night print and rules stay cyan, the red pencil brightens to stay legible on blue-black, and `on-red` flips to a near-black (`#1d0906`) so the Resume label keeps contrast.

### Named Rules
**The Two Pencils Rule.** Red is the stop mark and nothing else: the ruler mark and its wash, timecodes, and the Resume / Jump action. Blue is finished. Neither pencil is used for decoration, emphasis, or branding.

**The Printed Form Rule.** Cyan belongs to the form, not to the user. Anything the sheet "printed" (header cells, table heads, labels, rules) is cyan; anything the viewer "wrote" is ink or pencil.

**The Not-Cream Rule.** The paper is pale green-grey (`sheet-paper`). Warm cream or white grounds break the sheet.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow, Roboto Condensed)
**Body Font:** Barlow (with system-ui, Segoe UI)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, Cascadia Mono, Consolas)

**Character:** Condensed grotesque reads like the printed labels and headings of a production form; Barlow keeps prose plain; JetBrains Mono gives every number a fixed column so timecodes line up like entries on a sheet.

### Hierarchy
- **Display** (700, clamp(34px, 4vw, 56px), 0.95): The Continue band series title; the wordmark at clamp(30px, 3.2vw, 44px); the empty-state heading up to 88px.
- **Headline** (700, clamp(26px, 2.6vw, 34px), 1): Series sheet titles; add panel heading (28px).
- **Title** (700, 19px, 1.15): Search result titles; popup empty heading (20px).
- **Body** (400, 16px, 1.5; 15px under 720px; popup 14px): Synopses (max 72ch), hints, toasts.
- **Label** (600, 11px, 0.12em, uppercase): Form labels in header cells, table heads and field captions, in rule ink.
- **Button** (600, 17px, 0.02em): Buttons and segment controls; 20px on large buttons, 15px quiet.
- **Timecode Display** (700, clamp(56px, 8vw, 112px), 0.85, tabular): The Continue band stop time. Episode number beside it at clamp(44px, 5vw, 72px).
- **Timecode** (700, 18px, tabular): Per-row stop times; episode boxes at 15px; title-block counts at 30px.

### Named Rules
**The Mono Is For Numbers Rule.** JetBrains Mono sets timecodes, episode numbers, counts and time inputs only. Words never go in mono.

**The Printed Label Rule.** Form labels are 11px condensed caps in rule ink and always label a value in the same cell (Series, Marks, Episode, Stopped at). They name a field on the sheet. They are never a decorative line above a heading.

## Layout

The page is printed as layout paper on `body::before`: a 1px cell line every row (`--rule` at 30%) and a firmer line every 5 rows (`--rule` at 65%), masked to fade to nothing over the first 900px like worn print. The 24px row pitch (`spacing.row`) is the unit for vertical gaps between sheets (2 rows) and empty-state padding (3 rows). Content sits in a 1240px column with a fluid gutter of clamp(16px, 3vw, 32px).

Top to bottom: a full-bleed printed title block (series name cell, two numeric count cells, source cell, actions), then the Continue band as one row of boxed cells (series, episode, stop time with XL ruler, actions), then the toolbar (filter + segmented control), then the stack of series sheets. Each sheet has a head (poster, title, meta, synopsis, tools) above an episode table with columns Ep, Ruler (42%), Stopped at, Providers, Actions.

At 1080px the title block wraps to three columns and the Continue band's action cell drops to its own row. At 720px header cells stack, the Continue band puts the series on its own row, and the episode table becomes per-row grids (ep / time / actions, then ruler, then providers) with the table head hidden. The popup is a fixed 368px column using the same row ruling.

## Elevation & Depth

Depth is paper, not glass. Surfaces are flat and separated by printed rules; the only lift is a series sheet sitting slightly off the page. Floating elements (toast, in-page chip) cast one soft drop shadow because they genuinely sit above a page.

### Shadow Vocabulary
- **Paper lift** (`box-shadow: 0 1px 0 rgba(255,255,255,.7) inset, 0 18px 40px -24px rgba(16,48,56,.45)`; night: `0 18px 40px -24px rgba(0,0,0,.8)`): Series sheets only.
- **Floating slip** (`box-shadow: 0 14px 34px -14px rgba(0,0,0,.55)`): The toast. The chip uses `0 10px 28px -8px rgba(10,30,30,.45)`.
- **Focus ring** (`outline: 2px solid` blue pencil, offset 2px; search and filter boxes use `box-shadow: 0 0 0 2px`): All interactive elements.

### Named Rules
**The Paper Lift Rule.** Only a sheet of paper lifts. Cells, buttons and inputs are flat and get their edge from a printed rule.

## Shapes

Square boxed cells with no radii (`rounded.none`). Containers are drawn with 1px printed rules; section boundaries (title block, add panel, Continue band, sheet heads) take a 2px printed rule. Cells inside a row are divided by a 1px left rule rather than gaps. Dashed rules mean provisional: the next unwatched episode's box, a ghost ruler, the sample-data note.

The only round geometry is functional: the 9px link-state dot and the popup's 7px live dot, and the 1.5px nib on the ruler's pencil mark.

## Components

### Buttons
Printed boxes you press.
- **Shape:** Square (0px), 1px printed-rule stroke, 40px tall (52px large, 32px quiet, 34px in tables and popup).
- **Default:** Paper fill, ink text, condensed 600.
- **Ink (primary for everything except resuming):** Ink fill, paper text. Add a series, Add mark, Add from search.
- **Resume / Jump:** Red pencil fill, `on-red` text; hover to red pencil ink. Reserved for the single action that returns the viewer to their mark.
- **Hover / Active / Focus:** Hover shifts the fill to paper 2 (ink buttons mix toward printed rule); active nudges down 1px; focus is the 2px blue ring.
- **Flat / Icon:** Transparent stroke until hover; icon buttons are 40px square with 18px line SVGs.

### Chips (provider tags)
- **Style:** Small boxed tags, paper fill, 1px printed rule, 13px body text with the provider's last time in 12px mono ink 3.
- **State:** Hover inks the border and fills with print cyan.

### Cards / Containers (series sheets)
- **Corner Style:** Square (0px).
- **Background:** Sheet paper.
- **Shadow Strategy:** Paper lift (see Elevation & Depth); a newly added sheet briefly rings in printed rule.
- **Border:** 1px printed rule; 2px under the sheet head.
- **Internal Padding:** 20px head (16px mobile); 12px table cells.

### Inputs / Fields
- **Style:** Boxed, paper fill, 1px printed rule, square, 40px tall; time and episode inputs in mono. Popup fields are cells in a ruled box with an 11px label above the value.
- **Focus:** 2px blue pencil outline (search and filter boxes ring the whole cell); popup fields fill to paper 2 with a 2px blue underline.

### Navigation (segmented control and source switch)
- **Style:** A ruled box of adjacent cells, condensed 600 16px in ink 2.
- **Selected:** Filter segments take print cyan fill with a 3px printed-rule underline; the add panel's source switch selects in ink fill.

### Title Block
The sheet's printed header: a full-width row of print-cyan cells divided by printed rules, each with an 11px label over its value (wordmark, 30px mono counts, link state, actions). The popup uses the same block at 24px brand size.

### Episode Box
The episode number in a square ruled box (min 44px, mono 700 15px). Blue stroke and text when finished; dashed and ink 3 for the next unwatched episode.

### The Ruler (signature component)
A boxed strip, one hairline tick per minute and a heavier printed-rule tick every five, drawn from the episode duration (default 24 minutes). The wash fills from the left to the mark; the mark is a 3px red pencil stroke overhanging the box by 6px (5px wide and 10px overhang on the 44px XL ruler in the Continue band). Finished rulers swap to blue mark and blue wash. Editable rulers show a crosshair, an ink hover line with a mono time readout, and act as a slider: click to set, Left/Right arrows move 10s (Shift for 60s), committing after a 700ms pause. On first paint the mark draws in from the baseline (0.7s, staggered 40ms) and the Continue band wash sweeps in. In the popup, the wash is print cyan up to the live playhead (2px ink line) with the saved stop shown as the red mark. Reduced motion removes all of it.

### Resume Chip (in-page)
A floating slip on provider pages: paper, printed rule border, floating shadow, title with a boxed episode tag, "Stopped at" with a red ink mono timecode, a 10px mini ruler, and a stacked action column with the red Jump button over Dismiss. It enters with a 0.32s rise.

## Do's and Don'ts

### Do:
- **Do** rule every surface on the 24px row pitch and divide cells with 1px printed rules.
- **Do** set every timecode and episode number in JetBrains Mono with tabular numerals.
- **Do** keep red to the stop mark, its wash, timecodes, and the Resume / Jump action; use blue for finished.
- **Do** use ink buttons for primary actions other than resuming.
- **Do** use print cyan for what the form printed: header cells, table heads, selected filter segments.
- **Do** keep every pencil and rule role intact on the night sheet; only the values change.
- **Do** label header and field cells with 11px condensed caps in rule ink, paired with the value they name.

### Don't:
- **Don't** round corners on cells, buttons, inputs, sheets or tags.
- **Don't** use a cream or white paper ground.
- **Don't** build a grid of poster cards on a dark ground; posters sit inside a sheet head.
- **Don't** use red for errors, warnings, emphasis or branding.
- **Don't** set words in mono or numbers in proportional figures.
- **Don't** add shadows to cells or buttons; only sheets lift and only floating slips cast shadows.
- **Don't** put a condensed-caps label above a heading as a kicker; labels name values in cells.

## Logo

The mark is a K whose leg is the red pencil: the leg is sharpened to a point at 45° with a small graphite tip in ink, the same pencil that marks where you stopped on every ruler. Stem and arm are solid ink and follow `currentColor`; the leg is always red pencil (`--red`). All four parts are filled shapes on a 64 grid with no strokes, so the mark stays crisp at 16px, where the pencil tip reads as a clean diagonal cut. Sources: `web/public/logo.svg`, `web/src/components/Logo.tsx`. On browser toolbars it sits on a paper tile with a cyan rule so it reads on light and dark chrome. Never recolor the leg, never outline the mark, never set the wordmark in anything but Barlow Condensed 700.

