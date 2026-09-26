// PHASE 5 — INVENTORY SYSTEM
// ─────────────────────────────────────────

// Inventory state — ordered list of item IDs she currently holds
const inventory = []

// ── Add item ──
function addToInventory(itemId) {
  // Don't add duplicates
  if (inventory.includes(itemId)) return

  const item = ITEMS[itemId]
  if (!item) {
    console.warn('Unknown item:', itemId)
    return
  }

  inventory.push(itemId)
  renderInventory()
  highlightNewItem(itemId)
}

// ── Render all slots ──
function renderInventory() {
  const slots = document.getElementById('inventory-slots')
  slots.innerHTML = ''

  inventory.forEach((itemId) => {
    const item = ITEMS[itemId]
    if (!item) return

    const slot = document.createElement('div')
    slot.className      = 'inventory__item'
    slot.dataset.itemId = itemId
    slot.dataset.label  = item.label
    slot.textContent    = item.icon
    slot.setAttribute('role', 'button')
    slot.setAttribute('aria-label', `Examine ${item.label}`)

    slot.addEventListener('click', () => openItemModal(itemId))
    slots.appendChild(slot)
  })

  // Keep the patio bar in step whenever the restaurant bar changes, so an
  // item picked up out there (the receipt) appears in both bars at once.
  if (typeof syncPatioInventory === 'function') syncPatioInventory()
}

// ── Pulse animation on new item ──
function highlightNewItem(itemId) {
  // Small delay so the element exists in the DOM
  setTimeout(() => {
    const slot = document.querySelector(`[data-item-id="${itemId}"]`)
    if (slot) {
      slot.classList.add('inventory__item--new')
      slot.addEventListener('animationend', () => {
        slot.classList.remove('inventory__item--new')
      }, { once: true })
    }
  }, 50)
}

// ─────────────────────────────────────────
// PHASE 5 — ITEM MODAL
// ─────────────────────────────────────────
const itemModal         = document.getElementById('item-modal')
const itemModalTitle    = document.getElementById('item-modal-title')
const itemModalContent  = document.getElementById('item-modal-content')
const itemModalClose    = document.getElementById('item-modal-close')
const itemModalBackdrop = document.getElementById('item-modal-backdrop')

function openItemModal(itemId) {
  const item = ITEMS[itemId]
  if (!item) return

  itemModalTitle.textContent = item.label
  itemModalContent.innerHTML = buildItemContent(itemId)

  itemModal.classList.add('item-modal--open')
  itemModal.setAttribute('aria-hidden', 'false')

  // Wire up any puzzle inputs inside the freshly rendered content
  wirePuzzleInputs(itemId)
}

function closeItemModal() {
  itemModal.classList.remove('item-modal--open')
  itemModal.setAttribute('aria-hidden', 'true')
}

itemModalClose.addEventListener('click', closeItemModal)
itemModalBackdrop.addEventListener('click', closeItemModal)

// Clicks on the inventory bar and the item modal are UI chrome, not
// "outside the dialogue panel". Stopping them on the containers — after
// the slots' and buttons' own handlers have run — keeps the Phase 3
// outside-click listener from closing an open conversation when she
// reaches for an item mid-exchange.
document.getElementById('inventory').addEventListener('click', (e) => e.stopPropagation())
itemModal.addEventListener('click', (e) => e.stopPropagation())

// Capture phase, so that with the modal open over an open dialogue panel
// Escape peels off the topmost layer only. The Phase 3 dialogue listener
// is registered on the bubble phase and runs after this one — unless this
// one handled the key and stopped propagation.
document.addEventListener('keydown', (e) => {
  if (narrationActive) return  // narration handles its own keys
  if (e.key === 'Escape' && itemModal.classList.contains('item-modal--open')) {
    e.stopPropagation()
    closeItemModal()
  }
}, true)

// ─────────────────────────────────────────
// PHASE 5 — ITEM CONTENT BUILDERS
// Puzzle submit handlers added in Phase 6.
// ─────────────────────────────────────────
function buildItemContent(itemId) {
  switch (itemId) {
    case 'note':       return buildNote()
    case 'binaryNote': return buildBinaryNote()
    case 'receipt':    return buildReceipt()
    default:
      return '<p>You examine it carefully.</p>'
  }
}

