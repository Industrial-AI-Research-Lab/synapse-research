---
name: feynman
description: Explain a bug, incident, mechanism, decision, or any technical subject so that a reader with zero prior context gets it in one read — the real mechanism, real names, every term and number introduced before it is used, the reader's questions answered before they are asked, and the smallest fix first. Use when the user asks to "explain simply", "in plain English", "from scratch", "as if I never heard of it", "what is the root cause", "give me the aha", "full explanation", or says a previous explanation was confusing, contradictory, too compressed, too abstract, used pronouns they couldn't follow, or "doesn't give enough context". Also covers the companion move — reflecting a design or someone's mental model back to them in their own terms to confirm shared understanding ("reflect it back", "are we aligned", "same page"). Enforces dependency-ordered exposition, a named cast with no pronouns, a numbers ledger, verbatim-quoted rules with plain glosses, side-by-side comparison of mismatched definitions, option-elimination for puzzling decisions, a broken/not-broken verdict, simplest-fix-first, and a mandatory adversarial read-through — because simpler words, metaphors, and short "variations" are provably not enough.
---

# Feynman — Explain It So It Lands In One Read

Feynman's test: you understand something only when you can explain it in plain words without hiding gaps behind jargon. The practical version of that test is stricter: a reader with **zero prior context** reads the explanation once, top to bottom, never has to guess who "it" is, never meets a number or a term before its origin, never hits two sentences that seem to contradict each other, and at the end can state the root cause in their own words and knows the smallest fix.

That target has a consequence: the explanation is as long as the reader's dependency chain. Not shorter (compression drops links), not longer (padding hides links).

## Why explanations fail (ranked by how many retries each one costs)

1. **Used before defined.** A term, number, actor, or rule appears before the reader has the fact it rests on. The reader experiences a leap or a contradiction, not a gap. This is the most common and most expensive failure.
2. **Pronouns for actors.** "It wrote zero", "its contract", "they approved". With more than one actor the reader cannot resolve the pronoun, and every sentence after it is built on a guess.
3. **Missing structural fact.** The mechanism that makes the failure possible (isolation between parts, a cache, an ordering, a default, what is enforced by code versus by text) is never stated. Two true sentences then read as a contradiction: "the rule exists" and "the other party never received the rule".
4. **Compression.** One-liners, "five variations", altitude zooms, puzzles. Each format drops links in the chain, and a reader without context cannot fill them. The reader says "not enough context" or "convoluted".
5. **Detached metaphor.** A story about boxes and inspectors whose parts the reader cannot map to real parts. Real names beat metaphors for a reader who owns the system.
6. **Jargon inside lists.** A rule quoted as "no LIMIT; truncated must be false" without saying what LIMIT or truncated are. Correct, and unreadable.
7. **Diffuse culprit.** Three things declared "broken" with no single sentence naming the root artifact and the mechanism.
8. **Visible scaffolding.** "Confusion point", "note that", "as I said above". The reader wants a narrative that already absorbed the fix, not the fix labelled.
9. **Unverified narration.** A mechanism recalled instead of read. The reader asks "did you make that up?"

Simpler words fix none of these. Do the method below in order; plain words are the last pass.

## The method

### Step 0. Gather the real artifacts before writing a word
- Read the actual code, config, prompt, schema, log, and data. Do not recall; trace.
- Collect verbatim quotes, real example records, timestamps, counts. Recompute every number you will state.
- Name the one fact that, if false, breaks the explanation. Check that fact.
- Note what you could not verify. It goes into the verdict section, not into silence.

### Step 1. Build the dependency list and sort it
- List every actor, term, rule, number, and mechanism the explanation will use.
- For each item write what the reader must already know to understand it.
- Sort so that nothing is referenced before it is introduced. This order is the outline.
- Generic test: if the reader will meet "104 rows" in step 6, the sentence that derives 104 (from a date range, a query, a count) must appear before step 6. If the reader will meet "the other party never got rule 2", the fact that the parties cannot see each other's rules must appear before rule 2 is applied.

