# Jeans Mixing — Android app (Parts 1 + 2)

> 🌐 **Web version — no install needed:** https://dotgeniusandnova.github.io/JeansMixing/
> Same app, runs in any phone browser (on iPhone: Safari → Share → Add to Home Screen).
> Updates go live automatically — no APK to rebuild.

A helper for the jeans-mixing job. You lay out empty boxes in a line and deal
pairs of jeans into them round-robin (like cards) — this app handles the
bookkeeping: entering sizes + quantities, reviewing them spreadsheet-style,
confirming the box count, and then guiding you while you physically place
pairs into boxes.

**Part 1 covers:** projects → fast size/quantity entry → review screen →
box-count check (total ÷ 25) → locked read-only table.
**Part 2 covers:** the placing guide — per-size placing screen with
bundle/layer tracking, +1/+5/+10 buttons, undo, manual corrections, a
timestamped history timeline, shortfall handling, and a per-box contents
lookup (☰ Boxes menu).

**Made with AI:** this app was built with the help of AI, and we're not
going to pretend otherwise. alex designed it and described every feature he
wanted; Nova (an AI assistant) wrote the code from his specs.

## What you need (on your Mac)

1. **Android Studio** — free from https://developer.android.com/studio
   (grab the Apple Silicon build if your Mac has an M1/M2/M3/M4 chip).
2. An Android phone **or** the built-in emulator (no phone required).

## Build the APK

1. Open Android Studio → **Open** → select the folder you cloned or downloaded.
2. Let it finish syncing (first time downloads Gradle and SDK pieces — takes a few minutes).
3. To test it: connect your phone with USB (turn on USB debugging in
   Developer options) **or** create a virtual phone via
   Tools → Device Manager → Create Device.
4. Press the green **Run ▶** button to install it on the phone/emulator and try it.
5. For the shareable file: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
   You'll find it at:
   `app/build/outputs/apk/debug/app-debug.apk`

## How it works

- **Launch:** create a new project (auto-named with the date + time, e.g.
  "Oct 3, 2026 12:30 AM") or open a previous one. Long-press a project to
  delete it (with a confirm popup).
- **Entry screen:** tap `[waist] x [length]`, type on the built-in number pad.
  After 2 digits the cursor jumps forward on its own; typing `00` as the
  length shows `ODD`. Tapping a box clears it; backspace on an empty box jumps
  back. `▶` / `⏎` saves the size and moves on (greyed out until the entry is
  complete); `◀` pages back through earlier entries. Exact duplicates are
  rejected with a warning. **Done** is always in the top-right.
- **Review screen:** spreadsheet-style rows (white/yellow like the work sheet)
  with editable quantities — tapping one opens the phone's keyboard. Each row
  has a delete button guarded by an "are you sure?" popup.
- **Confirm:** the app totals the pairs and divides by 25 (one box = 25 pairs).
  If it doesn't divide evenly you get an error and go back to fix things;
  otherwise it asks "750 pairs → 30 boxes. Is this correct?" — Yes locks the
  project, No takes you back.
- **Locked table:** read-only size list plus the total row. No edits, no files —
  everything lives inside the project until you delete it. The big
  **Start placing** button opens the placing guide.