// ── The folded note ──
// Front: numbers  16 - 8 - 16
// Back:  blank periodic table outline + T7 pattern
function buildNote() {
  return `
    <div class="note-card">

      <!-- FRONT SIDE -->
      <div class="note-side note-side--front">
        <p style="font-size:0.75rem; color:rgba(244,220,180,0.45); margin-bottom:0.5rem;">
          — front —
        </p>
        <p style="font-size:0.82rem; color:rgba(244,220,180,0.6); margin-bottom:0.75rem;">
          A small folded note, written in a hurry.
          The paper is slightly crumpled at the edges.
        </p>
        <div class="note-numbers">16 &mdash; 8 &mdash; 16</div>
        <div class="note-signature">— D</div>

        <p class="puzzle-prompt">What do these numbers mean?</p>
        <div class="puzzle-input-row">
          <input
            class="puzzle-input"
            id="puzzle-sos-input"
            type="text"
            placeholder="Decode the sequence..."
            autocomplete="off">
          <button class="puzzle-submit" id="puzzle-sos-submit">Decode</button>
        </div>
        <div class="puzzle-feedback" id="puzzle-sos-feedback"></div>

        <button class="note-flip-btn" id="note-flip-btn">
          Turn over →
        </button>
      </div>

      <!-- BACK SIDE — hidden until she flips it -->
      <div class="note-side note-side--back" id="note-back">
        <p style="font-size:0.75rem; color:rgba(244,220,180,0.45); margin-bottom:0.5rem;">
          — back —
        </p>
        <p style="font-size:0.82rem; color:rgba(244,220,180,0.6); margin-bottom:0.75rem;">
          The other side is covered in what looks like
          a faint printed grid, almost decorative.
        </p>

        <!-- Partial periodic table — CSS grid, numbers omitted, just element symbols -->
        <div style="
          display: grid;
          grid-template-columns: repeat(18, 1fr);
          gap: 2px;
          margin: 0.75rem 0;
          font-size: 0.45rem;
          font-family: 'Courier New', monospace;
          color: rgba(244,220,180,0.3);
          line-height: 1.4;
          text-align: center;
        ">
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">H</div>
          <div></div><div></div><div></div><div></div><div></div>
          <div></div><div></div><div></div><div></div><div></div>
          <div></div><div></div><div></div><div></div><div></div>
          <div></div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">He</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">Li</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">Be</div>
          <div></div><div></div><div></div><div></div><div></div>
          <div></div><div></div><div></div><div></div><div></div>
          <div></div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">B</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">C</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">N</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">O</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">F</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">Ne</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">Na</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">Mg</div>
          <div></div><div></div><div></div><div></div><div></div>
          <div></div><div></div><div></div><div></div><div></div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">Al</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">Si</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">P</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">S</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">Cl</div>
          <div style="border:1px solid rgba(244,220,180,0.15); padding:1px;">Ar</div>
        </div>

        <!-- T7 pattern -->
        <div class="t7-grid">
          k9m2r5t7x1p4w8n3q6b4<br>
          t7h2j8m5r1k9w3n6p2x8<br>
          t7n4k1m6r3h5w9q6t7b2<br>
          w8t7p4n1x5m3k7r2t7h4
        </div>

        <p style="font-size:0.72rem; color:rgba(244,220,180,0.35); font-style:italic; margin-top:0.5rem;">
          Some kind of pattern in the noise...
        </p>
      </div>

    </div>
  `
}

// ── The binary note from Table B ──
function buildBinaryNote() {
  return `
    <p style="font-size:0.82rem; color:rgba(244,220,180,0.6); margin-bottom:1rem;">
      A torn corner of a notebook page.
      Written in neat, small handwriting — all ones and zeros.
    </p>

    <div class="binary-sequence">
      0 0 0 1 0 1 1 1
    </div>

    <p style="font-size:0.78rem; color:rgba(244,220,180,0.45); text-align:center; margin-bottom:1rem;">
      (8 bits — one binary number)
    </p>

    <p class="puzzle-prompt">Convert binary to decimal.</p>
    <div class="puzzle-input-row">
      <input
        class="puzzle-input"
        id="puzzle-binary-input"
        type="text"
        placeholder="Enter the number..."
        autocomplete="off">
      <button class="puzzle-submit" id="puzzle-binary-submit">Submit</button>
    </div>
    <div class="puzzle-feedback" id="puzzle-binary-feedback"></div>
  `
}

