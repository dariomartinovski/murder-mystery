// PHASE 2 — CHARACTER MOVEMENT
// ─────────────────────────────────────────
// Every coordinate below is scene-local and refers to the CENTRE of the
// player circle, in the same space as the Phase 1 absolute positions:
// origin = top-left of the scene's padding box, i.e. inside the 9px wall.
//
// Not built yet, on purpose:
//   Phase 3 — dialogue panel opens in the arrival callback
//   Phase 4 — game state checked before allowing an interaction
//   Phase 5 — inventory updated on item pickup
//   Phase 7 — door-exit becomes the patio door

// ── Constants ──
const PLAYER_SIZE     = 28
const PLAYER_HALF     = PLAYER_SIZE / 2
const SPEED_MS_PER_PX = 1.8   // walking pace
const MIN_DURATION    = 200   // ms — never snap, even for a tiny step
const MAX_DURATION    = 900   // ms — never feel sluggish on a long walk

// Outer bounds of the floor she can stand on.
// yMax is 544, not the floor's true edge: the Phase 5 inventory bar is a
// permanent 64px strip over inner y 558..622, and at 596 her 28px body
// would sit entirely behind it.
const WALKABLE = { xMin: 26, xMax: 908, yMin: 58, yMax: 544 }

// Solid things. The half-wall at y≈298 is a low railing she walks past,
// and its right-hand gap is the only route between the two halves, so it
// is deliberately NOT blocked — blocking it would trap her upstairs.
const BLOCKED = [
  { x: 536, y: 134, w:  86, h:  91 }, // Table A + chairs + guest
  { x: 146, y: 134, w:  72, h:  91 }, // Table B + chairs + guest
  { x: 134, y: 369, w:  88, h:  90 }, // Our Table + chairs
  { x: 346, y: 384, w: 104, h:  91 }, // Table C + chairs + guest
  { x: 584, y: 362, w:  72, h:  91 }, // Table D + chairs + guest
  { x:  84, y: 507, w:  72, h:  98 }, // unclickable table + patrons
  { x: 768, y: 320, w:  92, h: 264 }, // bar counter + bottles
  { x: 860, y: 320, w:  82, h: 302 }, // back bar — Marko's side
  { x:  28, y: 570, w:  32, h:  32 }, // plant, bottom-left
  { x: 894, y:  70, w:  30, h:  30 }  // plant, top-right
]

// ── State ──
const player = document.getElementById('player')
const scene  = document.querySelector('.scene')

// She starts standing in the aisle beside Our Table. The table's own
// centre (180, 420) is solid, so this is the nearest natural spot.
let playerPos = { x: 178, y: 354 }
let isMoving  = false
let pending   = null   // { onComplete } for the move currently in flight

// ── Helpers ──
function isWalkable(x, y) {
  if (x < WALKABLE.xMin || x > WALKABLE.xMax) return false
  if (y < WALKABLE.yMin || y > WALKABLE.yMax) return false

  for (const zone of BLOCKED) {
    if (x >= zone.x && x <= zone.x + zone.w &&
        y >= zone.y && y <= zone.y + zone.h) {
      return false
    }
  }
  return true
}

function renderPlayer() {
  player.style.left = (playerPos.x - PLAYER_HALF) + 'px'
  player.style.top  = (playerPos.y - PLAYER_HALF) + 'px'
}

// Scene-local point under a mouse event. clientLeft/clientTop are the
// border widths: children are positioned against the padding box, so
// getBoundingClientRect alone would be off by the 9px wall.
// Rounded: the screen wrapper can centre the scene on a half pixel and
// the input pipeline reports integers, which would otherwise leave her
// standing on .5 coordinates.
function scenePoint(e) {
  const rect = scene.getBoundingClientRect()
  return {
    x: Math.round(e.clientX - rect.left - scene.clientLeft),
    y: Math.round(e.clientY - rect.top  - scene.clientTop)
  }
}

// ── Core move function ──
// One transitionend listener for the whole session; `pending` always holds
// the newest move, so a click that supersedes a walk in progress drops the
// old callback instead of firing it late.
player.addEventListener('transitionend', (e) => {
  if (e.target !== player || e.propertyName !== 'left') return
  if (!pending) return

  const arrived = pending
  pending  = null
  isMoving = false
  player.classList.remove('player--moving')
  playFootstep()

  if (arrived.onComplete) arrived.onComplete()
})

function moveTo(x, y, onComplete) {
  if (!isWalkable(x, y)) return false

  const dx       = x - playerPos.x
  const dy       = y - playerPos.y
  const distance = Math.sqrt(dx * dx + dy * dy)

  // Already there: no transition will fire, so settle immediately.
  if (distance < 1) {
    if (onComplete) onComplete()
    return true
  }

  const duration = Math.min(
    Math.max(distance * SPEED_MS_PER_PX, MIN_DURATION),
    MAX_DURATION
  )

  player.style.transitionDuration = duration + 'ms'
  playerPos = { x, y }
  renderPlayer()

  isMoving = true
  pending  = { onComplete }
  player.classList.add('player--moving')
  return true
}

