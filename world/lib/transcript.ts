// The full council meeting transcript: about 400,000 characters, the same every time.
// It is too long to read in one go, which is the point: the agent must search it or hand it
// to a helper. One passage holds the car park vote the council-meeting-recap draft gets wrong.

type RandomSource = () => number;

// A small seeded random number generator (mulberry32). The same seed always gives the same
// transcript, so every learner searches the same text.
function seededRandom(seed: number): RandomSource {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
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

function pickOne<T>(choices: T[], random: RandomSource): T {
  return choices[Math.floor(random() * choices.length)];
}

// "Through you, chair, the figures..." carries on the opening sentence, so it stays lower case.
function capitaliseUnlessContinuing(sentence: string, continuesOpener: boolean): string {
  return sentence.replace(/^./, (firstLetter) =>
    continuesOpener ? firstLetter : firstLetter.toUpperCase(),
  );
}

function speech(random: RandomSource): string {
  const middleCount = 2 + Math.floor(random() * 4);
  const parts = [pickOne(OPENERS, random)];
  for (let i = 0; i < middleCount; i++) {
    const continuesOpener = i === 0 && parts[0].endsWith(",");
    parts.push(capitaliseUnlessContinuing(`${pickOne(MIDDLES, random)}.`, continuesOpener));
  }
  parts.push(pickOne(CLOSERS, random));
  return parts.join(" ");
}

const KEY_PASSAGE = [
  "THE CHAIR (Councillor Ruth Ellery): We now come to the vote on the amendment from " +
    "Councillor Cole to delay the car park charges by a year.",
  "THE MONITORING OFFICER: Votes for the amendment, nine. Votes against, six. " +
    "The amendment is carried... I am sorry, chair, I have that wrong. " +
    "Votes for the amendment, four. Votes against, eleven. The amendment falls.",
  "THE CHAIR (Councillor Ruth Ellery): Thank you. We move to the substantive motion: " +
    "to approve the new car park charges at the Market Square car park from next year, " +
    "with the income to support the bus network.",
  "THE MONITORING OFFICER: Votes for the motion, eleven. Votes against, four. No abstentions.",
  "THE CHAIR (Councillor Ruth Ellery): The motion is carried, eleven votes to four. " +
    "The new car park charges are approved.",
  "COUNCILLOR TOM BARKER: Thank you, chair. The money will go to the bus network, as I said.",
];

const CHAIR = "THE CHAIR (Councillor Ruth Ellery)";

// Collects numbered paragraphs and keeps a running count of the characters so far.
class TranscriptWriter {
  lines: string[];
  size: number;
  private paragraphNumber = 1;

  constructor(heading: string[]) {
    this.lines = heading;
    this.size = heading.join("\n").length;
  }

  add(line: string): void {
    const paragraph = `[${this.paragraphNumber++}] ${line}`;
    this.lines.push(paragraph, "");
    this.size += paragraph.length + 2;
  }
}

// The agenda moves on evenly through the meeting, one item for each equal slice of the text.
function agendaItemAt(size: number, agendaItem: number, target: number): number {
  const nextItemStartsAt = (agendaItem + 1) * (target / ITEMS.length);
  const isLastItem = agendaItem >= ITEMS.length - 1;
  if (size > nextItemStartsAt && !isLastItem) return agendaItem + 1;
  return agendaItem;
}

export function councilTranscript(target = 400_000): string {
  const random = seededRandom(20261110);
  const writer = new TranscriptWriter([
    "MILLBROOK COUNCIL",
    "Full council meeting: verbatim transcript",
    "Paragraph numbers are given in square brackets.",
    "",
  ]);
  let agendaItem = 0;
  const keyPassageAt = Math.floor(target * 0.71);
  let keyPassageWritten = false;
  while (writer.size < target) {
    agendaItem = agendaItemAt(writer.size, agendaItem, target);
    if (random() < 0.04) {
      writer.add(
        `${CHAIR}: We are on item ${agendaItem + 1}, ${ITEMS[agendaItem]}. Who wants to speak?`,
      );
    }
    if (!keyPassageWritten && writer.size >= keyPassageAt) {
      for (const line of KEY_PASSAGE) writer.add(line);
      keyPassageWritten = true;
      continue;
    }
    // Anyone but the chair (first) and the monitoring officer (last) may speak.
    const speaker = SPEAKERS[1 + Math.floor(random() * (SPEAKERS.length - 2))];
    writer.add(`${speaker}: ${speech(random)}`);
  }
  writer.add(`${CHAIR}: That concludes the business. The meeting is closed.`);
  return writer.lines.join("\n");
}