// ── The restaurant receipt ──
// Added to inventory in Phase 7 when she finds it on the patio table
function buildReceipt() {
  return `
    <p style="font-size:0.82rem; color:rgba(244,220,180,0.6); margin-bottom:1rem;">
      A restaurant receipt from Amigos.
      Someone has scribbled something in pen at the bottom.
    </p>

    <div style="
      border: 1px solid rgba(244,220,180,0.15);
      border-radius: 4px;
      padding: 1rem;
      font-family: 'Courier New', monospace;
      font-size: 0.78rem;
      line-height: 2;
      color: rgba(244,220,180,0.75);
      background: rgba(244,168,67,0.03);
      margin-bottom: 1rem;
    ">
      <div style="text-align:center; margin-bottom:0.5rem; font-size:0.85rem;">
        AMIGOS RESTAURANT
      </div>
      <div style="border-top:1px solid rgba(244,220,180,0.1); margin-bottom:0.5rem;"></div>
      <div style="display:flex; justify-content:space-between;">
        <span>2x Taco</span><span>180den</span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <span>1x Margarita</span><span>250den</span>
      </div>
      <div style="border-top:1px solid rgba(244,220,180,0.1); margin:0.5rem 0;"></div>
      <div style="display:flex; justify-content:space-between; font-size:0.82rem;">
        <span>TOTAL</span><span>430den</span>
      </div>
      <div style="border-top:1px solid rgba(244,220,180,0.1); margin-top:0.75rem; padding-top:0.75rem; color:rgba(244,220,180,0.5); font-size:0.72rem;">
        <span style="color:rgba(244,168,67,0.6);">// scribbled in pen:</span><br>
        let word = "margarita"<br>
        while (tacos >= 0) {<br>
        &nbsp;&nbsp;note_pw += word[tacos]<br>
        &nbsp;&nbsp;tacos--<br>
        }<br>
        return note_pw
      </div>
    </div>

    <p class="puzzle-prompt">
      If tacos = 2, trace the loop. What is note_pw?
    </p>
    <div class="puzzle-input-row">
      <input
        class="puzzle-input"
        id="puzzle-receipt-input"
        type="text"
        placeholder="Enter the password..."
        autocomplete="off">
      <button class="puzzle-submit" id="puzzle-receipt-submit">Submit</button>
    </div>
    <div class="puzzle-feedback" id="puzzle-receipt-feedback"></div>
  `
}