// ── Floor click — move freely ──
scene.addEventListener('click', (e) => {
  // Do not move while dialogue is open (Phase 3). The separate
  // outside-click listener below is what actually closes the panel.
  if (dialogueState.open) return

  // Do not move while an item is being examined (Phase 5).
  if (itemModal.classList.contains('item-modal--open')) return

  // Interactables have their own handler and stop propagation; this is a
  // second guard for anything that still bubbles up.
  if (e.target.closest('.interactable')) return

  const p = scenePoint(e)
  moveTo(p.x, p.y)
})

// ── Interactable click — walk to its approach position ──
// Scoped to the restaurant screen: Phase 7's patio carries .interactable
// objects too, and binding them here would drive the restaurant player
// and openDialogue() from the patio.
document.querySelectorAll('#screen-restaurant .interactable').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.stopPropagation()

    const targetX = parseInt(el.dataset.targetX, 10)
    const targetY = parseInt(el.dataset.targetY, 10)

    moveTo(targetX, targetY, () => {
      // Phase 4 — game state checked before allowing interaction
      openDialogue(el.id)
    })
  })
})

// ── Init — place her without animating in from the corner ──
player.style.transition = 'none'
renderPlayer()
void player.offsetWidth   // flush the initial position
player.style.transition = ''

// ─────────────────────────────────────────
// PHASE 7 — PATIO MOVEMENT
// Same contract as Phase 2: coordinates are the CENTRE of the 28px
// player, and a pending token keeps a superseded walk from firing its
// own onComplete at the end of the newer one.
// ─────────────────────────────────────────
const patioScene  = document.querySelector('.patio-scene')
const patioPlayer = document.getElementById('patio-player')

let patioPlayerPos = { x: 100, y: 340 }  // starts near the back door
let patioPending   = null

const PATIO_WALKABLE = {
  xMin: 85,
  xMax: 660,
  yMin: 60,
  yMax: 580
}

const PATIO_BLOCKED = [
  { x: 100, y: 140, w: 110, h: 80 }, // table 6
  { x: 360, y: 240, w: 110, h: 80 }, // table 7
  { x: 540, y: 140, w: 110, h: 80 }  // table 8
]

function patioIsWalkable(x, y) {
  if (x < PATIO_WALKABLE.xMin || x > PATIO_WALKABLE.xMax) return false
  if (y < PATIO_WALKABLE.yMin || y > PATIO_WALKABLE.yMax) return false
  for (const zone of PATIO_BLOCKED) {
    if (x >= zone.x && x <= zone.x + zone.w &&
        y >= zone.y && y <= zone.y + zone.h) return false
  }
  return true
}

function patioRenderPlayer() {
  patioPlayer.style.left = (patioPlayerPos.x - 14) + 'px'
  patioPlayer.style.top  = (patioPlayerPos.y - 14) + 'px'
}

patioPlayer.addEventListener('transitionend', (e) => {
  if (e.target !== patioPlayer || e.propertyName !== 'left') return
  if (!patioPending) return
  const arrived  = patioPending
  patioPending   = null
  playFootstep()
  if (arrived.onComplete) arrived.onComplete()
})

function patioMoveTo(x, y, onComplete) {
  if (!patioIsWalkable(x, y)) return

  const dx       = x - patioPlayerPos.x
  const dy       = y - patioPlayerPos.y
  const distance = Math.sqrt(dx * dx + dy * dy)

  // Already there: no transition will fire, so settle immediately.
  if (distance < 1) {
    if (onComplete) onComplete()
    return
  }

  const duration = Math.min(Math.max(distance * 1.8, 200), 900)

  patioPlayer.style.transitionDuration = `${duration}ms`
  patioPlayerPos = { x, y }
  patioRenderPlayer()
  patioPending = { onComplete }
}

// Patio floor click
patioScene.addEventListener('click', (e) => {
  if (patioDialogueOpen) return
  if (phoneModalOpen)    return
  if (e.target.closest('.interactable'))    return
  if (e.target.closest('.patio-back-door')) return
  // UI chrome on the patio must not double as floor
  if (e.target.closest('.inventory'))   return
  if (e.target.closest('.item-modal'))  return
  if (e.target.closest('.phone-modal')) return
  if (e.target.closest('.toast'))       return

  const rect = patioScene.getBoundingClientRect()
  // Round: the input pipeline reports half-pixel coordinates, and patio
  // positions (bounds, blocked zones, approach points) are all integers.
  patioMoveTo(
    Math.round(e.clientX - rect.left - patioScene.clientLeft),
    Math.round(e.clientY - rect.top  - patioScene.clientTop)
  )
})

// Table 7 click — approach and open phone
document.getElementById('patio-table-7').addEventListener('click', (e) => {
  e.stopPropagation()
  patioMoveTo(520, 320, () => {
    openPhoneModal()
  })
})

// Back door click — return to restaurant
document.getElementById('patio-back-door').addEventListener('click', () => {
  transitionToRestaurant()
})

// Sync inventory to patio on screen transition
function syncPatioInventory() {
  const patioSlots = document.getElementById('patio-inventory-slots')
  const mainSlots  = document.getElementById('inventory-slots')
  if (patioSlots && mainSlots) {
    patioSlots.innerHTML = mainSlots.innerHTML
    // Re-attach click handlers
    patioSlots.querySelectorAll('.inventory__item').forEach((slot) => {
      slot.addEventListener('click', () => openItemModal(slot.dataset.itemId))
    })
  }
}

// ─────────────────────────────────────────
