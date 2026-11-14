# Watch and read candidates

For the page pass. Cut each part to 4 to 6 picks, at least 2 videos, then delete this file.

I wrote these from memory, with no live link check. Before a pick goes on a page, check the link, the
author and the year, and run the nightly link check. Each line says who made it, when, and why it passes the
bar in STANDARD-v2.md section 5. Kind is read, video or paper.

## orientation

1. Read. Anthropic engineering team (Schluntz and Zhang), 2024, "Building effective agents". Made by the team that sells and runs agents. About the idea of a loop with tools, not a product.
2. Video. Barry Zhang, AI Engineer Summit, 2025, "How We Build Effective Agents". A short talk by an author of the post above. Same idea, in person.
3. Read. Anthropic documentation, "Tool use overview". Official docs from the model maker. Shows the request and result shape the desk uses.
4. Read. Anthropic engineering, 2025, "Building agents with the Claude Agent SDK". Written by the team that runs the loop in production.
5. Read. OpenAI, 2025, "A practical guide to building agents". A free guide from a model maker. A second view on the same loop.
6. Read. Lilian Weng, 2023, "LLM Powered Autonomous Agents". A research lead's survey at OpenAI. The idea has stayed true: plan, tools, memory.
7. Video. Anthropic, 2025, the Claude Code introduction talk by Boris Cherny. Made by the person who built the tool.
8. Read. Vercel AI SDK documentation, "Agents and loop control". Official docs for the library the course desk uses.

## run-the-loop

1. Read. Anthropic documentation, "Streaming messages". Official. Shows every event type a stream sends.
2. Read. Anthropic documentation, "Errors" and "Rate limits". Official. Says which statuses to retry.
3. Read. Marc Brooker, Amazon Builders' Library, 2019, "Timeouts, retries and backoff with jitter". Written by an engineer who runs retries in production at scale. Evergreen.
4. Video. Marc Brooker or another Amazon engineer on retries and backoff, AWS re:Invent. A conference talk by the people who run the service. Pick the talk at the page pass.
5. Read. Google, Site Reliability Engineering book, "Handling overload" and "Addressing cascading failures". Written by the team that runs Google. Explains why a retry storm hurts.
6. Read. Vercel AI SDK documentation, "streamText". Official docs for the call the step uses.
7. Read. Anthropic engineering, 2025, "Writing effective tools for agents". Made by the team that runs agents. Fits the read_file and list_files tools.
8. Video. Lance Martin, LangChain, 2025, a talk on agent loops and context. A practitioner who ships agents. Check that it covers the loop before use.
9. Read. Anthropic documentation, "Pricing" and "Token counting". Official. Backs the cost cap.

## touch-the-world-safely

1. Read. Anthropic documentation, Claude Code "Permissions" and "Settings". Official. Deny, ask and allow rules are the same idea as the gate.
2. Read. Anthropic engineering, 2025, "Claude Code best practices". Written by the team that runs the tool.
3. Read. Anthropic engineering, 2025, "Making Claude Code more secure and autonomous with sandboxing". The team's own account of why a fence beats a prompt.
4. Video. Boris Cherny, Anthropic, 2025, a talk on how Claude Code asks before it acts. Made by its builder.
5. Read. OWASP, 2025, "Top 10 for LLM applications", the excessive agency entry. A standards body, updated each year. Check the entry name.
6. Read. Simon Willison, 2025, "The lethal trifecta for AI agents". He named the idea. A short, clear rule for what to fence.
7. Paper. Anthropic, 2023 to 2025, work on tool use and agent safety. Pick one paper at the page pass.
8. Read. Anthropic documentation, "Bash tool" and "Text editor tool". Official. Shows the same edit and command tools.

## keep-the-context-clean

1. Read. Anthropic engineering, 2025, "Effective context engineering for AI agents". Made by the team that runs agents. It is about the idea of a small, clean context.
2. Read. Yichao "Peak" Ji, Manus, 2025, "Context engineering for AI agents: lessons from building Manus". Written by the team that runs the product. It covers the cache and why you do not edit old text.
3. Read. Anthropic documentation, "Prompt caching". Official. Says what the cache reads and what breaks it.
4. Paper. Liu and others, 2023, "Lost in the Middle". A university paper that started the idea that long context is read unevenly.
5. Read. Chroma, 2025, "Context rot". A research report with data on long inputs. Check the bar: it is from a company, but it shares the method and the data.
6. Video. Lance Martin, LangChain, 2025, "Context engineering for agents". A practitioner talk. Check the length and the content before use.
7. Read. Anthropic engineering, 2025, "How we built our multi-agent research system". Covers subagents that keep their own clean context.
8. Read. Anthropic, 2025, the announcement of context editing and the memory tool. Official. Shows trimming old tool results as a product feature.
9. Video. Dex Horthy, HumanLayer, AI Engineer, 2025, "12 factor agents". A talk by the author of the idea. The factor on owning your context window fits this part.

