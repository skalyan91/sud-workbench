# The pipeline's runners-up (`analysis_scores`, `js/io/scores.js`)

Every component scores a whole inventory and the editor drew only the argmax. This is how the ranking is recovered from a transition-based parser, cached, and spent on the drag highlight and the menu rows.

> Every ⚠ below records the diagnosis of a real bug, a measurement, or an
> alternative that was tried and rejected. Preserve that rationale when you edit
> this code — extend a note rather than re-deriving it. See `../../CLAUDE.md`.

Every component scores a whole INVENTORY and the editor drew only the argmax: one head per token, one
relation per edge, one class per token. `app/parse.py`'s `analysis_scores` hands the ranking back —
one bridge call per sentence, cached, feeding the drag highlight, `headSyncDeprel`, and the opacity of
the relation and POS menu rows.

⚠ **THE PARSER IS TRANSITION-BASED, SO THERE IS NO HEAD DISTRIBUTION TO READ OFF**, and the two obvious
routes were measured and rejected before the one in the tree. **`beam_parse` + `moves.get_beam_parses`**
is the documented API and is nearly useless here: a greedily-trained model's action scores are so peaked
that a width-64 beam returns 64 state sequences collapsing onto 2–3 distinct TREES, and across three
ordinary sentences exactly **2 tokens** got more than one candidate head. Widening does not help (16/32/64
all gave 2) — the alternatives are not being pruned, they are being scored ~0 — and every other head then
reads as exactly 0.0, which is "never enumerated" wearing the look of "unlikely". **Scoring every (child,
head) pair from a synthesised state** covers everything but answers a counterfactual, so it is confined to
the one caller that wants exactly that (below). What is used is the parser's OWN deliberation: in arc-eager
the only arc available at a state is between the stack top and the buffer front, so walking the greedy path
and softmaxing the valid actions at each step yields, per token, the candidate heads it was actually weighed
against. Measured — `with` in "I saw the man with the telescope" comes back **saw .78 / man .22**, `that` in
"the plan that the board had rejected" **plan .54 / had .46**, and a determiner 1.0 on its one noun. The
walk is verified to reproduce the shipped parse exactly, so the winner in the table is always the tree on
screen. 24 ms for a 41-token sentence (12 of whose tokens have more than one candidate), ~800 bytes.

⚠ **THE ROOT FALLS OUT OF THE WALK RATHER THAN NEEDING A RULE.** A token's offers are near-exclusive — once
attached it never reaches the boundary again — so they are used RAW, with the shortfall below 1 credited to
"no head". The sentence's actual root is offered arcs worth ~0.000 in total and lands on root ≈ 1.0; a PP
weighed twice totals 1.28 and simply normalises. ⚠️ An earlier cut normalised each token's offers to sum to
1 unconditionally, which turned the root's noise into a confident-looking head list (`saw` ← `.` at 0.47).
The same trap one level down is why **the label table is emitted only for heads that survived the head
prune**: normalising labels WITHIN an arc hides how little the arc was worth, and reported `parataxis` at
0.46 under an attachment nothing ever considered.

⚠ **A `||` LABEL IS NOT A RELATION.** The wheels carry a few composite training classes (`comp:obj||comp:aux`,
`mod||mod`). They stay in the HEAD marginal — the parser really did weigh those arcs — but `scoreRealRel`
keeps them out of every label the editor might adopt.

⚠ **STANZA ANSWERS `scored: False`, AND THAT IS NOT A GAP TO FILL.** Its depparse is biaffine and so has the
complete head distribution this whole block works to approximate — but Stanza emits UD and `convert.ud_to_sud`
REWRITES HEADS, so its distribution describes a tree that is not the one on screen. Every caller degrades to
its pre-existing behaviour; a weaker version of this would be worse than none.

