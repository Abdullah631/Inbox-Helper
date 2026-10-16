import type { Intent } from "./intents";

// Used when there's no LLM or the LLM fails. Messages that look like an injection
// attempt get no reply at all (see INJECTION_NOTE). Every template has to pass the
// guardrails (there's a test).
// Placeholders in [BRACKETS] are filled in by the recruiter before sending.
export const TEMPLATES: Record<Intent, string> = {
  scheduling:
    "Hi [NAME], thanks for letting me know. I'll look at the calendar and come back to you with a time that works. Does [INTERVIEW_SLOT] suit you? [RECRUITER_NAME]",
  status_check:
    "Hi [NAME], thanks for checking in, and sorry for the wait. I'm following up with the team on your application and will update you as soon as I hear back. [RECRUITER_NAME]",
  offer_compensation:
    "Hi [NAME], thanks for your message. This is something I want to go through with you properly, so I'll get back to you personally. [RECRUITER_NAME]",
  withdrawal:
    "Hi [NAME], thanks for letting me know, and for the time you put into the process. I've noted it on our side. Best of luck with what comes next. [RECRUITER_NAME]",
  documents:
    "Hi [NAME], thank you for sending this over. I'll add it to your application. [RECRUITER_NAME]",
  referral:
    "Hi [NAME], thanks for thinking of us. The best way is for them to apply through [JOB_LINK] and mention your name, and I'll keep an eye out. [RECRUITER_NAME]",
  question:
    "Hi [NAME], good question. Let me check the details with the team and come back to you. [RECRUITER_NAME]",
  other: "Hi [NAME], thanks for your message. [RECRUITER_NAME]",
};

// For messages flagged as possible injection we never ask the model to write
// anything. A person reads the original and decides.
export const INJECTION_NOTE = "No draft. This message looks like it's trying to instruct the AI, so a person should read it and reply.";
