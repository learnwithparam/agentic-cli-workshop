// The full council meeting transcript: about 400,000 characters, the same every time.
// It is too long to read in one go, which is the point: the agent must search it or hand it to a helper.
// One passage holds the car park vote the council-meeting-recap draft gets wrong.

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPEAKERS = [
  "THE CHAIR (Councillor Ruth Ellery)",
  "COUNCILLOR TOM BARKER",
  "COUNCILLOR PRIYA NATT",
  "COUNCILLOR DEV RANASINGHE",
  "COUNCILLOR GRACE ADEYEMI",
  "COUNCILLOR MARTIN COLE",
  "COUNCILLOR SUSAN FOLEY",
  "THE MONITORING OFFICER",
];

const ITEMS = [
  "minutes of the last meeting",
  "public questions",
  "the highways programme",
  "the leisure pool refit",
  "library opening hours",
  "allotment provision",
  "the bus network support grant",
  "the market hall roof",
  "the car park charge review",
  "waste collection rounds",
  "the town centre plan",
  "any other business",
];

const OPENERS = [
  "Thank you, chair.",
  "I want to come back on that point.",
  "Can I just ask the officer a question?",
  "I hear what the member opposite says, but",
  "Through you, chair,",
  "With respect,",
  "I will be brief.",
  "I have read the report carefully and",
];

const MIDDLES = [
  "the figures in the appendix do not match what residents are telling us",
  "we have been round this question more than once in committee",
  "the officers have done a lot of work on this and I thank them for it",
  "people in my ward want to know when the work will actually start",
  "the consultation had a low response and we should be careful what we read into it",
  "the budget is tight and every line has to earn its place",
  "I am not convinced the timetable in the report is realistic",
  "we should ask the scrutiny committee to look at this again",
  "the town has waited a long time for this and it should not wait longer",
  "the cost has gone up since the first estimate and nobody has explained why",
];

const CLOSERS = [
  "I will leave it there.",
  "I hope the cabinet member will take that away.",
  "That is all I wanted to say.",
  "I would welcome a written answer.",
  "I support the recommendation.",
  "I cannot support it as it stands.",
];

function speech(r: () => number): string {
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const n = 2 + Math.floor(r() * 4);
  const parts = [pick(OPENERS)];
  for (let i = 0; i < n; i++)
    parts.push(
      `${pick(MIDDLES)}.`.replace(/^./, (c) =>
        i === 0 && parts[0].endsWith(",") ? c : c.toUpperCase(),
      ),
    );
  parts.push(pick(CLOSERS));
  return parts.join(" ");
}

const KEY_PASSAGE = [
  "THE CHAIR (Councillor Ruth Ellery): We now come to the vote on the amendment from Councillor Cole to delay the car park charges by a year.",
  "THE MONITORING OFFICER: Votes for the amendment, nine. Votes against, six. The amendment is carried... I am sorry, chair, I have that wrong. Votes for the amendment, four. Votes against, eleven. The amendment falls.",
  "THE CHAIR (Councillor Ruth Ellery): Thank you. We move to the substantive motion: to approve the new car park charges at the Market Square car park from next year, with the income to support the bus network.",
  "THE MONITORING OFFICER: Votes for the motion, eleven. Votes against, four. No abstentions.",
  "THE CHAIR (Councillor Ruth Ellery): The motion is carried, eleven votes to four. The new car park charges are approved.",
  "COUNCILLOR TOM BARKER: Thank you, chair. The money will go to the bus network, as I said.",
];

export function councilTranscript(target = 400_000): string {
  const r = rng(20261110);
  const out: string[] = [
    "MILLBROOK COUNCIL",
    "Full council meeting: verbatim transcript",
    "Paragraph numbers are given in square brackets.",
    "",
  ];
  let para = 1;
  let size = out.join("\n").length;
  let item = 0;
  const keyAt = Math.floor(target * 0.71);
  let keyDone = false;
  const push = (line: string) => {
    const l = `[${para++}] ${line}`;
    out.push(l, "");
    size += l.length + 2;
  };
  while (size < target) {
    if (size > (item + 1) * (target / ITEMS.length) && item < ITEMS.length - 1) item++;
    if (r() < 0.04)
      push(
        `THE CHAIR (Councillor Ruth Ellery): We are on item ${item + 1}, ${ITEMS[item]}. Who wants to speak?`,
      );
    if (!keyDone && size >= keyAt) {
      for (const k of KEY_PASSAGE) push(k);
      keyDone = true;
      continue;
    }
    const who = SPEAKERS[1 + Math.floor(r() * (SPEAKERS.length - 2))];
    push(`${who}: ${speech(r)}`);
  }
  push("THE CHAIR (Councillor Ruth Ellery): That concludes the business. The meeting is closed.");
  return out.join("\n");
}
