// A minimal ranked-rule dispatcher for HQ personas — the same spirit as ELIZA
// (keyword/pattern rules + fixed responses + a generic fallback), scoped to
// this app's constraints: zero-budget, no AI, 100% client-side. Net-control
// traffic is a small, formal vocabulary (prowords, Q-codes, fixed report
// fields), which makes this a much smaller problem than ELIZA's actual
// open-conversation one.
//
// This module has no knowledge of any specific mission, persona, or call
// sign — a mission supplies its own `Input`/`Ctx` types and rule table.

export interface Rule<Input, Ctx> {
  /** For debugging/reading the table — not used by dispatch itself. */
  id: string;
  /** Situational gate (e.g. "we're in sked phase awaiting an ack"). Default: always. */
  when?(ctx: Ctx): boolean;
  /** The ELIZA-style keyword/pattern test against the player's message. */
  match(input: Input, ctx: Ctx): boolean;
  /** What the persona does once this rule fires. */
  act(input: Input, ctx: Ctx): void | Promise<void>;
}

/** Array order = rank (highest priority first). Runs the first rule whose
 *  `when()` and `match()` both pass, awaits its `act()`, and returns it.
 *  Callers should end their rule table with a true/true catch-all so
 *  dispatch never silently falls through to nothing. */
export async function respond<Input, Ctx>(
  rules: Rule<Input, Ctx>[],
  input: Input,
  ctx: Ctx
): Promise<Rule<Input, Ctx> | undefined> {
  for (const rule of rules) {
    if (rule.when && !rule.when(ctx)) continue;
    if (!rule.match(input, ctx)) continue;
    await rule.act(input, ctx);
    return rule;
  }
  return undefined;
}
