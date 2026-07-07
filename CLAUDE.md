# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project overview

**マッスルモンスターズ (Muscle Monsters)** is a gamified workout-tracking
single-page app. Users log real strength-training sets; each set grants EXP to
the muscles that exercise targets, muscles level up, and their pixel-art
"monster" characters evolve through three visual phases (with a branching
third form). It layers RPG mechanics (levels, evolution, achievements/titles,
a monster encyclopedia, a GitHub-style activity calendar, characters that talk
to the player) and training realism (per-muscle recovery / super-compensation,
detraining, condition management, protein timing bonuses) on top of a simple
set logger.

All user-facing text is in **Japanese**. Keep new UI copy in Japanese to match.

There is **no backend**. All state lives in the browser's `localStorage`.

## Tech stack

- **React 19** + **TypeScript** (strict), function components + hooks only
- **Vite 8** for dev server and build
- **oxlint** for linting (not ESLint)
- Runtime deps: `react-tooltip` (tooltips), `react-activity-calendar`
  (installed as a dependency, though the logs calendar is currently hand-rolled
  in `renderCalendar`)
- No test framework, no router, no state-management library, no CSS framework

## Commands

```bash
npm install       # install dependencies
npm run dev       # start Vite dev server (HMR)
npm run build     # tsc -b (typecheck) then vite build → dist/
npm run lint      # run oxlint
npm run preview   # serve the production build locally
```

There is no test suite. Before considering a change done, run `npm run build`
(it typechecks via `tsc -b`) and `npm run lint`.

## Repository layout

```
index.html            # Vite entry; mounts #root
src/
  main.tsx            # React entry — renders <App/> in StrictMode
  App.tsx             # ★ The entire application (~3700 lines): data, logic, UI
  index.css           # Global styles, CSS variables, layout, animations
  App.css             # Legacy/template styles (largely unused)
  assets/             # Bundled images imported by JS (hero.png, logos)
public/
  assets/             # Monster sprites, served statically at /assets/*
  favicon.svg, icons.svg
tsconfig*.json        # app / node project references
vite.config.ts        # Vite config (just the React plugin)
.oxlintrc.json        # oxlint config
```

### Everything is in `App.tsx`

The whole app — type definitions, game-balance constants, the data catalogs,
all game logic, and all JSX/UI — lives in `src/App.tsx`. There is no
component/module split. When editing, locate the relevant section by its
purpose (roughly top to bottom):

- **Types**: `MuscleType`, `EvolutionBranch`, `MuscleStats`, `StreakData`,
  `AppState`, `ExerciseDef`, `RecordResultDetail`, `TrainingLog`, `TabType`,
  `Achievement`.
- **Data catalogs**: `STREAK_TITLES`, `ACHIEVEMENTS`, `MUSCLE_GROUPS`,
  `EXERCISES`, `INITIAL_STATE`, `MUSCLE_NAMES`, `MUSCLE_READINGS`,
  `MUSCLE_NICKNAME_SAMPLES`, `MUSCLE_DETAILS`, `MUSCLE_RECOVERY_HOURS`.
- **Balance constants**: `DETRAIN_THRESHOLD_MS`, the `CONDITION_*` constants,
  `SUPERCOMP_BONUS`, `CONDITION_TIERS`.
- **Dialogue data**: generic line pools (`CONDITION_LINES`, `PHASE_LINES`,
  `RECOVERING_LINES`, `SUPERCOMP_LINES`, `GENERAL_LINES`) and the large
  per-muscle `CHARACTER_LINES` catalog (each muscle has a named persona with
  its own voice); `pickCharacterLine` assembles and templates a line.
- **Display metadata**: `PHASE_INFO` (encyclopedia phase labels/unlock levels),
  `BRANCH_INFO` (branch label/emoji/color/flavor), `getSpriteSrc` /
  `handleSpriteError`.
- **Pure helpers**: `getConditionTier`, `getNextStreakMilestone`, `dayDiff`,
  `getEffectiveStreak`, `getRequiredExp`, `getEvolutionPhase`, `formatDate`,
  `computeBranch`, `resolveBranch`, `EXERCISE_BY_NAME`, `MUSCLE_TO_GROUP`.
- **`ResultRow`**: small child component animating the EXP-gain bar in the
  result modal.