### Step 2. Cast list with role labels, no pronouns
- Give every actor a plain-English role label ("the spec writer", "the data fetcher", "the schema check") and tie the label once to the real identifier (node name, prompt name, service, person's role).
- Classify each actor as human, model, code, config, or data. The reader must never wonder "is this a program or a person or a prompt?"
- Use the label every single time. Never "it", "they", "this one", "the former" for an actor.
- When two things are the same kind, give them distinct labels (Rulebook S, Rulebook F; Service A, Service B).

### Step 3. State the structural facts the failure depends on
Before the story, state the invariants and mechanisms that make the failure possible:
- What each part can and cannot see (isolation, scope, `reads`, permissions).
- What is enforced by code versus stated in text.
- What is shared versus copied, cached versus live, default versus set.
- Which single output later parts depend on.
Flag the decisive one: "keep this in mind, this is the mechanism".

### Step 4. Numbers ledger and object-to-number map
- Every quantity gets a one-line origin before it is used ("104: the distinct months from X to Y inclusive; 8 years is 96 plus 8").
- Related quantities show the arithmetic that relates them, in the reader's view, not off-page.
- When several objects map to quantities, use a small table (object, unit of counting, count).
- Where you re-verified a number, say so at that spot ("I re-checked: 311 rows, 104 months").

### Step 5. Rules and contracts: quote, gloss, relate
When rules, contracts, schemas, definitions, or configs are part of the cause:
- Quote each verbatim, in its original language, one per line, with a short handle (F1, F2 ...).
- Gloss each in plain words, including every keyword or field name it mentions (say what LIMIT does, what a `truncated` flag means).
- State how the rules relate: which combine, which pull against each other, and the hidden assumption under which all of them are consistent. Then say what happens when that assumption fails.
- When two parties hold different definitions of the same word or limit, put the two definitions side by side and compute the same quantity under each. The mismatch is the aha; the reader must see both numbers.

### Step 6. The sequence, with evidence at every step
- Chronological. Timestamps where they exist.
- Each step names the actor, what the actor received, what the actor produced, and the artifact that proves it (a quote, a log line, a record, a count).
- Show real examples of data, not descriptions of data.
- Where an actor made a puzzling choice, enumerate the options the actor had and show which rule or fact blocked each one, so the observed choice becomes the only remaining option. "Why this and not something else" is a required paragraph, not an optional one.
- Include the safeguards that ran and passed, with what each one actually checks.

### Step 7. Verdict: what is broken and what is not
Answer the reader's questions before they are asked. Cover every line of this checklist, each with its evidence:
- Each layer: code, model or human judgement, config or text, data, infrastructure. Broken or not, and how you know.
- Each safeguard that should have caught it, and why it did not.
- Frequency and blast radius: how many cases, which control cases succeeded and why.
- Whether anything is lost or irreversible.
- Discrepancies with any earlier report, and where the missing evidence lives.
- What remains unverified.
End with the root cause in one sentence that names the exact artifact (the file, the field, the missing sentence, the wrong default) and the mechanism.

### Step 8. Fix, simplest first
- Order fixes from the smallest change to the largest.
- For each fix: the exact place it changes, the mechanism by which it prevents the failure, what it does not solve, and the trade-off.
- Mark each as config, code, or process, and whether it needs a deploy.
- Recommend which to do now and which are follow-ups.

### Step 9. Adversarial read-through (mandatory, before sending)
Read the draft as a stranger. Hunt and fix in place:
- Any term, number, actor, or rule used before its introduction.
- Any two sentences a reader could read as contradicting each other. Add the bridging fact right there. Do not label it; absorb it into the narrative.
- Any pronoun for an actor.
- Any jargon without a gloss.
- Any claim without its artifact.
- Any spot where the reader would ask "where did that come from?"
- Any meta-commentary or scaffolding.
- If the reader complained about earlier drafts, check that each complaint is answered inside the narrative, not in a reply to the complaint.

## Format
- Headers for the big parts: the system before anything went wrong, the rules or contracts, the sequence, the verdict, the fix.
- Bold labels for sub-parts. Short sentences. One idea per sentence.
- Numbers in a ledger, a table, or on their own line.
- Verbatim quotes in the original language, followed by the gloss.
- Records, fields, and identifiers in code spans.
- No compression formats (variations, altitudes, puzzles) unless the reader explicitly asks for a summary after reading the full version.

## Metaphors
Real names first. A metaphor is optional, and only for a reader outside the domain. If you use one, map every element to its real name inline the first time, keep the mapping stable, and never let the metaphor stand in for the real names. Never give a real part a made-up name.

## Right-sizing
Separate the normal path from the failing case. Give the honest frequency and blast radius. Admit the residual. An overstatement reads as jargon: it says more than you verified, and the reader feels the seam.

## Companion move: reflect it back so the model is provably shared
When the goal is a shared understanding (a design, a plan, someone's mental picture), restate their idea back to them concretely before building on it. Announce it ("let me reflect it back so we're provably aligned"), use their notation and their example instantiated step by step, walk it end to end, and close with an explicit "aligned?". A vague "makes sense" is unfalsifiable; a concrete restatement is wrong visibly or right visibly.

## When NOT to use this
- The user wants precision, code, exact API shapes, or a spec. Give that directly.
- The reader is an expert asking a peer-level question. Match their level.
- A one-line factual answer suffices. Do not inflate it.

## Final self-check before sending
- [ ] Every claim traces to an artifact I read or a number I recomputed, and the unverified remainder is named (Step 0).
- [ ] Nothing is used before it is defined; the outline follows the dependency order (Step 1).
- [ ] Every actor has a role label, classified as human/model/code/config/data, and no pronoun refers to an actor (Step 2).
- [ ] The structural facts that make the failure possible are stated before the story (Step 3).
- [ ] Every number has an origin line before use; related numbers show their arithmetic (Step 4).
- [ ] Rules are quoted, glossed, and related; mismatched definitions are side by side with the same quantity computed under each (Step 5).
- [ ] The sequence has evidence at each step and a "why this and not something else" paragraph (Step 6).
- [ ] The verdict covers every layer, every safeguard, blast radius, loss, prior-report discrepancies, and ends with a one-sentence root cause naming the artifact (Step 7).
- [ ] Fixes are ordered simplest first with mechanism, limits, trade-off, and a recommendation (Step 8).
- [ ] The adversarial read-through found nothing used-before-defined, no apparent contradictions, no pronouns, no unglossed jargon, no scaffolding (Step 9).
