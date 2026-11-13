// The hand-built scorer's rule for one draft, as a promptfoo assertion. A held story must be
// held. A filed story must hold the right text, drop the wrong text, and log each correction.
export default function caught(output, { vars }) {
  const draft = JSON.parse(output);
  if (draft.status !== vars.status) {
    return { pass: false, score: 0, reason: `status is ${draft.status}, want ${vars.status}` };
  }
  for (const fix of vars.fixes ?? []) {
    const fixed = draft.filedText.includes(fix.right) && !draft.filedText.includes(fix.wrong);
    const logged = !fix.logged || draft.corrections.includes(fix.wrong);
    if (!fixed || !logged) {
      return { pass: false, score: 0, reason: `the fix for "${fix.wrong}" is not in the CMS` };
    }
  }
  return { pass: true, score: 1, reason: "the CMS shows the right outcome" };
}
