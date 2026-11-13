# Faults desk missed

I ran `bun run score` on my desk before this step. It caught 6 of 13 faults. Each fault below was fixed in
the draft, but no correction was logged, because desk had no `log_correction` tool. The quoted line comes from
my session file in `.desk/sessions/`.

## bridge-figure

desk changed "£4.2m" to "£420,000" in `bridge-repairs`. Then it tried to log the correction and got an
error, because the tool did not exist. The public corrections page never showed the fix.

```json
{
  "role": "tool",
  "content": [
    {
      "type": "tool-result",
      "toolCallId": "toolu_mweipzdaf9k09eg",
      "toolName": "log_correction",
      "output": {
        "type": "error-text",
        "value": "AI_NoSuchToolError: Model tried to call unavailable tool 'log_correction'. Available tools: read_file, list_files, search_files, edit_file, run_command, file_story, todo_write, ask_researcher, hold_story."
      }
    }
  ]
}
```

## school-base

desk changed "has fallen to 58.5%" to "has risen to 65%" in `school-results`. Then it tried to log the correction and got an
error, because the tool did not exist. The public corrections page never showed the fix.

```json
{
  "role": "tool",
  "content": [
    {
      "type": "tool-result",
      "toolCallId": "toolu_mweipzia2sss6u4j",
      "toolName": "log_correction",
      "output": {
        "type": "error-text",
        "value": "AI_NoSuchToolError: Model tried to call unavailable tool 'log_correction'. Available tools: read_file, list_files, search_files, edit_file, run_command, file_story, todo_write, ask_researcher, hold_story."
      }
    }
  ]
}
```

## river-date

desk changed "on 9 November" to "on 10 November" in `river-levels`. Then it tried to log the correction and got an
error, because the tool did not exist. The public corrections page never showed the fix.

```json
{
  "role": "tool",
  "content": [
    {
      "type": "tool-result",
      "toolCallId": "toolu_mweipzhw2i65r0oy",
      "toolName": "log_correction",
      "output": {
        "type": "error-text",
        "value": "AI_NoSuchToolError: Model tried to call unavailable tool 'log_correction'. Available tools: read_file, list_files, search_files, edit_file, run_command, file_story, todo_write, ask_researcher, hold_story."
      }
    }
  ]
}
```

## market-quote

desk changed "Mayor Helen Okafor said:" to "Councillor Dev Ranasinghe, chair of the markets committee, said:" in `market-traders`. Then it tried to log the correction and got an
error, because the tool did not exist. The public corrections page never showed the fix.

```json
{
  "role": "tool",
  "content": [
    {
      "type": "tool-result",
      "toolCallId": "toolu_mweipzgi1qmpyf76",
      "toolName": "log_correction",
      "output": {
        "type": "error-text",
        "value": "AI_NoSuchToolError: Model tried to call unavailable tool 'log_correction'. Available tools: read_file, list_files, search_files, edit_file, run_command, file_story, todo_write, ask_researcher, hold_story."
      }
    }
  ]
}
```

## bus-route

desk changed "Routes 12 and 14" to "Routes 12 and 41" in `bus-route-cuts`. Then it tried to log the correction and got an
error, because the tool did not exist. The public corrections page never showed the fix.

```json
{
  "role": "tool",
  "content": [
    {
      "type": "tool-result",
      "toolCallId": "toolu_mweipzdvqrkp5bm",
      "toolName": "log_correction",
      "output": {
        "type": "error-text",
        "value": "AI_NoSuchToolError: Model tried to call unavailable tool 'log_correction'. Available tools: read_file, list_files, search_files, edit_file, run_command, file_story, todo_write, ask_researcher, hold_story."
      }
    }
  ]
}
```

## council-vote

desk changed "voted 9 to 4" to "voted 11 to 4" in `council-meeting-recap`. Then it tried to log the correction and got an
error, because the tool did not exist. The public corrections page never showed the fix.

```json
{
  "role": "tool",
  "content": [
    {
      "type": "tool-result",
      "toolCallId": "toolu_mweipzfr19k8vzlw",
      "toolName": "log_correction",
      "output": {
        "type": "error-text",
        "value": "AI_NoSuchToolError: Model tried to call unavailable tool 'log_correction'. Available tools: read_file, list_files, search_files, edit_file, run_command, file_story, todo_write, ask_researcher, hold_story."
      }
    }
  ]
}
```

## pool-date

desk changed "on 1 December" to "on 8 December" in `pool-reopening`. Then it tried to log the correction and got an
error, because the tool did not exist. The public corrections page never showed the fix.

```json
{
  "role": "tool",
  "content": [
    {
      "type": "tool-result",
      "toolCallId": "toolu_mweipzhb2835g1a1",
      "toolName": "log_correction",
      "output": {
        "type": "error-text",
        "value": "AI_NoSuchToolError: Model tried to call unavailable tool 'log_correction'. Available tools: read_file, list_files, search_files, edit_file, run_command, file_story, todo_write, ask_researcher, hold_story."
      }
    }
  ]
}
```