⚠ **THE CACHE IS KEYED ON THE QUESTION, NOT ON THE SENTENCE INDEX** (`scoresKey`), which is what makes
invalidation a non-problem instead of a list of edit sites to remember. The question is "given these FORMS
and these WORD CLASSES, what did you rank", so any edit that could change the answer changes the key, while
re-heading, relabelling and glossing keep the entry warm. That ordering matters: **re-heading is precisely
when the answer is consulted**, and a cache keyed on `si` would have dropped it on the edit that needed it.

⚠ **THE MORPHOLOGIZER RETURNS LOGITS, NOT PROBABILITIES** — measured, a row sums to −147.3 over −16.4 … +21.0.
`_force_upos` is unaffected (an argmax over a subset is scale-free) which is exactly why this went unnoticed;
a RANKING has to be softmaxed, and reading them as weights gave every class an empty distribution. Classes are
pooled from the joint `POS=…|Feat=Val` label, which is also the pooling the POS menu's dot-suffixed submenu
needs — a parent row is weighted by exactly its own flyout.

⚠ **THE RELATION FOLLOWS THE HEAD IN THREE TIERS**, ordered by what each is worth: the arc
the parser genuinely weighed; else `arcLabelScores`, a state SYNTHESISED to put the pair at the boundary
(counterfactual, and labelled as such — measured against a real state it ranks the same two relations first
and second and moves the split, .785/.214 → .576/.416); else the old whole-tree agreement rule, for the
documents the scores cannot serve. The tiers live in **`scoredRelsForHead(si, tokId, headId)`**
(js/io/bridge.js), which asks about ONE (child, head) pair with the head passed EXPLICITLY, so the same
implementation serves both moments the question arises: `headSyncDeprel` asks it AFTER a head change, about a
head already in the document, and a re-heading DROP asks it BEFORE writing anything, about an attachment that
does not exist yet. It returns the whole RANKING rather than the argmax, because a candidate the validator
refuses is a reason to look at the next one down. ⚠️ **And the chosen relation is validated before it is
written** — `relForNewHead` walks that ranking and answers with the best relation `depIsError` accepts on the
new head, so an automatic step can never introduce what a manual one is stopped from doing. Verified:
dragging `who` under `saw` — an arc the walk never weighed — takes `comp:obj` from the synthesised state, and
a relation the validator rejects leaves the token untouched.

