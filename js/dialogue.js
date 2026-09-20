// PHASE 3 — DIALOGUE STATE
// ─────────────────────────────────────────
const dialogueState = {
  open: false,
  currentNpcId: null,
  currentNodeId: null
}

// ─────────────────────────────────────────
// PHASE 3 — DIALOGUE SYSTEM
// ─────────────────────────────────────────
const dialoguePanel   = document.getElementById('dialogue')
const dialogueAvatar  = document.getElementById('dialogue-avatar')
const dialogueNpcName = document.getElementById('dialogue-npc-name')
const dialogueText    = document.getElementById('dialogue-text')
const dialogueOptions = document.getElementById('dialogue-options')
const dialogueClose   = document.getElementById('dialogue-close')

// Both timers are owned here so that closing mid-typewriter, or walking
// straight from one NPC to another, cannot leave a stale timer writing
// into the panel.
let typeTimer    = null
let optionsTimer = null

function stopDialogueTimers() {
  if (typeTimer)    { clearInterval(typeTimer);    typeTimer    = null }
  if (optionsTimer) { clearTimeout(optionsTimer);  optionsTimer = null }
}

// ── Typewriter ──
function typeText(text, element, speed = 22) {
  if (typeTimer) { clearInterval(typeTimer); typeTimer = null }

  element.textContent = ''
  let i = 0
  if (!text.length) return

  typeTimer = setInterval(() => {
    element.textContent += text[i]
    i++
    if (i >= text.length) { clearInterval(typeTimer); typeTimer = null }
  }, speed)
}

// ── Render option buttons ──
// Options carry their own condition/action/next, so npcId is no longer
// needed here — handleOption reads it from dialogueState at click time.
function renderOptions(options) {
  dialogueOptions.innerHTML = ''

  options.forEach((option) => {
    const btn = document.createElement('button')
    btn.className   = 'dialogue__option'
    btn.textContent = option.text
    btn.addEventListener('click', () => handleOption(option))
    dialogueOptions.appendChild(btn)
  })
}

// ── Handle option click ──
function handleOption(option) {
  // Run action if defined
  if (option.action) option.action()

  if (option.next === null) {
    // Null next = close the dialogue
    closeDialogue()
    return
  }

  // Look up next node
  const npcId = dialogueState.currentNpcId
  const nodes = NODES[npcId]
  const node  = nodes ? nodes[option.next] : null

  if (!node) {
    console.warn('Missing node:', option.next, 'for NPC:', npcId)
    closeDialogue()
    return
  }

  // Check node condition
  if (node.condition && !node.condition()) {
    console.warn('Node condition not met:', option.next)
    closeDialogue()
    return
  }

  // Run onEnter if defined
  if (node.onEnter) node.onEnter()

  // Render node
  renderNode(node, npcId)
}

// ── Render a dialogue node ──
// Uses the Phase 3 --pending class rather than inline style.opacity:
// the class hides instantly (no 1 -> 0 -> 1 dip between nodes), keeps
// invisible options unclickable, and lets stopDialogueTimers() cancel
// the reveal so a close or an NPC switch mid-node can't repopulate a
// stale set of options into the panel.
function renderNode(node, npcId) {
  stopDialogueTimers()

  // Update dialogue state
  dialogueState.currentNodeId = node.id

  // Type out NPC text
  typeText(node.npcText, dialogueText)

  // Filter options by condition, reveal after a short delay
  dialogueOptions.classList.add('dialogue__options--pending')
  optionsTimer = setTimeout(() => {
    optionsTimer = null
    const visibleOptions = node.options.filter((o) => !o.condition || o.condition())
    renderOptions(visibleOptions)
    dialogueOptions.classList.remove('dialogue__options--pending')
  }, 300)
}

// ── Open panel for a given NPC ──
function openDialogue(npcId) {
  const npc = NPCS[npcId]
  if (!npc) {
    // door-exit has no dialogue until Phase 7; anything else landing here
    // means an interactable is missing its NPC definition.
    console.warn('No dialogue defined for:', npcId)
    return
  }

  stopDialogueTimers()

  // Set NPC display
  dialogueAvatar.textContent      = npc.initial
  dialogueAvatar.style.background = npc.color
  dialogueNpcName.textContent     = npc.name

  // Update state
  dialogueState.open         = true
  dialogueState.currentNpcId = npcId

  // Show panel
  dialoguePanel.classList.add('dialogue--open')
  dialoguePanel.setAttribute('aria-hidden', 'false')

  // Load the entry node this NPC should open on, given current state
  const nodes     = NODES[npcId]
  const entryNode = npc.entryNode(G)
  const node      = nodes ? nodes[entryNode] : null

  if (!node) {
    console.warn('No entry node found for:', npcId, '→', entryNode)
    closeDialogue()
    return
  }

  if (node.onEnter) node.onEnter()
  renderNode(node, npcId)
}

// ── Close panel ──
function closeDialogue() {
  stopDialogueTimers()

  dialoguePanel.classList.remove('dialogue--open')
  dialoguePanel.setAttribute('aria-hidden', 'true')

  dialogueState.open          = false
  dialogueState.currentNpcId  = null
  dialogueState.currentNodeId = null
}

// ── Close button ──
dialogueClose.addEventListener('click', closeDialogue)

// ── Escape key ──
document.addEventListener('keydown', (e) => {
  if (narrationActive) return  // narration handles its own keys
  if (e.key === 'Escape' && dialogueState.open) closeDialogue()
})

// ── Click outside the panel closes it ──
// Interactables stopPropagation, so walking to another NPC mid-conversation
// swaps the panel content instead of closing it.
scene.addEventListener('click', (e) => {
  if (dialogueState.open && !e.target.closest('.dialogue')) closeDialogue()
})

// ─────────────────────────────────────────
// PHASE 4 — STATE-DRIVEN VISUAL CUES
// ─────────────────────────────────────────

// Called from w_hint's onEnter, after G.patioUnlocked is set.
// Phase 7 gives the door real interactivity.
function revealPatioDoor() {
  const exitDoor = document.getElementById('door-exit')
  if (!exitDoor) return

  exitDoor.classList.add('door--active', 'interactable')
  exitDoor.dataset.targetX = '800'
  exitDoor.dataset.targetY = '110'

  // Remove any existing listener before adding. Phase 2 bound a generic
  // interactable handler to this element at load (walk + openDialogue,
  // which has no NPC for the door); cloning is the only way to shed an
  // anonymous listener, so the patio handler below becomes the only one.
  exitDoor.replaceWith(exitDoor.cloneNode(true))

  // Re-query after clone
  const freshDoor = document.getElementById('door-exit')
  freshDoor.classList.add('door--active', 'interactable')

  freshDoor.addEventListener('click', (e) => {
    e.stopPropagation()
    const targetX = parseInt(freshDoor.dataset.targetX, 10)
    const targetY = parseInt(freshDoor.dataset.targetY, 10)
    moveTo(targetX, targetY, () => {
      transitionToPatio()
    })
  })
}

// ─────────────────────────────────────────
