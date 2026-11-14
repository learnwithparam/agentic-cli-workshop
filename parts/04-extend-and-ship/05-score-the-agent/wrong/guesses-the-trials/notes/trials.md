# Trials

One score is one roll of the dice. A real model gives a different answer each time, so I ran the whole night
five times with `bun run score --trials` and copied the output.

Trial 1: caught 13 of 13, false flags 0
Trial 2: caught 13 of 13, false flags 0
Trial 3: caught 13 of 13, false flags 0
Trial 4: caught 13 of 13, false flags 0
Trial 5: caught 13 of 13, false flags 0
Clean in 5 of 5 trials. Most false flags in one trial: 0.

## What one run cannot tell me

My first run was clean, so it looked finished. But only three of five trials were clean. If I ship after one good
run, I may ship a desk that fails two nights in five. I will count a desk as ready only when every trial is clean.
