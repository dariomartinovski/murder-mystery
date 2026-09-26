// PHASE 4 — GAME STATE
// All story flags live here.
// Puzzles update these flags in Phase 6.
// Inventory updated in Phase 5.
// ─────────────────────────────────────────
const G = {
  // Toilet
  visitedToilet: false,

  // Note — found by Table A, decoded in Phase 6
  foundNote: false,
  decodedSOS: false,       // set true when SOS puzzle solved in Phase 6

  // Table B
  tableBUnlocked: false,   // true after decodedSOS
  solvedBinary: false,     // set true when binary puzzle solved in Phase 6
  // binary answer is shirt number 23

  // Table D
  tableDConfirmed: false,  // true after she asks Table D about shirt

  // Waiter
  waiterFirstVisit: false,
  waiterHintGiven: false,  // true after solvedBinary + tableDConfirmed

  // Table C
  tableCVisited: false,    // true after first full convo with Table C
  // Table C tells her: PIN system + phone stuck on Auckland time

  // Patio — Phase 7
  patioUnlocked: false,    // true after waiterHintGiven + tableCVisited
  patioEntered: false,     // true once she has stepped outside (Phase 8 narration gate)

  // Phone — Phase 7
  foundPhone: false,
  crackedNoteApp: false,
  crackedChatApp: false,
}

// ─────────────────────────────────────────
// PHASE 4 — NPCS
// Display properties plus a state-aware entry node, so revisiting
// someone after a new discovery picks the conversation up correctly.
// ─────────────────────────────────────────
const NPCS = {
  'table-a': {
    name:      'Goran',
    portrait:  'assets/images/TableA-Goran.png',
    initial:   'A',
    color:     '#6B7B5E',
    entryNode: (G) => 'a_intro'
  },
  'table-b': {
    name:      'Darko',
    portrait:  'assets/images/TableB-Darko.png',
    initial:   'B',
    color:     '#5E6B7B',
    entryNode: (G) => {
      if (G.solvedBinary)  return 'b_done'
      if (G.decodedSOS)    return 'b_unlocked'
      return 'b_intro'
    }
  },
  'table-c': {
    name:      'Simon',
    portrait:  'assets/images/TableC-Simon.png',
    initial:   'C',
    color:     '#7B5E6B',
    entryNode: (G) => {
      if (G.tableCVisited) return 'c_revisit'
      return 'c_intro'
    }
  },
  'table-d': {
    name:      'Angel',
    portrait:  'assets/images/TableD-Angel.png',
    initial:   'D',
    color:     '#7B6B5E',
    entryNode: (G) => {
      if (G.tableDConfirmed) return 'd_done'
      if (G.solvedBinary)    return 'd_ready'
      return 'd_intro'
    }
  },
  'bar': {
    name:      'Marko',
    portrait:  'assets/images/Waiter.png',
    initial:   'M',
    color:     '#8B6914',
    entryNode: (G) => {
      if (G.waiterHintGiven)  return 'w_done'
      if (G.solvedBinary && G.tableDConfirmed && G.tableCVisited) return 'w_hint'
      return 'w_intro'
    }
  },
  'door-wc': {
    name:      'Toilet',
    initial:   '🚪',
    color:     '#3A3A3A',
    entryNode: (G) => {
      if (G.visitedToilet) return 'wc_revisit'
      return 'wc_intro'
    }
  }
  // door-exit is deliberately absent — it becomes the patio door in Phase 7
}

