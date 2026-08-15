# Spec — What a tab is for, said once

Every tab in this app is discoverable by poking at it, which is another way of saying that none
of them says what it is for. The Deck Builder is a mat you can drag a card onto empty felt to
make a pile with; the Set Browser filters by what the group owns; Pick Night has a deck pool
behind a drawer. All of that is real and none of it is announced. This is the spec for a short
note that opens itself the first time you arrive on a tab, says what the tab does and which keys
it answers to, and then never appears again unless you ask for it.

It also adds two keys, which is most of the reason the note has anything to put under *keys* at
all.

---

## Ground truth — the keyboard, today

Worth writing down because it sets the size of the *keys* half of this feature. The whole
inventory, found by reading every `keydown` listener in `public/js/`:

| Key      | Where                              | What                                            |
|----------|------------------------------------|-------------------------------------------------|
| `Escape` | `main.js`, `sortui.js`             | closes drawers, the appearance popover, the card modal, an open sort menu |
| `Enter`  | six fields                         | submits that field — add a card, run a search, name a player |
| `c`      | `deckview-core.js`, Deck Builder   | folds the frame away, one tier per press — **was `f` until this spec** |
| `m`      | `deckview-core.js`, Deck Builder   | the menu beside the mat, open or closed         |
| `/`      | `deckview-core.js`, Deck Builder   | opens the search drawer and puts the caret in it |
| `Ctrl+A` | `deckview-core.js`, Deck Builder   | selects every card the filter is showing         |

There is no card selection model, no roving focus, and nothing on any tab but the Deck Builder. So
a per-tab FAQ whose keys section is the point would be a document with one row on six of the seven
tabs. **The note is therefore about features first and keys second**, and each tab's keys block
lists what is particular to that tab plus the two this spec adds. Growing the keyboard is real work
and is a separate document; this one does not pretend it has already happened.

**The fold gave `f` up.** The four Deck Builder keys were missing from this table when it was
written, and one of them was `f` — on the tab where pointing at a card and pressing a key most
obviously means the card. One key cannot both turn the card over and fold the frame away from under
it, and of the two the turn is the one that works on all five card tabs, so the fold moved to `c`
for the chrome it collapses. Its button says so: the label is the only place the key is written
down for somebody who has not opened the note. The three surviving letters also stopped answering
when a modifier is held, which they never should have — `Ctrl+C` is copy and `Ctrl+F` is find, and
the tab was taking both.

## What is being built

Arrive on the Deck Builder for the first time and a dialog opens over it: what the mat is, three
or four things you would otherwise have to discover, and a short list of keys. Dismiss it — the
close button, **Got it**, `Escape`, or a click outside — and it does not open again on any device
you sign in on.

Press `?` on any of the seven tabs that have one, or the `?` button on that tab's control strip,
and it comes back.

Press `f` with the pointer over a double-faced card, anywhere in the app, and the card turns over.

## Decisions, and what each one beat

**A blocking dialog, not a banner.** An inline panel at the top of the pane would be gentler and
was the recommendation; a dialog was chosen because a note nobody reads is worse than a note that
interrupts once. The cost is stated rather than hidden: **a new account meets a dialog before it
meets the app**, because `available` is the tab the app opens on. What holds the cost down is
that it is once per tab, forever, across devices — seven interruptions in a lifetime, four ways
to dismiss each — and that it never opens on a tab you have already dismissed it on, even on a
phone you have never signed in on before.

**Seven tabs, not eleven.** `deckview`, `collections`, `scryfall`, `sets`, `pick`, `lands`,
`available`. The four left out — `card`, `players`, `wants`, `admin` — are a card, a list of
people, a list of cards you want, and a table of users; a dialog explaining any of them would be
saying the heading again. The registry is per-tab, so adding one later is an entry rather than a
change.

**The registry decides everything, including the buttons.** Which tabs open a note, which tabs
grow a `?`, what the dialog draws, and which tab ids the server will store are all read from one
object. The alternative — a list in the JS and seven buttons hand-written into `index.html` —
is two lists that drift, and the failure is silent: a tab with a button and no entry, or an entry
nobody can reopen. The button is therefore **mounted by the feature**, not authored in markup.

**Seen-ness is a set of tab names on the account, not a flag per browser.** It goes in
`user_prefs` beside the theme and the playmat, because it is the same kind of fact and has the
same problem: a note dismissed on the desktop should not reappear on the laptop. `localStorage`
remains the whole record in open mode and after any failure, exactly as it already is for
appearance.

**No content version.** Editing a note's copy does not un-see it. A version stamp would let a
rewritten note re-announce itself, and it would also mean every typo fix reopening a dialog on
everyone's next visit. If a tab genuinely changes enough to be worth re-announcing, deleting its
id from the stored set is a one-line migration and the honest way to do it.

**`f` drives the existing control; it adds no turn.** `cardturn.js` already decides what has a
back, what happens with "Cards move" unticked, and what to do about a turn already running. The
key finds the button and calls `turnCard()` — so it inherits all three, and a card with one face
correctly does nothing because it has no button to find. A second path that knew how to turn a
card over would be a second place for those three decisions to be made differently.

**The card under the pointer, found by `:hover`.** Not by tracking pointer moves and not by
reading `cardlift.js`'s held card. `document.querySelector('.card-turnable:hover')` is live,
needs no state, and is already exactly the question being asked. It also means the key works in
every view that draws a turn control, present and future, with no list of views anywhere.

## The registry

`public/js/faq.js`, a classic script like every other file in `public/js/`:

