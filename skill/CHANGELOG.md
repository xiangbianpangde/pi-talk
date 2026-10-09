# Changelog

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