// ─────────────────────────────────────────
// PHASE 4 — DIALOGUE NODES
// Full conversation trees for all NPCs.
// ─────────────────────────────────────────
const NODES = {

  // ═══════════════════════════════════════
  // TOILET DOOR
  // ═══════════════════════════════════════
  'door-wc': {

    'wc_intro': {
      id: 'wc_intro',
      npcText: `The door to the men's toilet. Dario went in here
fifteen minutes ago and hasn't come back.
You push it open slowly.`,
      onEnter: () => { G.visitedToilet = true },
      options: [
        { text: 'Go inside and check.', next: 'wc_inside' }
      ]
    },

    'wc_inside': {
      id: 'wc_inside',
      npcText: `Empty. All stalls open, lights humming.
No sign of Dario. No sign of anyone.
Just a faint smell of cigarette smoke near the small window at the back.
He's not here.`,
      options: [
        {
          text: 'Go back to the restaurant.',
          next: null,
          action: () => {
            // Show toilet beat narration after dialogue closes
            setTimeout(() => {
              showNarration('toilet-beat', () => {
                // Nothing — she's back in the restaurant, free to explore
              })
            }, 400)
          }
        }
      ]
    },

    'wc_revisit': {
      id: 'wc_revisit',
      npcText: `Still empty. Whatever happened to Dario,
it didn't happen in here.`,
      options: [
        { text: 'Go back.', next: null }
      ]
    }
  },

  // ═══════════════════════════════════════
  // TABLE A — The Gentleman
  // Gives her the physical note.
  // ═══════════════════════════════════════
  'table-a': {

    'a_intro': {
      id: 'a_intro',
      npcText: `An older gentleman, sitting alone with a glass of red wine.
He looks up at you with kind, slightly worried eyes.`,
      options: [
        { text: 'Excuse me — did you see the man I was sitting with?',
          next: 'a_seen'   },
        { text: 'Sorry to bother you.',
          next: null       }
      ]
    },

    'a_seen': {
      id: 'a_seen',
      npcText: `"Your friend? Yes, I noticed him get up a while ago.
He didn't come back, did he?"
He pauses, then reaches into his breast pocket.
"I found this on the floor near the toilet.
I was going to give it to the waiter, but — here, take it.
It looked like it had been dropped in a hurry."
He slides a small folded note across the table.`,
      onEnter: () => {
        G.foundNote = true
        addToInventory('note')
      },
      options: [
        { text: 'Thank you. What does it say?',
          next: 'a_note'  },
        { text: 'Thank you.',
          next: null      }
      ]
    },

    'a_note': {
      id: 'a_note',
      npcText: `"I'm afraid I couldn't make it out.
Some kind of numbers on one side.
And the other side — well, it looked like a grid of some sort.
A pattern, maybe. I didn't want to pry."
He takes a small sip of wine.
"I hope your friend is alright."`,
      options: [
        { text: 'I\'m sure he\'s fine. Thank you.',
          next: null }
      ]
    }
  },

  // ═══════════════════════════════════════
  // TABLE B — The Programmer
  // Gives her the binary note after SOS decoded.
  // ═══════════════════════════════════════
  'table-b': {

    'b_intro': {
      id: 'b_intro',
      npcText: `A man in his thirties, laptop open, headphones around his neck.
He glances up briefly then back at his screen.`,
      options: [
        { text: 'Did you see anything unusual tonight?',
          next: 'b_nothing' },
        { text: 'Sorry to bother you.',
          next: null         }
      ]
    },

    'b_nothing': {
      id: 'b_nothing',
      npcText: `"Unusual? No. I've been working all evening.
Deadline tomorrow."
He gestures at his screen apologetically.
"I really didn't notice anything."`,
      options: [
        { text: 'Okay, thank you.',
          next: null }
      ]
    },

    'b_unlocked': {
      id: 'b_unlocked',
      npcText: `He looks up as you approach again, this time with more attention.
"Actually — now that you mention it.
I did see something earlier. A note slipped from someone nearby.
A guy, dark jacket. He was talking to your friend just before your friend
got up to leave."
He hesitates.
"I wrote down what was on it. Habit, I suppose — I do everything in binary."
He tears a corner from his notebook and slides it over.`,
      onEnter: () => {
        addToInventory('binaryNote')
      },
      options: [
        { text: 'Binary? Can you help me decode it?',
          next: 'b_hint'   },
        { text: 'Thank you — I\'ll figure it out.',
          next: null        }
      ]
    },

    'b_hint': {
      id: 'b_hint',
      npcText: `"Sure. It's a sum — the rows add up like any column
addition, just in ones and zeros. Start at the right."
He taps the air, column by column.
"Add each column going left. You carry when a column reaches two,
same as normal addition. The answer comes out in binary."
He shrugs.
"Then convert it to decimal. That's the number you want.
Sorry I can't be more useful. Good luck finding your friend."`,
      options: [
        { text: 'Thank you.',
          next: null }
      ]
    },

    'b_done': {
      id: 'b_done',
      npcText: `"Did you work it out?"
He looks at you with genuine curiosity.
"I hope it helps."`,
      options: [
        { text: 'Yes — thank you for this.',
          next: null },
        { text: 'Still working on it.',
          next: null }
      ]
    }
  },

  // ═══════════════════════════════════════
  // TABLE C — The Distracted Man
  // ═══════════════════════════════════════
  'table-c': {

    'c_intro': {
      id: 'c_intro',
      npcText: `A man sitting alone, patting his jacket pockets with a faintly
irritated expression. He looks up.`,
      options: [
        { text: 'Excuse me, did you see anything unusual tonight?',
          next: 'c_nothing'  },
        { text: 'Are you alright?',
          next: 'c_phone'    },
        { text: 'Sorry to bother you.',
          next: null          }
      ]
    },

    'c_nothing': {
      id: 'c_nothing',
      npcText: `"Unusual? No, I — actually, hang on."
He pats his jacket again, then his trouser pockets.
"Sorry, I'm distracted. I think I've lost my phone."
He looks genuinely stressed now.`,
      onEnter: () => { G.tableCVisited = true },
      options: [
        { text: 'Hmm, do you know where you had it last?',
          next: 'c_where' },
        { text: 'I\'m sorry to hear that.',
          next: null      }
      ]
    },

    'c_phone': {
      id: 'c_phone',
      npcText: `"I think I've lost my phone. It must be outside somewhere."
He looks at you, hopeful and worried at once.
"You haven't heard anything about a phone, have you?"`,
      onEnter: () => { G.tableCVisited = true },
      options: [
        { text: 'No, do you know where you had it last?',
          next: 'c_where' },
        { text: 'I hope you find it.',
          next: null      }
      ]
    },

    'c_where': {
      id: 'c_where',
      npcText: `He closes his eyes, retracing the evening.
"A piece of steak, some caesar salad, then I looked at the time —
it was still there."
"Then I wanted a cigarette, so I stepped out. Sat at one of the
tables outside — seven or eight, near the garden side."
His eyes open, worried.
"Came back in, tried to check the time again. Gone.
Black case. Cracked screen on the bottom-right corner."`,
      options: [
        { text: 'I\'ll check outside. If it\'s there, I\'ll bring it back.',
          next: 'c_thanks' },
        { text: 'Could someone get into it?',
          next: 'c_locked'  }
      ]
    },

    'c_locked': {
      id: 'c_locked',
      npcText: `"Locked, thank god."
He almost smiles.
"I'm... particular about my passcode. Nobody's getting in."
He doesn't elaborate, and something in his face says not to ask.`,
      options: [
        { text: 'Your secret. I\'ll have a look outside.',
          next: 'c_thanks' }
      ]
    },

    'c_thanks': {
      id: 'c_thanks',
      npcText: `"Oh — would you? That would be incredible, thank you."
He looks genuinely relieved.`,
      options: [
        { text: 'I\'ll have a look.',
          next: null }
      ]
    },

    'c_revisit': {
      id: 'c_revisit',
      npcText: `He looks up hopefully.
"Any luck with the phone?"`,
      options: [
        {
          text: 'Not yet — still looking.',
          condition: () => !G.foundPhone,
          next: 'c_revisit_no'
        },
        {
          text: 'I found it — I\'ll bring it back shortly.',
          condition: () => G.foundPhone && !G.crackedChatApp,
          next: 'c_revisit_found'
        },
        {
          text: 'I found what I needed. Thank you.',
          condition: () => G.crackedChatApp,
          next: null
        }
      ]
    },

    'c_revisit_no': {
      id: 'c_revisit_no',
      npcText: `"No worries. I think it was table seven or eight — near the garden side.
Black case, cracked screen."`,
      options: [
        { text: 'I\'ll keep looking.', next: null }
      ]
    },

    'c_revisit_found': {
      id: 'c_revisit_found',
      npcText: `"Oh thank goodness. Take your time — I'm not going anywhere."
He smiles with visible relief.`,
      options: [
        { text: 'I\'ll be back with it soon.', next: null }
      ]
    }
  },
  'table-d': {

    'd_intro': {
      id: 'd_intro',
      npcText: `A man settling into his seat, unfolding a napkin.
He has the slightly damp look of someone who just came in from outside.
"Just arrived," he says, before you've said anything.
"Came to wash my hands before dinner. Didn't see a thing, I'm afraid."`,
      options: [
        { text: 'Did you pass anyone near the toilet?',
          next: 'd_vague' },
        { text: 'Thank you anyway.',
          next: null         }
      ]
    },

    // Pre-binary he genuinely has nothing to offer: no coat, no number.
    // The 23 only means something once she has decoded it at Table B.
    'd_vague': {
      id: 'd_vague',
      npcText: `He thinks about it, honestly, then shakes his head.
"Nobody. The corridor was empty when I came out.
Sorry — I can't help you."`,
      options: [
        { text: 'Alright. Thank you.', next: null }
      ]
    },

    // After the binary puzzle she knows what to ask for.
    'd_ready': {
      id: 'd_ready',
      npcText: `He looks up as you approach, and something in your
expression makes him put his menu down.
"Back again? You have that look — like you've found something."`,
      options: [
        { text: 'Did you see anyone go past the toilet? A man with a number on his shirt?',
          next: 'd_number' },
        { text: 'Not yet. Thank you.',
          next: null        }
      ]
    },

    'd_number': {
      id: 'd_number',
      npcText: `His fork stops halfway to his plate.
"A number — yes. Now you say it, I see it again.
A man in a dark coat, coming out of the toilet corridor in a hurry.
Under the coat his shirt had a number on it, like a football kit."
He holds up two fingers, then three.
"Twenty-three."`,
      onEnter: () => { G.tableDConfirmed = true },
      options: [
        { text: 'Which way did he go?',
          next: 'd_direction' },
        { text: 'Thank you — that\'s exactly what I needed.',
          next: null           }
      ]
    },

    'd_direction': {
      id: 'd_direction',
      npcText: `"Toward the back of the restaurant.
There's a door back there — out to the little patio, I think.
He went that way, and he was moving."`,
      options: [
        { text: 'The back door. Thank you.', next: null }
      ]
    },

    'd_done': {
      id: 'd_done',
      npcText: `"Any luck?"
He looks at you over his menu with quiet concern.`,
      options: [
        { text: 'Getting closer. Thank you for your help.',
          next: null },
        { text: 'Still looking.',
          next: null }
      ]
    }
  },
  'bar': {

    'w_intro': {
      id: 'w_intro',
      npcText: `Marko is wiping down the bar, moving with the practiced efficiency
of someone who has worked this room for years.
He looks up.
"Everything alright? Can I get you something?"`,
      onEnter: () => { G.waiterFirstVisit = true },
      options: [
        { text: 'My friend went to the toilet twenty minutes ago and hasn\'t come back.',
          next: 'w_missing'  },
        { text: 'Did you see anything unusual tonight?',
          next: 'w_nothing'  },
        { text: 'What about the security cameras?',
          next: 'w_cameras'  }
      ]
    },

    'w_missing': {
      id: 'w_missing',
      npcText: `Marko's expression shifts — not quite concern, but attention.
"Twenty minutes? I've been making cocktails all evening,
I'm afraid I wasn't watching the floor."
He glances toward the corridor.
"You've checked the toilet?"`,
      options: [
        { text: 'Yes — he\'s not in there.',
          next: 'w_nothing'  },
        { text: 'What about the cameras?',
          next: 'w_cameras'  }
      ]
    },

    'w_nothing': {
      id: 'w_nothing',
      npcText: `"I'm sorry — I really didn't notice anything.
It's been a busy night."
He looks genuinely apologetic.`,
      options: [
        { text: 'What about the cameras?',
          next: 'w_cameras'  },
        { text: 'Thank you anyway.',
          next: null          }
      ]
    },

    'w_cameras': {
      id: 'w_cameras',
      npcText: `He winces slightly.
"The cameras. Yes."
A pause.
"The owner has been meaning to fix them for two months.
Between us — they haven't worked since October.
I keep telling him, but..."
He trails off with a shrug.`,
      options: [
        { text: 'Of course. Thank you.',
          next: null }
      ]
    },

    'w_hint': {
      id: 'w_hint',
      npcText: `Marko pauses his wiping as you approach.
Something in your expression makes him set down the cloth.
"You're still looking for your friend."
It isn't a question.
You show him what you have — the number 23.
He stares at it for a moment.
"Twenty-three. That's — actually, that's a table number.
Not inside — we have a small patio out the back. Tables six, seven, eight.
We don't use them much in winter but..."
He leans forward slightly.
"There was a man out there earlier. Having a smoke.
Dark jacket. Twenty, thirty minutes ago maybe.
I didn't think much of it."`,
      onEnter: () => {
        G.waiterHintGiven = true
        G.patioUnlocked   = true

        // Remove hint pulses — she has what she needs
        document.querySelectorAll('.npc--hint-pulse').forEach((el) => {
          el.classList.remove('npc--hint-pulse')
        })

        // Reveal patio door
        revealPatioDoor()
      },
      options: [
        { text: 'The patio. Thank you, Marko.',
          next: 'w_patio'  }
      ]
    },

    'w_patio': {
      id: 'w_patio',
      npcText: `"Door's at the back — just past the toilet corridor.
You can't miss it."
He hesitates, then adds quietly:
"I hope everything's alright."`,
      options: [
        { text: 'Me too.', next: null }
      ]
    },

    'w_done': {
      id: 'w_done',
      npcText: `Marko gives you a small nod as you pass.
"Patio's still open. Let me know if you need anything."`,
      options: [
        { text: 'Thank you.', next: null }
      ]
    }
  }
}

