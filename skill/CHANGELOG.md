# Changelog

## 1.6.0

- Add optional non-blocking transcript publication through the validated brief boundary.
- Suppressed briefs do not create transcript entries; explicit requests can override suppression.
- Publication does not inject a user prompt, start another model turn, open HTML or require a format picker.

## 1.5.0

- Suppress producer-classified routine automatic drafts without keyword-based misclassification of real deliverables.
- Brief delivery returns a continuation instruction; even a blocker label does not by itself require user involvement.
- Fold routine milestones and next-step narration into the final delivery instead of ending the task.

## 1.4.0

- Stage updates are non-blocking and require consequential change; milestones and commits do not end execution.
- Ask only for essential input, scope changes or actual required authorization; reuse existing permission.
- Empty automatic drafts are suppressed; explicit requests remain responsive.

## 1.3.0

- Apply the user's 5/5 preference for conclusion/status-first, decision-oriented reporting without forcing a template.
- Keep facts, limitations and unfinished work visible; omit routine process narration.

## 1.2.0

- Ordinary reports use the main transcript with no format picker, session or browser.
- Add bounded task-evidence context and conservative brief checks; no background model calls.
- Restrict rich-media permissions and templates to explicit requests; diagrams are optional.
- Document ephemeral evidence scope and distinguish observation from independent verification.

## 1.1.0

- Add the governed 一张图汇报 route: ask for 1–5 pages and use an image-only permit with `talk_report_images`.
- Require traceable evidence, explicit limitations, and verified PNG output alongside editable SVG.

## 1.0.0

- Require full task completion and passed acceptance checks before any formal HTML report.
- Ask the user for a report type through `talk_prepare_report` for each new report; pass its one-use permit to `talk_render`.
- Keep ordinary prototypes and layered explanations outside the formal-report gate.
- Move style-pack and runtime implementation details into focused references while retaining the report policy in the entrypoint.
