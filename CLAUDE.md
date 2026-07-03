# CLAUDE.md

Guidance for AI assistants working in this repository.

## Project overview

**マッスルモンスターズ (Muscle Monsters)** is a gamified workout-tracking
single-page app. Users log real strength-training sets; each set grants EXP to
the muscles that exercise targets, muscles level up, and their pixel-art
"monster" characters evolve through three visual phases. It layers RPG
mechanics (levels, evolution, achievements/titles, a GitHub-style activity
calendar) and training realism (per-muscle recovery / super-compensation,
detraining, protein timing bonuses) on top of a simple set logger.

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
  App.tsx             # ★ The entire application (~1500 lines): data, logic, UI
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
purpose:

- **Types** (top): `MuscleType`, `MuscleStats`, `AppState`, `ExerciseDef`,
  `TrainingLog`, `Achievement`, `RecordResultDetail`, `TabType`.
- **Data catalogs** (constants): `ACHIEVEMENTS`, `MUSCLE_GROUPS`, `EXERCISES`,
  `INITIAL_STATE`, `MUSCLE_NAMES`, `MUSCLE_DETAILS`, `MUSCLE_RECOVERY_HOURS`.
- **Pure helpers**: `getRequiredExp`, `getEvolutionPhase`, `formatDate`.
- **`ResultRow`**: small child component animating the EXP-gain bar in the
  result modal.
- **`App`**: the single top-level component holding all state, effects, event
  handlers (`handleRecord`, `handleDrinkProtein`), `renderCalendar`, and the
  full tabbed UI.

## Core domain model

### Muscles (15 types)

`MuscleType` enumerates 15 muscles, organized for display into 5
`MUSCLE_GROUPS` (胸部 / 背部 / 肩・腕 / 腹・体幹 / 脚・お尻). Each muscle has:

- a Japanese display name (`MUSCLE_NAMES`)
- flavor/description/tips text (`MUSCLE_DETAILS`)
- a recovery window in hours (`MUSCLE_RECOVERY_HOURS`: 24, 48, or 72)

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
  increase triggers the evolution modal.
- Sprites are `/assets/{muscle}_{phase}.png` (e.g. `chest_2.png`). Any new
  muscle or phase must have matching PNGs in `public/assets/`.

### Bonuses & penalties (in `handleRecord`)

- **PUMP! bonus**: reps 8–12 AND sets 3–5 → base EXP ×1.5 (`isBestPump`).
- **Super-compensation / overwork**: training a muscle still inside its
  `MUSCLE_RECOVERY_HOURS` window halves its gain (`checkIsRecovering`).
  Same-day repeats are exempted (no penalty on the day you first trained it).
- **Protein bonus** (`handleDrinkProtein`): drinking protein within 40 min of
  training sets a ×1.5 "golden time" multiplier; within 2 h sets ×1.3. The
  multiplier is stored per muscle as `proteinBonusMultiplier` and consumed on
  the next recorded set. `hasProteinBonus` is a legacy boolean flag still read
  for backward compatibility (treated as ×1.3).
- **Detraining**: on app load, any muscle not trained for
  `DETRAIN_THRESHOLD_MS` (14 days) has its EXP halved, with a warning alert.

### Achievements

`ACHIEVEMENTS` each carry a `check(stats, logs)` predicate evaluated after every
recorded set. Newly satisfied ones unlock, show an alert, and can be equipped as
a displayed title (`selectedTitle`).

## Persistence

State is persisted to `localStorage` via `useEffect` hooks. Keys:

- `muscleStats` — the per-muscle `AppState`
- `trainingLogs` — array of `TrainingLog`
- `userBodyWeight` — number
- `unlockedAchievements` — array of achievement ids
- `selectedTitle` — equipped title string

On load, saved stats are merged over `INITIAL_STATE` so newly added muscles get
defaults. **When you add a field to a persisted structure, handle old saved data
that lacks it** (default it, like the protein/`lastTrainedAt` fields do) — real
users have existing `localStorage`.

## UI structure

Four tabs (`TabType`), switched by the fixed bottom `.tab-container`:

- `characters` (モンスター) — muscle cards grouped by body region, protein
  button, overwork/detrain alerts, per-muscle detail modal
- `record` (記録) — the logging form: recommended exercises, exercise picker,
  target preview, weight/reps/sets inputs
- `logs` (履歴) — activity calendar (`renderCalendar`) + recent log list
- `achievements` (実績) — achievement list and title selection

Modals (result / achievement / evolution / muscle detail) are rendered
conditionally with a priority order enforced by the `!recordResult &&
!achievementAlert && …` guards — preserve that ordering so only one shows at a
time.

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
  exist for run-once effects — keep them if you touch those effects.
- Time math uses `Date.now()` and millisecond constants inline; recovery/protein
  windows are computed from hours/minutes → ms in place.
- IDs for logs use `Math.random().toString(36)`.

## Making common changes

- **Add an exercise**: append an `ExerciseDef` to `EXERCISES` with a valid
  `primaryMuscle` and `targets`. It appears automatically in the picker
  (grouped by the primary muscle's `MUSCLE_GROUP`).
- **Add a muscle**: extend `MuscleType` and add matching entries to
  `INITIAL_STATE`, `MUSCLE_NAMES`, `MUSCLE_DETAILS`, `MUSCLE_RECOVERY_HOURS`,
  and the appropriate `MUSCLE_GROUPS` entry; add `{muscle}_1/2/3.png` sprites to
  `public/assets/`. TypeScript's `Record<MuscleType, …>` types will flag any you
  miss.
- **Add an achievement**: append to `ACHIEVEMENTS` with a `check` predicate.
- **Tune game balance**: EXP curve is `getRequiredExp`; base gain and bonus
  multipliers are in `handleRecord`; recovery windows in
  `MUSCLE_RECOVERY_HOURS`; detrain window in `DETRAIN_THRESHOLD_MS`.

## Git workflow

- Active development branch for this work: `claude/claude-md-docs-jnz9vn`.
  Default branch is `master`.
- History shows work merged via PRs; commit messages are often in Japanese and
  that is fine. Write clear, descriptive messages.
- Do not create a PR unless explicitly asked.