- **`App`**: the single top-level component holding all state, effects, event
  handlers (`handleRecord`, `handleDrinkProtein`, `handleSaveNickname`,
  `handleSavePlayerName`), the `analytics` / `historyByDay` / `historyMatrix`
  memos, the render helpers (`renderCalendar`, `renderHistoryMatrix`,
  `renderDashboard`, `renderEncyclopedia`), and the full tabbed UI + modals.

## Core domain model

### Muscles (15 types)

`MuscleType` enumerates 15 muscles, organized for display into 5
`MUSCLE_GROUPS` (胸部 / 背部 / 肩・腕 / 腹・体幹 / 脚・お尻). Each muscle has:

- a Japanese display name (`MUSCLE_NAMES`) and kana reading (`MUSCLE_READINGS`)
- flavor/description/tips text (`MUSCLE_DETAILS`)
- a recovery window in hours (`MUSCLE_RECOVERY_HOURS`: 24, 48, or 72)
- a character persona with dialogue (`CHARACTER_LINES`) and a suggested
  nickname (`MUSCLE_NICKNAME_SAMPLES`)

### Exercises

`EXERCISES` is the catalog of training moves. Each `ExerciseDef` has a
`primaryMuscle` plus a `targets` array mapping muscles to an `expRatio`
(the primary is `1.0`, assisting muscles get fractional shares). `isBodyweight`
exercises use the user's body weight instead of a weight input.

### Leveling & evolution

- `getRequiredExp(level) = level * 100` — EXP needed to reach the next level.
- Base gain is `sets * 30` EXP, distributed to each target by `expRatio`
  (`Math.max(1, floor(base * ratio))`).
- `getEvolutionPhase(level)`: 1 (Lv <5), 2 (Lv 5–9), 3 (Lv ≥10). A phase
  increase queues an evolution modal (`evolutionAlerts` is a queue; multiple
  evolutions from one record are shown one at a time).
- **Branching evolution**: on reaching phase 3, a muscle branches into a "型"
  (`EvolutionBranch`: `power` / `endurance` / `balanced`) decided from training
  tendency (`computeBranch`, weighted average reps) and locked into
  `MuscleStats.evolutionBranch`. Legacy saves fall back to on-the-fly compute via
  `resolveBranch`. Branch display metadata lives in `BRANCH_INFO`.
- Sprites are `/assets/{muscle}_{phase}.png` (e.g. `chest_2.png`). Phase-3 branch
  forms use `/assets/{muscle}_3_{branch}.png` (e.g. `chest_3_power.png`); all
  sprite `src`s go through the `getSpriteSrc` helper, which falls back to
  `{muscle}_3.png` on load error (`handleSpriteError`). Any new muscle or phase
  must have matching PNGs in `public/assets/`. See `public/assets/BRANCH_SPRITES.md`
  for the branch-sprite naming/replacement convention.

### EXP modifiers (applied in `handleRecord`, in this order)

1. **PUMP! bonus**: reps 8–12 AND sets 3–5 → base EXP ×1.5 (`isBestPump`),
   applied to the base before per-target distribution.
2. **Overwork penalty**: training a muscle still inside its
   `MUSCLE_RECOVERY_HOURS` window halves its gain (`checkIsRecovering`).
   Same-day repeats are exempt (no penalty on the day you first trained it).
   Overwork **suppresses** the protein bonus for that muscle.
3. **Protein bonus** (only if not overworked): `handleDrinkProtein` sets a
   per-muscle `proteinBonusMultiplier` — ×1.5 if drunk within 40 min of that
   muscle's last training ("golden time"), ×1.3 within 2 h. The multiplier is
   consumed (cleared) by the next recorded set. Every drink is also timestamped
   into `proteinLogs` for the history views. `hasProteinBonus` is a legacy
   boolean still read for backward compatibility (treated as ×1.3).
4. **Super-compensation / 適時トレ bonus**: training in the peak window —
   after recovery completes but before the サボり decay zone
   (`MUSCLE_RECOVERY_HOURS ≤ elapsed ≤ ×CONDITION_SABORI_GRACE_FACTOR`,
   `checkIsSuperComp`) — multiplies by `SUPERCOMP_BONUS` (×1.2). This makes
   the timing axis two-sided (too early = overwork ½, on time = ×1.2, too
   late = condition decay). Cards show a ⚡ "狙い目" badge in this window.