- **Placing screen:** one size at a time (smallest first). Big size text up top,
  "bundle B, layer L" for the next box in the corner (with a 🔄 cue when the
  upcoming pair completes a bundle), and "X out of Y placed" underneath — tap
  it to correct the count by hand. **+1 / +5 / +10** record placements
  (capped at what's left), **↩ Undo** takes back the last tap, and **◀ ▶**
  hop between sizes to review or fix earlier ones. A timestamped **History**
  timeline at the bottom logs every tap, so double-taps are easy to spot.
  Finishing a size short pops up "you only placed X out of Y. Are you sure?" —
  Yes moves the missing pairs onto the next size so the box math stays exact.
  The **☰ Boxes** menu (top-right) shows the expected contents of any box:
  all 25 pairs with their bundle and layer.
- **Round 3 additions:** the placed line reads "13 out of 24 placed (11 left)";
  the manual count edit may now exceed needed — an overplaced number shows
  **red and underlined**, and finishing it offers to subtract the excess from
  the next size. Tapping the big size text jumps straight to any size. The
  **stapling** button (under ☰ Boxes) opens a per-size price-tag screen:
  "X out of Y placed, staple Z more", type the stapled amount (blank = all),
  Done records it to the timeline; no +1/+5/+10 there, so no fat-finger risk.
- **Placing complete:** totals plus per-size placed-vs-needed, then back to
  the project. Progress is saved in the project, so reopening it resumes
  where you left off.

## Notes

- Minimum Android version: 10 (same as the Pant Size PDF app).
- Rename the app any time in `app/src/main/res/values/strings.xml` (`app_name`).
- Projects are stored as JSON in the app's private storage — uninstalling the
  app deletes them, so keep that in mind.

## Why these features exist

Every feature was added for a reason: either to make the job faster
(convenience) or to catch and fix mistakes (troubleshooting). Written from
alex's notes, tidied up by Nova.

**Convenience — making the job faster**
- **+1 / +5 / +10 buttons:** tapping once per pair for hundreds of pairs would
  take forever; the bigger steps match how fast you actually work.
- **Live "X out of Y placed (Z left)":** progress at a glance, no mental math.
- **Box number in the corner readout** ("bundle 1, layer 6, box 2"): added at
  alex's request — while placing you need to know which physical box you're
  filling, not just the bundle and layer.
- **Tap the big size text to jump to any size:** quick navigation instead of
  paging through sizes one by one.
- **◀ ▶ between sizes:** hop back to double-check or fix an earlier size
  without losing your place.
- **☰ Boxes menu:** look up the expected contents of any box (all 25 pairs
  with bundle and layer) when you want to verify what's in front of you.
- **Editable quantities on the review screen:** for fixing numbers by hand,
  including entering a larger count than the spreadsheet listed. If the sheet
  says 13 but you actually have 24 pairs in front of you, just type 24.
- **Stapling screen with typed amounts and no +/- buttons:** price-tag
  stapling is tracked separately from placing, and typing the amount removes
  the fat-finger risk of tap buttons. It's there for when you take a break
  from placing to staple price tags — a separate counter so the two jobs
  never get mixed up.
- **Typing `00` as the length shows `ODD`:** matches the spreadsheet's
  notation for unusual sizes — a quick way to enter an odd size without ever
  pulling out the keyboard.

**Troubleshooting — catching and fixing mistakes**
- **Undo:** takes back the last tap when your thumb slips.
- **Tap "X out of Y placed" to correct the count by hand:** for when you
  realize the count is wrong after the fact.
- **History timeline:** every tap is timestamped, so double-taps and mistakes
  are easy to spot later.
- **Shortfall popup** ("you only placed X out of Y, are you sure?"): finishing
  a size short moves the missing pairs onto the next size, so the box math
  stays exact instead of silently going wrong.
- **Overplaced count shows red and underlined:** finishing with too many
  offers to subtract the excess from the next size — same idea, every box
  stays at exactly 25 pairs.
- **Duplicate size rejection:** warns instead of creating two rows for the
  same size.
- **Box-count check (total ÷ 25 must divide evenly):** a non-divisible total
  is an error, not a guess — it means the spreadsheet numbers are wrong, so
  the app sends you back to fix them instead of locking in a bad plan.
- **Locked project:** once confirmed, the size list becomes read-only. The
  entry phase is meant to copy the paper spreadsheet exactly — locking it
  means any change you make afterwards is clearly intentional, not an
  accident.
- **Flip cue (🔄):** tells you exactly when it's time to flip the pairs, so
  you don't have to bend down and count the layers yourself.
