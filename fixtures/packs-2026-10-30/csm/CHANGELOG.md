# Separate CSM testing update on 30 October 2026

## Added measures

- Company anchored journey: `journey_angry5` and `journey_disappointed5`.
- Latest channel experience: `channel_angry5` and `channel_disappointed5`.
- Call-centre diagnostics: live-agent contact screen; queue-wait, total-call-time and overall-agent satisfaction; reaching the correct person on the first transfer; ownership, promises, patience and urgency; IVR availability, response speed, information accuracy and ease.
- Full item wording, response codes and routes in separate questionnaires and all codebooks. Promises not yet due (code 9) are excluded from valid ratings, not treated as failure.

## Data contract

Existing 98 company and 71 channel fields remain unchanged. Updated schemas have 100 and 88 fields respectively. Every new value is copied from frozen combined testing files; no RNG was rerun. Three company and three channel wave files per sector are updated in XLSX and CSV; pooled All_Waves files are exact row concatenations. All noncustomer data and questionnaires remain unchanged and separate.

## Supporting materials

Both sectors include refreshed briefs, separate company/channel questionnaires, dashboard guides, Claude instructions, embedded metadata, master codebooks, all 6,213 reference metrics, import warnings, validators, manifests and preservation evidence. Choose one representation and one import mode per grain. No application or third-party contact was performed.