// ─────────────────────────────────────────
// PHASE 5 — POST-RENDER WIRING
// Called after openItemModal injects content.
// Puzzle submit logic replaced in Phase 6.
// ─────────────────────────────────────────
function wirePuzzleInputs(itemId) {
  // ── Note flip button ──
  const flipBtn  = document.getElementById('note-flip-btn')
  const noteBack = document.getElementById('note-back')
  if (flipBtn && noteBack) {
    flipBtn.addEventListener('click', () => {
      const isVisible = noteBack.classList.contains('note-side--visible')
      noteBack.classList.toggle('note-side--visible', !isVisible)
      flipBtn.textContent = isVisible ? 'Turn over →' : '← Turn back'
    })
  }

  // ── SOS puzzle submit ──
  const sosSubmit = document.getElementById('puzzle-sos-submit')
  const sosInput  = document.getElementById('puzzle-sos-input')
  if (sosSubmit) {
    sosSubmit.addEventListener('click', () => {
      const answer   = sosInput.value.trim().toUpperCase()
      const feedback = document.getElementById('puzzle-sos-feedback')

      if (answer === 'SOS') {
        // Correct
        feedback.textContent = 'S — O — S. A distress signal.'
        feedback.className   = 'puzzle-feedback puzzle-feedback--correct'
        sosInput.disabled    = true
        sosSubmit.disabled   = true

        // Set flag
        G.decodedSOS = true

        // Narrative consequences
        onSOSSolved()

      } else if (answer.length === 0) {
        feedback.textContent = 'Look up each number in the periodic table.'
        feedback.className   = 'puzzle-feedback puzzle-feedback--wrong'

      } else {
        feedback.textContent = 'Not quite. Each number is an atomic number — what element does it belong to?'
        feedback.className   = 'puzzle-feedback puzzle-feedback--wrong'
      }
    })
    sosInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sosSubmit.click()
    })
  }

  // Already solved in an earlier visit — show the solved state immediately
  if (G.decodedSOS) {
    if (sosInput)  sosInput.disabled  = true
    if (sosSubmit) sosSubmit.disabled = true
    const feedback = document.getElementById('puzzle-sos-feedback')
    if (feedback) {
      feedback.textContent = 'S — O — S. A distress signal.'
      feedback.className   = 'puzzle-feedback puzzle-feedback--correct'
    }
  }

  // ── Binary puzzle submit ──
  const binarySubmit = document.getElementById('puzzle-binary-submit')
  const binaryInput  = document.getElementById('puzzle-binary-input')
  if (binarySubmit) {
    binarySubmit.addEventListener('click', () => {
      const answer   = binaryInput.value.trim()
      const feedback = document.getElementById('puzzle-binary-feedback')

      if (answer === '23') {
        // Correct
        feedback.textContent = '23. The number on the jacket.'
        feedback.className   = 'puzzle-feedback puzzle-feedback--correct'
        binaryInput.disabled = true
        binarySubmit.disabled = true

        // Set flag
        G.solvedBinary = true

        // Narrative consequence
        onBinarySolved()

      } else if (answer.length === 0) {
        feedback.textContent = 'Convert each bit position to its decimal value and add them up.'
        feedback.className   = 'puzzle-feedback puzzle-feedback--wrong'

      } else {
        feedback.textContent = 'Not quite. Start from the right — each position doubles in value.'
        feedback.className   = 'puzzle-feedback puzzle-feedback--wrong'
      }
    })
    binaryInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') binarySubmit.click()
    })
  }

  // Already solved in an earlier visit
  if (G.solvedBinary) {
    if (binaryInput)  binaryInput.disabled  = true
    if (binarySubmit) binarySubmit.disabled = true
    const feedback = document.getElementById('puzzle-binary-feedback')
    if (feedback) {
      feedback.textContent = '23. The number on the jacket.'
      feedback.className   = 'puzzle-feedback puzzle-feedback--correct'
    }
  }

  // ── Receipt puzzle submit ──
  const receiptSubmit = document.getElementById('puzzle-receipt-submit')
  const receiptInput  = document.getElementById('puzzle-receipt-input')
  if (receiptSubmit) {
    receiptSubmit.addEventListener('click', () => {
      const answer   = receiptInput.value.trim().toLowerCase()
      const feedback = document.getElementById('puzzle-receipt-feedback')

      if (answer === 'ram') {
        // Correct
        feedback.textContent  = '"ram" — the note app unlocks.'
        feedback.className    = 'puzzle-feedback puzzle-feedback--correct'
        receiptInput.disabled = true
        receiptSubmit.disabled = true

        // Set flag
        G.crackedNoteApp = true

        // Narrative consequence
        onNoteAppUnlocked()

      } else if (answer.length === 0) {
        feedback.textContent = 'Trace the loop. tacos starts at 2. word is "margarita".'
        feedback.className   = 'puzzle-feedback puzzle-feedback--wrong'

      } else {
        feedback.textContent = 'Not quite. Remember: the loop runs while tacos >= 0, not just > 0.'
        feedback.className   = 'puzzle-feedback puzzle-feedback--wrong'
      }
    })
    receiptInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') receiptSubmit.click()
    })
  }

  // Already solved in an earlier visit
  if (G.crackedNoteApp) {
    if (receiptInput)  receiptInput.disabled  = true
    if (receiptSubmit) receiptSubmit.disabled = true
    const feedback = document.getElementById('puzzle-receipt-feedback')
    if (feedback) {
      feedback.textContent = '"ram" — the note app unlocks.'
      feedback.className   = 'puzzle-feedback puzzle-feedback--correct'
    }
  }
}

// ─────────────────────────────────────────