5. **Condition multiplier**: see below. Judged from the condition *before*
   this record ("past raising quality affects the current gain").

### Condition (調子) system

Per muscle, `MuscleStats.condition` is 0–100 with **neutral start
`DEFAULT_CONDITION = 50`** — above neutral grants an EXP bonus, below is a
penalty. `CONDITION_TIERS` (evaluated top-down by `min`):
絶好調 ≥85 ×1.3 / 好調 ≥65 ×1.15 / 普通 ≥40 ×1.0 / 不調 ≥20 ×0.85 /
絶不調 ×0.7. It never goes negative and never de-levels a muscle.

Condition moves via:
- Overwork (training while recovering): −`CONDITION_OVERWORK_PENALTY` (30).
- A proper (non-overworked) set: +`CONDITION_TRAIN_RECOVERY` (25).
- Skipping (サボり — idle past `MUSCLE_RECOVERY_HOURS ×
  CONDITION_SABORI_GRACE_FACTOR`): decays on app load at
  `CONDITION_SABORI_DECAY_PER_DAY` (8)/day, settled via `conditionUpdatedAt`
  to avoid double-counting.

### Other global mechanics

- **Detraining**: on app load, any muscle not trained for
  `DETRAIN_THRESHOLD_MS` (14 days) has its EXP halved, with a warning alert.
- **Streak** (global `StreakData`, key `trainingStreak`): consecutive training
  days on *any* muscle. Deliberately **does not grant EXP** (that would break
  the per-muscle load-linked EXP philosophy) — instead it awards **titles** at
  milestones (`STREAK_TITLES` → generated `streak_*` achievements, checked via
  `streak.best`). Missing a day resets it (`getEffectiveStreak`); the banner
  shows the next milestone title (`getNextStreakMilestone`).

### Player name, nicknames & character dialogue

- On first launch (no `playerName` in `localStorage`) a registration modal
  asks for the player's name (`PLAYER_NAME_MAX_LENGTH` 10).
- Each monster can be given a nickname in its detail modal
  (`handleSaveNickname`, max 12 chars; empty clears it back to the muscle name).
- **Only nicknamed monsters talk**: an interval effect rotates a speech bubble
  every 7 s among nicknamed muscles, picking a line via `pickCharacterLine`.
  The line pool blends condition-tier lines, phase lines, and general lines
  (plus recovering/super-comp lines when applicable) from the muscle's
  `CHARACTER_LINES` persona, falling back to the generic pools. Templates use
  `{name}` (player name) and `{nick}` (monster nickname) placeholders.
- When adding dialogue, keep each persona's first-person pronoun and speech
  style consistent (e.g. chest ゴードン is a brash big-brother「オレ」, shoulder
  パトリック is a courteous knight「私」…「{name}殿」).

### Achievements

`ACHIEVEMENTS` each carry a `check(stats, logs, streak)` predicate evaluated
after every recorded set. Newly satisfied ones unlock, show an alert, and can be
equipped as a displayed title (`selectedTitle`). Streak-milestone titles are
generated from `STREAK_TITLES` and check `streak.best`.

## Persistence

State is persisted to `localStorage` via `useEffect` hooks. Keys:

- `muscleStats` — the per-muscle `AppState`
- `trainingLogs` — array of `TrainingLog`
- `proteinLogs` — array of timestamps (ms) of protein drinks
- `userBodyWeight` — number
- `unlockedAchievements` — array of achievement ids
- `selectedTitle` — equipped title string
- `playerName` — registered player name
- `trainingStreak` — `StreakData` (`current` / `best` / `lastDate`)

On load, saved stats are merged over `INITIAL_STATE` so newly added muscles get
defaults. **When you add a field to a persisted structure, handle old saved data
that lacks it** (default it, like the protein/`lastTrainedAt`/`condition` fields
do) — real users have existing `localStorage`.

## UI structure

Five tabs (`TabType`), switched by the fixed bottom `.tab-container`:

- `characters` (モンスター) — streak banner, speech bubble from a nicknamed
  monster, muscle cards grouped by body region (each with a condition badge),
  protein button, overwork/detrain/condition alerts, per-muscle detail modal
  (condition gauge, nickname editing, and a "この部位を鍛える" shortcut that
  jumps to the record tab, with an exercise picker when several match)
- `record` (記録) — the logging form: recommended exercises, exercise picker,
  target preview, weight/reps/sets inputs
- `logs` (履歴) — analytics dashboard (`renderDashboard`: 5-group balance
  radar chart + stat tiles, computed in the `analytics` memo), activity
  calendar (`renderCalendar`), and daily records with a 一覧/表 toggle
  (`logView`) between a per-day list and a muscle×day matrix
  (`renderHistoryMatrix`, `historyMatrix` memo) — both show protein intake
  from `proteinLogs`
- `achievements` (実績) — achievement list and title selection
- `encyclopedia` (図鑑) — `renderEncyclopedia`: completion tracker
  (15 muscles × 3 forms), per-muscle form grids using `PHASE_INFO` unlock
  levels, a collapsible branch-evolution guide (`BRANCH_INFO`), and a static
  info modal (`selectedZukanMuscle` / `selectedZukanPhase`) showing the tapped
  form's sprite and the muscle's `MUSCLE_DETAILS`

Modals (player registration / result / achievement / evolution / muscle detail
/ encyclopedia) are rendered conditionally with a priority order enforced by
the `!recordResult && !achievementAlert && …` guards — preserve that ordering
so only one shows at a time. `evolutionAlerts` is a queue consumed one modal
at a time via `closeEvolutionAlert`.

## Conventions

- **Styling**: predominantly **inline styles** on JSX, with a set of shared
  classes and CSS custom properties (`--text-primary`, `--text-accent`,
  `--border-highlight`, etc.) defined in `src/index.css`. The theme is a dark,
  neon "retro game" look. Reuse the existing CSS variables and utility classes
  (`glass-panel`, `muscle-card`, `modal-overlay`, `tab-button`) rather than
  introducing a new styling approach.
- **TypeScript is strict**: `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, `verbatimModuleSyntax` are on. Use
  `import type` for type-only imports.
- **Lint**: oxlint enforces `react/rules-of-hooks` (error). A couple of
  intentional `eslint-disable-next-line react-hooks/exhaustive-deps` comments
  exist for run-once/interval effects — keep them if you touch those effects.
- Code comments are written in Japanese; match that when adding comments.
- Time math uses `Date.now()` and millisecond constants inline; recovery/protein
  windows are computed from hours/minutes → ms in place.
- IDs for logs use `Math.random().toString(36)`.

## Making common changes

- **Add an exercise**: append an `ExerciseDef` to `EXERCISES` with a valid
  `primaryMuscle` and `targets`. It appears automatically in the picker
  (grouped by the primary muscle's `MUSCLE_GROUP`).
- **Add a muscle**: extend `MuscleType` and add matching entries to
  `INITIAL_STATE`, `MUSCLE_NAMES`, `MUSCLE_READINGS`,
  `MUSCLE_NICKNAME_SAMPLES`, `MUSCLE_DETAILS`, `MUSCLE_RECOVERY_HOURS`,
  `CHARACTER_LINES`, and the appropriate `MUSCLE_GROUPS` entry; add
  `{muscle}_1/2/3.png` (and `_3_{branch}.png`) sprites to `public/assets/`.
  TypeScript's `Record<MuscleType, …>` types will flag any you miss.
- **Add an achievement**: append to `ACHIEVEMENTS` with a `check` predicate.
- **Add dialogue**: extend the muscle's `CHARACTER_LINES` entry (or the generic
  pools); use `{name}` / `{nick}` placeholders and keep the persona's voice.
- **Tune game balance**: EXP curve is `getRequiredExp`; base gain and bonus
  multipliers are in `handleRecord`; condition tiers/constants are the
  `CONDITION_*` block; recovery windows in `MUSCLE_RECOVERY_HOURS`; detrain
  window in `DETRAIN_THRESHOLD_MS`.

## Git workflow

- Default branch is `master`; work is merged via PRs from feature branches.
- Commit messages are often in Japanese and that is fine. Write clear,
  descriptive messages.
- Do not create a PR unless explicitly asked.
