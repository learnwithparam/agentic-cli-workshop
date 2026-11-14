# Trials

One score is one roll of the dice. A real model can give a different answer each time. The practice model slips
on some trials on purpose to show that. I ran the whole night five times with `bun run score --trials` and
copied the output.

Trial 1: caught 13 of 13, false flags 0
Trial 2: caught 13 of 13, false flags 1
Trial 3: caught 13 of 13, false flags 0
Trial 4: caught 12 of 13, false flags 2
Trial 5: caught 13 of 13, false flags 0
Clean in 3 of 5 trials. Most false flags in one trial: 2.

## What one run cannot tell me

My first run was clean, so it looked finished. But only three of five trials were clean. If I ship after one good
run, I may ship a desk that fails two nights in five. I will count a desk as ready only when every trial is clean.