```js
const FAQ = {
  deckview: {
    title:  'Deck Builder',
    blurb:  'Your deck as cards on a mat, seen from above.',
    points: [
      'Drag a card onto empty mat to start a new pile — the pile is the category.',
      'Point at a card in a spread pile and the cards lying on it move aside.',
      'Right-click a card for its menu: inspect, move, change printing, remove.',
      'The filter field reads the same query language as the Collections search.',
    ],
    keys: [
      ['f', 'turn the card under the pointer over'],
      ['c', 'fold the controls away, a tier at a time'],
      ['m', 'the menu beside the mat'],
      ['/', 'search for a card to add'],
    ],
  },
  // collections, scryfall, sets, pick, lands, available
};
```

`points` is the tab's own, and so is `keys`: it lists what is particular to *this* tab. `f` is on
the five tabs that draw cards and not on Mana Base or Available@, where there is no card to turn
over and a row promising one would be a lie.

`?` and `Escape` are on every note and are appended by the renderer rather than written into any
entry, so they are said once and cannot be described differently on two tabs.

## The data

`user_prefs` gains one column, added with the same idiom `card_motion` was:

```sql
ALTER TABLE user_prefs ADD COLUMN faq_seen TEXT NOT NULL DEFAULT '';
```

Comma-separated tab ids, `''` for someone who has seen none. It is declared in the `CREATE TABLE`
for a database made from now on and added by a `try { … } catch {}` migration for one made
before, where the default is the same empty set a new row starts at — so the migration cannot
change what anybody sees.

The client exposes it as an array on the `prefs` object in `state.js` (`faqSeen: []`), and
`routes/prefs.js` validates every id in a `PUT` against its own copy of the seven tab names, the
way it already mirrors and validates `THEMES`. Same reason: an id no tab matches would otherwise
follow the user onto every device, and there it would be a note that never opens rather than a
theme that never paints.

## Opening it, and the race that decides when

`setTab()` gains one line — `faqOnTab(tab)` — which is the only hook the feature has into the
app's own flow.

The seen set arrives from `/api/prefs`, and that is a fetch. `initAvailable()` runs on the first
paint, well before it lands. So the naive version shows you, on every reload, a note you
dismissed last week — it asks an empty set whether you have seen it and is told no.

`faqOnTab()` therefore records the tab as **pending** whenever prefs have not resolved, and
`syncPrefs()` flushes it once they have. One pending tab and not a queue: if you have switched
tabs twice while the fetch was in flight, the note that matters is the one for the tab you are
actually looking at.

Dismissing adds the tab to the local set *first* and calls `savePrefs()` after, so a failed write
costs you the note on your next device rather than a second dialog in this session.

## The dialog

One `#faqModal` in `index.html`, reused by all seven; the content is drawn on open. It follows
`#cardModal`, which is the app's existing dialog: overlay, backdrop, close button, `role="dialog"`,
`aria-modal="true"`, dismissed by the button, by `Escape`, or by a click outside the box.

It adds a **Got it** button, and focus lands on it when the dialog opens. This is deliberately the
opposite of `openDrawer()`'s rule — a drawer focuses its first field because "opening a drawer to
dismiss it is not the task", and here dismissing *is* the task.

Styled in `components.css` from the tokens: `--space-*`, `--text-*`, `--radius-*`, and a
`--shadow-*`. A dialog is a **floating** surface, so it takes a shadow and no border.

## The `?` button

`faq.js` walks `FAQ`'s keys on init and appends a button to each tab's `.toolbar` — the control
strip six of the seven already have. **Mana Base has no strip**, so it gets a minimal one; it is
the only markup change any of the seven panes needs.

Below 900px the button **grows** to 44×44 rather than padding its hit area out, because it stands
on its own in a strip — the first of the two cases in the touch-target rule in `components.css`,
and it is added to that list.

## The keys

Both are matched on the character the key produced (`e.key === '?'`, `e.key === 'f'`) rather than
on a physical key, so a layout where `?` is somewhere else than `Shift+/` still reaches it.

Both are ignored when the event's target is an `input`, `textarea`, `select`, or anything
`contenteditable` — otherwise typing `f` into the Deck Builder's filter field would turn a card
over, and typing `?` into a Scryfall query would open a dialog over it.

`?` toggles: pressed with the note open, it closes it. `f` does nothing while the note is open.

`f` is an accelerator for a button that is already on the screen and already reachable by
pointer and by tab order, so nothing becomes keyboard-only and nothing becomes pointer-only.

## Not in this

- **More keybinds.** The inventory at the top is the inventory afterwards, plus two.
- **A card selection model.** `f` acts on what the pointer is over. There is no "focused card"
  in this app and this spec does not invent one.
- **Notes for the other four tabs.** Adding one is an entry in `FAQ` and a line in the server's
  tab list.
- **An index of every note.** There is no "all help" screen; a note belongs to its tab.
- **Anything on the mobile nav.** The `?` button is on the tab's strip, which phones already
  scroll to.

## How it is tested

`test/faq.test.js`, new, added to the `npm test` list, in the house style — the decisions, read
off the delivered files, rather than the looks:

- every entry in `FAQ` has a title, a blurb and at least one point, so a tab cannot be half-added
- the `?` buttons are mounted from `FAQ`'s keys, so a button cannot exist for a tab with no note
- `?` and `Escape` are appended by the renderer rather than written into any entry
- no entry promises `f` on a tab that draws no turnable card
- both keybinds are refused while the target is a field
- `f` reaches `turnCard()` rather than touching `src` or the turn classes itself
- auto-open is gated on prefs having resolved, and a pending tab is a single value

In `test/server.test.js`, beside the existing theme validation:

- `PUT /api/prefs` rejects a `faqSeen` id that is not one of the seven
- open mode accepts the write, stores nothing, and reports `stored: false`

And `npm run lint:tokens` over the new CSS, which is what makes the token rules above a build
failure rather than a review comment.
