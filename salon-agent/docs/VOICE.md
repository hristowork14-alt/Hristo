# Phase 4 — Voice (phone) proposal

**Status: proposal only. Nothing is built until you approve.**

Goal: a customer calls the salon, hears a natural Bulgarian voice, and can ask about prices and book, move or cancel an appointment. The call uses the **same booking backend** (same tools, same rules, same double-booking protection) and shows up in the owner dashboard.

## What matters for a Bulgarian salon

1. **Bulgarian speech recognition on phone audio** — names, phone numbers, "в четвъртък в пет и половина".
2. **A natural Bulgarian voice** — a robotic accent is what makes callers hang up.
3. **Fast turn-taking** (under about a second) and handling interruptions.
4. **Calling our own tools** over HTTPS, so bookings land in our database.
5. **A phone number** callers can reach (or forwarding from the salon's existing number).

## The three options

| | ElevenLabs Agents | Retell AI | Vapi |
| --- | --- | --- | --- |
| Bulgarian speech recognition | Own model (Scribe) lists Bulgarian | Official docs list `bg-BG`, with the provider per language | No Bulgarian found in its transcriber docs; forum threads report the `bg` setting not sticking, and Deepgram Bulgarian missing from the dashboard |
| Bulgarian voice | Its core product; Multilingual v2 / v3 voices include Bulgarian | Through partner voice providers (incl. ElevenLabs) | Through partner voice providers |
| One vendor for hearing + speaking | Yes (fewer mismatches) | No | No |
| Calls our tools | Webhook / server tools; custom LLM option | Custom functions; custom LLM over WebSocket | Tools via server URL; custom LLM |
| Phone numbers | Native Twilio integration, SIP | Built-in numbers, Twilio, SIP | Built-in numbers, Twilio, SIP |
| Main risk | Agents product is newer than its voices | Quality depends on which providers you pick | Bulgarian recognition reported as unreliable |

## Recommendation: ElevenLabs Agents (Retell AI as backup)

- Voice quality is what callers notice first, and that is ElevenLabs' strongest area. Its own recognition model also lists Bulgarian, so hearing and speaking come from one vendor.
- **Retell** is a solid backup: it officially lists Bulgarian, and its "custom LLM" mode would let our existing Claude agent drive the call directly.
- **Vapi is not recommended for Bulgarian today**: there are user reports of Bulgarian recognition not working, and no official confirmation.

**Honest caveat.** This comes from web research only. I couldn't open the vendors' own sites from the build environment (elevenlabs.io and docs.retellai.com were blocked), and I couldn't listen to any of them. Before building, do a **1-hour bake-off**: the same 5 test calls in Bulgarian on ElevenLabs and Retell (booking, unclear phone number, interruption, background noise, English caller). Score recognition errors and naturalness, and check the current per-minute price for each (I haven't verified prices).

## Minimal integration plan (about 1–2 days after approval)

1. **Tool webhooks on our side** (`POST /api/voice/tools/{tool}`). They reuse `runTool()` unchanged, so every rule and the double-booking constraint apply to calls too. Each call becomes a conversation with `channel = 'voice'` and `external_id = <call id>`. A shared secret header protects the endpoint. Every call is logged to `tool_calls` like today.
2. **Voice agent in ElevenLabs**: Bulgarian, a chosen voice, and our 5 tools pointing at the webhooks. The system prompt is adapted for speech: short sentences, times said as words ("в пет и половина"), repeat the phone number back digit by digit, spell the booking code, and say "I'll text you the details" where useful.
   - Start with ElevenLabs' built-in LLM option plus our tools (the least code).
   - If answers differ noticeably from the chat agent, switch to "custom LLM" so our Claude agent is the single brain for chat and voice.
3. **Phone number**: import a Twilio number into ElevenLabs, or use a SIP trunk from a Bulgarian operator for a local `+359` number. Check Twilio's Bulgarian number availability and paperwork first. The simplest rollout: the salon forwards its existing number to the agent when nobody answers within about 4 rings.
4. **Transcripts in the dashboard**: a post-call webhook stores the transcript as messages, so calls appear under "Разговори" with a "Телефон" badge, and handoffs are flagged the same way.
5. **Tests**: tool-webhook tests in the existing suite, plus 20 scripted test calls before going live.

Reply "approve voice" (and which provider, after the bake-off) and I'll build it.

## Sources

- [ElevenLabs — Bulgarian](https://elevenlabs.io/languages/bulgarian), [Bulgarian speech-to-text](https://elevenlabs.io/speech-to-text/bulgarian)
- [ElevenLabs Agents — tools](https://elevenlabs.io/docs/eleven-agents/customization/tools), [Twilio custom LLM integration](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/custom-llm-integration)
- [Retell AI — language support](https://docs.retellai.com/build/language-support.md), [Retell — Bulgarian](https://www.retellai.com/languages-ai/bulgarian-ai)
- [Vapi — multilingual docs](https://docs.vapi.ai/customization/multilingual), [Vapi forum: can't switch transcription to Bulgarian](https://support.vapi.ai/t/27167201/cant-switch-transcription-to-bg-bulgarian-even-when-i-choose), [Vapi forum: Deepgram Bulgarian](https://support.vapi.ai/t/18774150/deepgram-bulgarian)
- [Storyblocks — ElevenLabs model languages (secondary)](https://help.storyblocks.com/en/articles/14667771-what-languages-do-you-support-with-ai-voiceover), [Soniox vs ElevenLabs, Bulgarian (competitor's claim)](https://soniox.com/compare-stt/soniox-vs-elevenlabs/bulgarian)
