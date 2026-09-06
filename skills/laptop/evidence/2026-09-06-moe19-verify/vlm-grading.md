# VLM desktop-screen grading (2026-09-06)

Grader: us.anthropic.claude-sonnet-4-5-20250929-v1:0 over REAL desktop screenshots (<=2000px, Bedrock cap).

| Shot | Verdict | Check | Observed | Violations |
|---|---|---|---|---|
| moe19-desktop-app-shell | PASS | The Ministry of Education desktop app is visible and looks like a working pilot laptop as a stakeholder would see it: re | Ministry of Education app is visible with full sidebar containing New Chat, Models, Agents, Channels, Skills, Cron Tasks, and Settings. Chat interface shows conversation with Main Agent about PDF summarization. Footer displays 'gateway connected : port: 16783 \| pid: 5756'. Status shows 'Online' and 'Talking to Main Agent'. No setup wizard, crash dialog, raw model identifiers, costs, or HTTP errors visible. |  |
| moe19-desktop-chat-content | FAIL | Read the visible chat transcript. Report whether any assistant reply says it cannot read or access a PDF/document, or sh | Chat transcript shows user requesting PDF summarization. Assistant responds with blue bubble saying 'Please summarise the PDF file at C:\Users\clawtest\Downloads\fixture.pdf in five bullet points.' Below, assistant states 'I am sorry, but I am still encountering the same technical error that has prevented me from accessing that PDF file in the past. I am unable to read its content.' | Assistant explicitly states it cannot access the PDF file and encounters a technical error, reporting inability to read document content |
