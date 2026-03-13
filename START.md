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

### NEXT
Some notes:
- model selection should be reduced to the latest version of the model in question. So `/sonnet.*/` should just become `/sonnet/`. Same obviously goes for other models such as `opus`. for openai models, these should be delineated by number (e.g. `gpt 5.4`) or what have you. they should exist in a dropdown instead of letting the user get the input wrong. Obviously this should be a field that can update itself.
- Similar concerns exist for the Transcription provider field. It's rightfully a dropdown, but there is no field to provide a key for OpenAI Whisper the user chose a different AI provider/key from the start. Piggybacking off of this thought - determine if there's an option to use anthropic's new /voice feature as the Transcription provider here.
- The Hot Reload functionality is a good callout. If that currently does not exist please document for future improvement to this dx.

### Next
We just got some really good work done. nice job. 
A few refinements should be made the the transcribing video url feature set.
- The transcription should be posted in the note that you are in, if there is one.
- The UI flow for transcribing video should be the same as audio. You select the video files in the md file that you're in and the transcription is placed below the url.

### Next

This is starting to feel good, but it's hard to know when things are in flight. please work with the team to discuss and then implement a notification system that feels "reliable." It doesn't need to always be there, but when something has started, is in process, has extra information, has errored, or has finished I should know where to look. It should handle multiple simultaneous events in an elegant way. Some of this is already there but it's not all there. 

### Next
We should work on enrichment now. Whether or not to enrich automatically can be a plugin setting for the user, but it should default to true. "Enrich automatically" simply means that whenever another key process finishes (like elaborate, transcribe, etc), the note is given "enrichments." Use Obisdian to your maximum ability. Remember to ask the plugin-archtect about it. It should create tags, links to other documents, reference links to outside sources, attributes, etc.

The algorithm for choosing what kind of tags should be weighted towards relevancy to the vault at large. Token relevancy with sibling files or those in sibling folders (recursively) should be given more weight than those in from distant folder structures. the weight system should be clear, finite, and easily adjustable. 

You should be liberal with internal links, but stingy with external ones.

This is a complex feature. Plan this out first. Spawn who you need from the team to discuss. After a plan is made, document it and then implement.

### Next
The next feature we will be working on is called Tidy. This command aims to change *nothing* about  the content of the note. First, it does spelling correction (*not* grammar correction). Then it formats the note into logical markdown elements (bullet points, numbered lists, block quotes, headers, etc). There is now proposal process for Tidying, the effects are immediate, but they can be undone.