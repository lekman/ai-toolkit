---
samurai_id: "{meeting id}"
samurai_kind: document
meeting: "[[{meeting folder name}]]"
date: "{YYYY-MM-DD}"
client: "{Client}"
type: meeting
series: "{recurring meeting name, or leave out}"
source: "{samurai-scribe or meetily}"
tags: [meeting]
---

# {Title}, {D Month YYYY}

Samurai Scribe: Transcript: [[{meeting folder name}/Transcript|full transcript]] · Audio: [[{meeting folder name}/_playback.m4a|playback]] (kept by Samurai Scribe) · Samurai's summary: [[{meeting folder name}/Summary|Summary]] · Notes and screenshots: [[{meeting folder name}/Notes|Notes]]

Meetily: Transcript: [[{transcript file name without .md}|full transcript]] · Audio: [audio.mp4](file://{URL-encoded path to the Meetily audio file}) (on this Mac only, delete by {D Mon YYYY})

Keep only the line for the source and delete the other. For Samurai Scribe, link only the files the meeting folder holds, and keep the three `samurai_` and `meeting` keys, which the app uses to tie the note to the meeting. For Meetily, drop the three `samurai_` and `meeting` keys, add `meetily_id: "{id}"` and `audio_delete_by: "{YYYY-MM-DD}"`.

{Start to end time with time zone, meeting tool, who hosted, who was expected but absent.}

## Shareable

Ready to paste into Teams or email. No patient or personal data, no internal observations, no speaker the transcript does not make clear.

Summary of {meeting}, {D Mon}.

### Attendees

**{Company}:** {Name}, {Name}.
**{Company}:** {Name}, {Name}.

### Summary

#### {Topic}

{Two to four sentences: what was discussed and where it landed.}

### Mood and Momentum

- **Mood:** {how the participants came across, from their own words}.
- **Where we are:** {status against the plan or milestone, and how urgent the next step is}.
- **Worries raised:** {concerns the other side raised themselves, worded neutrally; "None raised" if none}.
- **Follow-up:** {whether a follow-up is needed, what and when; "None needed" if none}.

### Decisions

- {one line per decision}

### Actions

- [ ] {Owner}: {action} ({due, if one was given})

## Record

Internal. Times in brackets are minutes into the recording.

### Decisions with Evidence

- **{Decision}.** {What settled it, with a short quote} ({mm:ss}).

### Actions with Evidence

- {Owner}: {action} ({mm:ss}). {Task id, if one was created.}

### Mood Evidence

- "{Quote behind each Mood and Momentum line}" ({mm:ss})

### Reading the Room

Internal only. {Tensions, risks to the relationship, absences that mattered, anything that should shape the next conversation but not be shared.}

### Open Questions

- {Question nobody answered} ({mm:ss})

### Observations

{What was seen on shared screens or noticed outside the discussion, for the team to triage. Not decisions from the meeting.}
