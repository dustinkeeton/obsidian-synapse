# START HERE

## This is a fresh repo. It is for the development of an Obsidian plugin that will will "flesh out" or elaborate on notes taken within a particular Obsidian vault or subdirectory of a vault.

### The main features should include:
- proposing additions to documents
    - minimize destructive actions the user might not want
    - focus on notes that are clearly placeholders for more thoughts
    - consider a system where proposals are stored in separate file
- transcribing audio
    - transcribe audio to text
    - option for transcription to be auto-iterated upon for efficient telling of whatever was transcribed
- transcriving video
    - same needs as transcribing audio
    - stretch goal of being able to discern video
    - auto fetches tikotk and youtube videos from urls to transcribe

### Your first steps should be to do the following:
1. Refer to https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin for documentation.
2. Create sub agents that specialize in meaningfully distinct specialities for this. Arm them with the above skills as appropriate
3. Spawn agents as a team in planning mode to discuss what is needed.
    1. Create skills useful for this task. Reference https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf
    2. Initialize codebase based off of findings.
4. Check in with me for next steps.

### Next Steps
Great work. We need to implement a few more roles. Please use the above process to create the necessary agents and roles for the following:

- architect. Tasked with maintaining and communicating with other agents best practices for this code repo, including but not limited to file structure.
- docs-agent. Should be optimized for llms and agents. not necessary that humans can parse easily
- docs-human. A derivative of docs-agent. Tracks things like decision making, workload, etc such that they can easily be communicated amongst humans.
- security. Focused solely on making sure nothing sensitive is committed and that code has appropriate safeguards. This might take careful planning and interation.

Once the above is complete, have the new agents audit the current code base and implement any intial revisions/improvements in consecutive order that I described them.