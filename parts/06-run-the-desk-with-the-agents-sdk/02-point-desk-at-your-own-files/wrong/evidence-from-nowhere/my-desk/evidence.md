# Evidence

## The run

I ran desk on my own notes folder. This line from the session file shows it reading my trip plan.

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "tool-call",
      "toolCallId": "call_01",
      "toolName": "read_file",
      "input": { "path": "notes/missing.md" }
    }
  ]
}
```

## What it found

desk read the trip plan and told me the budget lines add up to 1300 euros, but I had written 1200 in my head.
It also noticed that the lentil soup uses cups while the pancakes use grams. I will pick one unit.