## extend-and-ship

1. Read. Model Context Protocol, the project documentation and the specification, "Introduction" and "Architecture". Official, by the people who made the protocol.
2. Read. Model Context Protocol, the specification, "Security best practices". Official. Covers tool trust.
3. Paper. Greshake and others, 2023, "Not what you've signed up for: compromising real-world LLM-integrated applications with indirect prompt injection". The paper that named the attack the wire step shows.
4. Read. Simon Willison, 2023 on, the prompt injection series. A long-running record by the person who named the problem.
5. Read. Invariant Labs, 2025, "MCP security notification: tool poisoning attacks". Research by a security team that found the attack. Check that it is not a sales page.
6. Read. Anthropic documentation, Claude Code "Hooks" and "Headless mode". Official. Matches the hooks and `-p` steps.
7. Read. Anthropic documentation, Claude Code "Checkpointing". Official. Rewind is the same idea as `--rewind`.
8. Paper. Yao and others, Sierra, 2024, "tau-bench". The paper that gave pass to the power of k, which fits repeated trials.
9. Read. Anthropic, 2024, "Adding error bars to evals" (Evan Miller). A short paper on why one run is not a result.
10. Video. Hamel Husain and Shreya Shankar, a talk or course lecture on evals. Practitioners who teach evals. Pick one at the page pass.

## score-the-desk-with-promptfoo

1. Read. promptfoo documentation, "Getting started" and "Assertions". Official docs from the tool's makers.
2. Read. Hamel Husain, 2024, "Your AI product needs evals". Written by a practitioner who has run evals in many teams.
3. Read. Anthropic documentation, "Define your success criteria" and "Create strong empirical evaluations". Official. Backs scoring from the outcome, not the words.
4. Read. Eugene Yan, 2024, "Task-specific LLM evals that do and don't work". A practitioner write-up from a company that runs them.
5. Read. UK AI Security Institute, Inspect AI documentation. Official docs. Backs the "when to pick Inspect instead" question.
6. Paper. Jimenez and others, 2023, "SWE-bench". The original paper for scoring an agent by what it changed.
7. Video. Ian Webster, promptfoo, a talk on running evals in CI. By the tool's maker. Check at the page pass.
8. Read. OpenAI documentation, "Evals". Official. A second view on the same idea.

## run-the-desk-with-the-agents-sdk

1. Read. OpenAI Agents SDK documentation, "Agents", "Tools" and "Human in the loop". Official docs from the makers.
2. Read. OpenAI, 2025, "A practical guide to building agents". Made by the model maker. Covers guardrails and approvals.
3. Read. Anthropic engineering, 2024, "Building effective agents". Says when a framework helps and when it hides the loop.
4. Video. Dex Horthy, HumanLayer, AI Engineer, 2025, "12 factor agents". The factors on tools and human contact fit the approval step.
5. Read. Vercel AI SDK documentation, "ToolLoopAgent". Official. The other choice named in the part.
6. Video. OpenAI developers, 2025, a talk or demo of the Agents SDK. Made by the makers. Check at the page pass.
7. Read. Anthropic documentation, "Claude Agent SDK overview". Official. A third design to compare.
8. Read. Simon Willison, 2025, notes on agent frameworks and tool use. A long-running, careful reviewer. Check the exact post.

## own-files capstone (the last step of the closing part)

1. Read. Anthropic engineering, 2025, "Claude Code best practices", the section on rules files. Official and written for a real project.
2. Read. Anthropic documentation, Claude Code "Memory" and the rules file guide. Official.
3. Read. Hamel Husain, 2024, "Your AI product needs evals", the section on looking at your own data. A practitioner. Backs the evidence step.
4. Video. Boris Cherny, Anthropic, 2025, a talk on using Claude Code on your own repo. Made by its builder.
5. Read. Anthropic documentation, Claude Code "Sandboxing". Official. Backs the permission file.
6. Read. Simon Willison, 2025, "The lethal trifecta for AI agents". Backs choosing what the desk may touch.
