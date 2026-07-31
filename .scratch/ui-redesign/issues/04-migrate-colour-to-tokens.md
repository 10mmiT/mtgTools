# 04 — Migrate: colour declarations onto tokens

**What to build:** Every colour decision in the app enters the theme system, so that a theme other than the default is no longer second-class.

Roughly 89 colour declarations currently sit outside the theme definitions. The most visible consequences: the eight per-player colours have **no theme variants at all**, so player chips show dark-theme colours on light backgrounds; and "you own this card" indicators are hardcoded.

Two documented exemptions survive, each carrying a comment saying so: text and controls layered over card artwork may use fixed white or black, since their backdrop is an image rather than a theme surface; and colour-mixing an existing token is permitted anywhere.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] No raw colour value remains outside the token file except documented, commented exemptions
- [ ] Player chips are legible and correct on all five themes
- [ ] Ownership and warning indicators use the new status tokens throughout
- [ ] Screenshots show no change beyond colours that were previously wrong on non-default themes
