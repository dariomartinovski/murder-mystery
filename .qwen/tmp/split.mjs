// One-off refactor helper: splits the monolithic index.html into css/ and js/
// files by phase banner, preserving order so the cascade and script execution
// order are unchanged. Classic (non-module) scripts keep file:// working and
// keep the globals reachable from the CDP test suites.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const ROOT = '/Users/dario.martinovski/murder-mystery'
const lines = readFileSync(`${ROOT}/index.html`, 'utf8').split('\n')

const idxOf = (pred, from = 0) => {
  for (let i = from; i < lines.length; i++) if (pred(lines[i])) return i
  throw new Error('marker not found')
}

const styleOpen  = idxOf((l) => l.trim() === '<style>')
const styleClose = idxOf((l) => l.trim() === '</style>', styleOpen)
const scriptOpen  = idxOf((l) => l.trim() === '<script>')
const scriptClose = idxOf((l) => l.trim() === '</script>', scriptOpen)

// banner line numbers (0-indexed) inside each block
const cssBanner = (tag) => idxOf((l) => l.includes(tag))
const jsBanner  = (tag) => idxOf((l) => l.includes(tag), scriptOpen)

const dedent = (arr) => arr.map((l) => (l.startsWith('    ') ? l.slice(4) : l)).join('\n')

const slice = (a, b) => lines.slice(a, b)

// ── CSS: five layer files, contiguous ranges, original order ──
// CSS banners are 3-line comments; a chunk must START at the opening
// '/* ===' line (tag - 1) and END just before the next chunk's opener, or the
// stray '*/' corrupts the first selector in the file.
const css = [
  ['css/base.css',      styleOpen + 1,                  cssBanner('PHASE 3 — DIALOGUE PANEL') - 1],
  ['css/dialogue.css',  cssBanner('PHASE 3 — DIALOGUE PANEL') - 1,  cssBanner('PHASE 5 — INVENTORY BAR') - 1],
  ['css/inventory.css', cssBanner('PHASE 5 — INVENTORY BAR') - 1,  cssBanner('PHASE 7 — SCREEN SYSTEM') - 1],
  ['css/patio.css',     cssBanner('PHASE 7 — SCREEN SYSTEM') - 1,  cssBanner('PHASE 8 — NARRATIVE PANEL') - 1],
  ['css/overlays.css',  cssBanner('PHASE 8 — NARRATIVE PANEL') - 1, styleClose],
]

// ── JS: nine files; data first, then engine layers in dependency order ──
const G0     = jsBanner('PHASE 4 — GAME STATE')
const NPCS0  = jsBanner('PHASE 4 — NPCS')
const NODES0 = jsBanner('PHASE 4 — DIALOGUE NODES')
const CUES0  = jsBanner('PHASE 4 — STATE-DRIVEN VISUAL CUES')
const DS0    = jsBanner('PHASE 3 — DIALOGUE STATE')
const DSY0   = jsBanner('PHASE 3 — DIALOGUE SYSTEM')
const ITEMS0 = jsBanner('PHASE 5 — ITEM DEFINITIONS')
const INV0   = jsBanner('PHASE 5 — INVENTORY SYSTEM')
const IMOD0  = jsBanner('PHASE 5 — ITEM MODAL')
const BLD0   = jsBanner('PHASE 5 — ITEM CONTENT BUILDERS')
const WIR0   = jsBanner('PHASE 5 — POST-RENDER WIRING')
const CON0   = jsBanner('PHASE 6 — PUZZLE CONSEQUENCES')
const TST0   = jsBanner('PHASE 6 — TOAST')
const SCR0   = jsBanner('PHASE 7 — SCREEN TRANSITIONS')
const PMV0   = jsBanner('PHASE 7 — PATIO MOVEMENT')
const PTST0  = jsBanner('PHASE 7 — PATIO TOAST')
const PST0   = jsBanner('PHASE 7 — PHONE STATE')
const PMD0   = jsBanner('PHASE 7 — PHONE MODAL')
const FRE0   = jsBanner('PHASE 7 — FINAL REVEAL')
const NAR0   = jsBanner('PHASE 8 — NARRATIVE CONTENT')
const ENG0   = jsBanner('PHASE 8 — NARRATIVE ENGINE')
const TWG0   = jsBanner('PHASE 9 — SOUND TOGGLE WIRING')
const CUR0   = jsBanner('PHASE 9 — CUSTOM CURSOR')
const INIT0  = jsBanner('PHASE 9 — LOADING & INIT')
const SND0   = jsBanner('PHASE 9 — SOUND SYSTEM')
const MOV0   = jsBanner('PHASE 2 — CHARACTER MOVEMENT')

const js = [
  ['js/data.js',      [slice(G0, NPCS0), slice(NPCS0, NODES0), slice(NODES0, CUES0), slice(ITEMS0, INV0), slice(NAR0, ENG0)]],
  ['js/audio.js',     [slice(SND0, MOV0)]],
  ['js/movement.js',  [slice(MOV0, G0), slice(PMV0, PTST0)]],
  ['js/dialogue.js',  [slice(DS0, DSY0), slice(DSY0, ITEMS0), slice(CUES0, DS0)]],
  ['js/inventory.js', [slice(INV0, IMOD0), slice(IMOD0, BLD0), slice(BLD0, WIR0), slice(WIR0, CON0)]],
  ['js/puzzles.js',   [slice(CON0, TST0), slice(TST0, SCR0)]],
  ['js/phone.js',     [slice(SCR0, PMV0), slice(PTST0, PST0), slice(PST0, PMD0), slice(PMD0, FRE0), slice(FRE0, NAR0)]],
  ['js/narration.js', [slice(ENG0, TWG0)]],
  ['js/init.js',      [slice(TWG0, CUR0), slice(CUR0, INIT0), slice(INIT0, scriptClose)]],
]

mkdirSync(`${ROOT}/css`, { recursive: true })
mkdirSync(`${ROOT}/js`, { recursive: true })

for (const [name, a, b] of css) {
  writeFileSync(`${ROOT}/${name}`, dedent(slice(a, b)) + '\n')
  console.log('wrote', name, (b - a), 'lines')
}
for (const [name, chunks] of js) {
  const body = chunks.map((c) => dedent(c)).join('\n')
  writeFileSync(`${ROOT}/${name}`, body + '\n')
  console.log('wrote', name, body.split('\n').length, 'lines')
}

// ── rewrite index.html ──
const head = lines.slice(0, styleOpen)
const between = lines.slice(styleClose + 1, scriptOpen)
const tail = lines.slice(scriptClose + 1)

const cssLinks = css.map(([n]) => `  <link rel="stylesheet" href="${n}">`).join('\n')
const jsTags = js.map(([n]) => `  <script src="${n}"></script>`).join('\n')

let out = [
  ...head,
  cssLinks,
  ...between,
  jsTags,
  ...tail,
].join('\n')

out = out.replace('<title>Phase 1 — Static Restaurant Scene</title>',
  '<title>Amigos - a murder mystery in nine courses</title>')
writeFileSync(`${ROOT}/index.html`, out)
console.log('rewrote index.html:', out.split('\n').length, 'lines')