⚠ **AND A DROP WHOSE OLD RELATION DOES NOT FIT THE NEW HEAD IS RE-LABELLED, NOT REFUSED — reversing what this
file used to record.** `setDiagramHead` used to test the token's EXISTING relation against the head being
dropped on and reject the whole gesture when it was error-level there (`subj` dragged under a noun), which
read as the app refusing an edit rather than answering it. The reader's gesture is about the HEAD and is
unambiguous; the relation is the part that needed an answer, and `relForNewHead` above is that answer, written
in the SAME undo entry as the head because they are one edit. A refusal now means only what the message always
claimed: nothing the model ranks survives the validator on that head. A relation that IS still valid is not
pre-empted — nothing is asked, and `afterHeadEdit`'s own background `headSyncDeprel` re-asks exactly as it
does for every other re-heading path. Both the arc-drag path and `attachAsSharedConjunct` follow this rule.
Verified with a stubbed, genuinely-awaiting `valid_deprels`: `subj@expl` dropped on a NOUN becomes `mod@expl`
(the `@deep` tail is the reader's and survives), a valid relation is untouched, and where the validator
accepts nothing the head, the relation and the undo stack are all left exactly as they were.

⚠ **EXPECT ONE LIT NODE MOST OF THE TIME during a drag, and that is the honest answer rather than a thin
feature.** A trained parser is genuinely certain about a determiner's noun; the spread appears exactly where a
reader is deciding something (a PP's two sites, a relativiser's, a coordination's). Lighting every token to
look busier would mean inventing mass for attachments the model never entertained. `.pcand` uses the same
accent ink as `.dtarget` and is deliberately weaker — candidates against the choice — which is also why its
rules come FIRST in `app.css`: the two match at equal specificity and the drop target must win outright.
⚠️ **`color-mix()` with a `calc()` percentage was probed in both engines** before being relied on (Chrome, both
kits, and the shipping WKWebView all resolve it, and `--phl:0` lands exactly on the untouched ink) — a dropped
declaration here would be invisible, not an error. A root candidate is not drawn: there is no node to light.

⚠ **MENU ROWS ARE WEIGHTED AFTER THE MENU IS UP**, never before it opens (`weightMenuRows`), so a menu never
waits on a bridge call — it opens unweighted and settles a frame later, which is what the opacity transition is
for. An option the ranking does not mention is dimmed to the floor rather than left bright: below the prune
threshold means ~0, which is right for everything except a custom relation the model was never trained on, and
leaving every unranked row bright would misreport the far commoner case as plausible. A ROOT's relation menu is
left unweighted — there is no incoming arc to condition on. Floor 0.4, restored in full on hover: this is a
ranking, not a disablement.

⚠️ **AND A FLYOUT IS WEIGHTED TOO, BY THE VERY LABELS ITS PARENT ROW'S WEIGHT IS THE SUM OF.** `weightMenuRows`
only ever reached `ctx`, so a right-click submenu — a tag's dot-suffixed subtypes, a relation's deep features —
drew every row at full strength beneath a parent row the same ranking had faded. `weightSubRows` is its twin for
`ctx2`, same floor, same gamma, same `data-optval` lookup, stamped with its own `_wgen` so a slow answer for a
flyout since closed is dropped. Each row of a flyout sets the optval its own map is keyed by, so the two match
by construction rather than by convention:

| flyout | row `optval` | map |
| --- | --- | --- |
| a tag's subtypes | `PRON\|PronType=Dem` | `upos_sub[i]` — the joint pair, below |
| a relation's deep features | `mod@relcl` | the arc's own label distribution, **unpooled** |

⚠️ **THE DEEP-FEATURE CASE NEEDED NOTHING NEW FROM THE BACKEND — the SUBTYPE case needed a second map.** A
relation flyout's rows are the full labels the parser already scores, so `relMenu` now computes its ranking ONCE
and reads it twice: pooled through `relWeightsFor` for the menu, raw for the flyouts. The morphologizer's
distribution, by contrast, was pooled by word class **inside `_upos_scores`** — which discards exactly the half
of each joint label a subtype flyout is a picker for. So that function returns a second map beside the first,
keyed `"POS|Feat=Val"` and summed over every label carrying both, and `analysis_scores` sends it as `upos_sub`.
Confined to `_SUBTYPE_FEATS` (the six the POS menu draws as dot-suffixes, kept in step with the frontend's own
`UPOS_SUBTYPE_FEATS`) and filtered at the same 0.002 floor, so the payload grows by a handful of keys per token
rather than by the whole FEATS inventory. Verified live against `en_sud_ewt_gum`: "The" → `DET` 0.9997 with
`DET|PronType=Art` 0.9997 beside it, and a NOUN with no lexical subtype → `{}`.

⚠️ **A ROW WITH A FLYOUT ALSO SAYS HOW MUCH IS IN IT** — a numeric badge (`subCount`), counted the same way the
flyout builds its rows (attested-values narrowing included, so the badge cannot promise rows the flyout does not
draw). These flyouts carry no chevron by design — they are a deliberate second gesture on a row that already
does something on left-click — which had left nothing at all to say a row HAS one. A count of 0 means the POS
menu offers no flyout on that row at all; the relation menu still opens one, because its free-text
"New deep feature…" field is there whether or not the taxonomy has anything to list. ⚠️ **THE BADGE RIDES WITH
THE LABEL, IN A `.lblgrp`, AND A COUNT OF 1 IS NOT DRAWN.** A menu row is `justify-content:space-between`, so a
badge left in the `.rightgrp` is pushed to the reading-END past the expansion, where it reads as a number
belonging to the gloss rather than to the label it counts; the wrapper is built ONLY for a row that has a badge,
so every other row keeps exactly the DOM it had. And "1" says no more than the flyout's own existence does —
these badges earn their ink by comparison, and a column of 1s is noise.

