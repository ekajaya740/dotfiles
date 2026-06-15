---
name: learn
description: Invoke the teacher agent to explain concepts, answer questions, and help you learn
---

Use the task tool with the following parameters — do not paraphrase or change the agent name:
- agent: "task"
- model: "teacher"
- tasks: [{ id: "main", description: "teach and explain concepts", assignment: "$@" }]
