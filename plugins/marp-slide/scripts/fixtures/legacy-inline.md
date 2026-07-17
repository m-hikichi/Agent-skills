---
marp: true
theme: default
size: 16:9
paginate: true
style: |
  section {
    background: #ffffff;
    color: #172033;
    font-family: sans-serif;
  }
  section h1 {
    color: #1f4d7a;
  }
---

# Legacy inline theme remains supported

This fixture verifies that marp_export still works when the optional theme argument is omitted.

---

# Existing decks do not require migration

The rubric must be regenerated, but the source format remains export-compatible.