// ─────────────────────────────────────────
// PHASE 5 — ITEM DEFINITIONS
// Display + modal config for every item in the game, including
// ones she will not hold until later phases.
// ─────────────────────────────────────────
const ITEMS = {

  'note': {
    icon:  '📄',
    label: 'Folded Note',
    modal: 'note'
  },

  'binaryNote': {
    icon:  '🗒️',
    label: 'Torn Paper',
    modal: 'binaryNote'
  },

  // Added in Phase 7 when she finds the phone on the patio
  'receipt': {
    icon:  '🧾',
    label: 'Restaurant Receipt',
    modal: 'receipt'
  }
}

// ─────────────────────────────────────────
// PHASE 8 — NARRATIVE CONTENT
// ─────────────────────────────────────────
// Line types:
// { text: '...' }                    — normal line
// { text: '...', italic: true }      — atmosphere / internal thought
// { text: '...', highlight: true }   — dramatic beat
// { text: '', empty: true }          — paragraph break

const NARRATIVES = {

  // ── Opening — plays before game starts ──
  'intro': {
    chapter: 'earlier that evening',
    lines: [
      { text: "Let's go back.", italic: true },
      { text: '', empty: true },
      { text: "It's a Wednesday on the last day of Spring." },
      { text: "The kind of evening where the sky never really got light to begin with." },
      { text: '', empty: true },
      { text: "You're coming back from lectures." },
      { text: "Your bag is heavy. Your shoes are slightly wet from before." },
      { text: "You and your friend are waiting at the bus stop." },
      { text: "Cars rush past. People rush past. Everyone going somewhere." },
      { text: '', empty: true },
      { text: "And then ...", italic: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: "SPLASH.", highlight: true },
      { text: '', empty: true },
      { text: "A car. A puddle. Your jacket." },
      { text: "The bus hasn't even arrived yet.", italic: true },
      { text: '', empty: true },
      { text: "You go home. You change. You consider cancelling.", italic: true },
      { text: "You don't." },
      { text: '', empty: true },
      { text: "You show up anyway." },
      { text: "And there he is, waiting outside, and he smiles when he sees you," },
      { text: "and for a moment you forget about the jacket." },
      { text: '', empty: true },
      { text: "You walk in together." },
      { text: "Waiter Marko greets you. Takes you to your table." },
      { text: "The restaurant is full. Everyone seems to be having a good time." },
      { text: '', empty: true },
      { text: "You order. You talk. You eat." },
      { text: "It's a good evening.", italic: true },
      { text: '', empty: true },
      { text: "Halfway through dinner, Dario sets down his fork." },
      { text: '"I\'ll be right back," he says. "Just the toilet."' },
      { text: '', empty: true },
      { text: "You nod. You take a sip of wine." },
      { text: '', empty: true },
      { text: "You wait.", italic: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },  
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true },
      { text: '', empty: true }
    ]
  },

  // ── Toilet beat — after first toilet visit ──
  'toilet-beat': {
    chapter: 'ten minutes later',
    lines: [
      { text: "Empty." },
      { text: "All three stalls open. Lights on. No sign of anyone." },
      { text: '', empty: true },
      { text: "You check your phone. No messages.", italic: true },
      { text: "You go back to the table." },
      { text: '', empty: true },
      { text: "Another five minutes pass." },
      { text: '', empty: true },
      { text: "Then ten." },
      { text: '', empty: true },
      { text: "You look around the restaurant.", italic: true },
      { text: "Full tables. Warm noise. Clinking glasses." },
      { text: "No Dario." },
      { text: '', empty: true },
      { text: "Somebody in this room must have seen something.", highlight: true },
      { text: '', empty: true },
      { text: "You push back your chair." },
    ]
  },

  // ── SOS beat — after SOS puzzle solved ──
  'sos-beat': {
    chapter: '',
    lines: [
      { text: "S.", highlight: true },
      { text: "O.", highlight: true },
      { text: "S.", highlight: true },
      { text: '', empty: true },
      { text: "A distress signal.", italic: true },
      { text: "The international call for help." },
      { text: '', empty: true },
      { text: "He wrote this." },
      { text: "He dropped it on the floor where someone might find it." },
      { text: "He needed someone to come looking.", italic: true },
      { text: '', empty: true },
      { text: "You fold the note carefully and put it in your pocket." },
      { text: '', empty: true },
      { text: "Somebody else in this room knows something.", highlight: true },
    ]
  },

  // ── Patio enter — first time stepping outside ──
  'patio-enter': {
    chapter: 'outside',
    lines: [
      { text: "You push the door open onto a small patio." },
      { text: "Cold air. The smell of rain still in the ground." },
      { text: '', empty: true },
      { text: "Three tables. Two of them occupied — a couple, quietly talking." },
      { text: "The third table is empty." },
      { text: '', empty: true },
      { text: "A half-finished drink." },
      { text: "An ashtray. A cigarette, long since gone cold.", italic: true },
      { text: '', empty: true },
      { text: "And a phone.", highlight: true },
      { text: "Screen still on." },
      { text: '', empty: true },
      { text: "Someone left in a hurry. You can feel it.", italic: true },
    ]
  },

  // ── Chat reveal — replaces the auto-close after chat is read ──
  'chat-reveal': {
    chapter: 'oh.',
    lines: [
      { text: "He wasn't taken." },
      { text: "He wasn't in trouble." },
      { text: '', empty: true },
      { text: "He slipped out to pick up a surprise he'd arranged weeks ago." },
      { text: "While you were interviewing strangers and decoding binary sequences," },
      { text: "he was standing at the front of the restaurant", italic: true },
      { text: "holding a box and feeling extremely guilty about how long it was taking.", italic: true },
      { text: '', empty: true },
      { text: "The SOS note.", italic: true },
      { text: "The witnesses." },
      { text: "The phone on the patio." },
      { text: '', empty: true },
      { text: "All of it.", italic: true },
      { text: "A puzzle.", highlight: true },
      { text: "Built just for you.", highlight: true },
      { text: '', empty: true },
      { text: "Go to the coat rack near the entrance." },
      { text: "He's waiting." },
      { text: '', empty: true },
      { text: "Tomorrow. 20:00.", highlight: true },
    ]
  }

}

// ─────────────────────────────────────────
