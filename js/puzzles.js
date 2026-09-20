// PHASE 6 — PUZZLE CONSEQUENCES
// ─────────────────────────────────────────
function onSOSSolved() {
  playChime()
  // Close the item modal first
  closeItemModal()

  // Show the SOS narrative beat
  setTimeout(() => {
    showNarration('sos-beat', () => {
      // After narration, pulse Table B
      const tableBNpc = document.querySelector('#table-b .npc')
      if (tableBNpc) tableBNpc.classList.add('npc--hint-pulse')
    })
  }, 300)
}

function onBinarySolved() {
  playChime()
  // Remove the hint pulse from Table B — she's already been there
  const tableBNpc = document.querySelector('#table-b .npc')
  if (tableBNpc) {
    tableBNpc.classList.remove('npc--hint-pulse')
  }

  // Pulse Table D and the waiter to hint at next steps.
  // The bartender is a sibling of #bar in the markup, not a child,
  // so '#bar .npc' would match nothing — target him by id.
  const tableDNpc = document.querySelector('#table-d .npc')
  if (tableDNpc) tableDNpc.classList.add('npc--hint-pulse')

  const bartender = document.getElementById('bartender')
  if (bartender) bartender.classList.add('npc--hint-pulse')

  showToast('23. Someone here saw that jacket. Ask around.')
}

function onNoteAppUnlocked() {
  playChime()
  showToast('note_app unlocked. Two notes inside.')

  // Phase 7 uses G.crackedNoteApp to show the note app contents
  // and enable the timezone PIN puzzle on the chat app.
  // Nothing more to do here — Phase 7 reads the flag.
  console.log('note_app unlocked — Phase 7 reads G.crackedNoteApp')
}

// ─────────────────────────────────────────
// PHASE 6 — TOAST
// ─────────────────────────────────────────
let toastTimer = null
let toastSeq   = 0

function showToast(message, duration = 3200) {
  // Each screen owns a toast; the restaurant's lives inside a screen that
  // is hidden while she is on the patio, so pick the visible one.
  const onPatio = document.getElementById('screen-patio')
    ?.classList.contains('game-screen--active')
  const toast = document.getElementById(onPatio ? 'patio-toast' : 'toast')
  if (!toast) return

  // Clear any existing toast. The generation token matters: the 50ms
  // re-show delay means a superseded call's hide timer would otherwise
  // fire late and dismiss the newer toast early.
  clearTimeout(toastTimer)
  const seq = ++toastSeq
  toast.classList.remove('toast--visible')

  // Small delay so the removal transition fires before re-showing
  setTimeout(() => {
    if (seq !== toastSeq) return
    toast.textContent = message
    toast.classList.add('toast--visible')

    toastTimer = setTimeout(() => {
      if (seq !== toastSeq) return
      toast.classList.remove('toast--visible')
    }, duration)
  }, 50)
}

// ─────────────────────────────────────────
