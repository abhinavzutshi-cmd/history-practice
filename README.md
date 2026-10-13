# History Quiz Moderator

A local web app for moderating History Bee and History Bowl games turn by turn,
using the question packets in the parent folder.

## Run it

Open `index.html` in a browser (double-click works), or serve the folder:

    python3 -m http.server 8765 --directory quiz-app

then visit http://localhost:8765.

## Setup options

- **Format**: History Bee (individual, 1 point per tossup) or History Bowl (two teams, four quarters).
- **Level**: Elementary & Middle School, Varsity & JV, or both.
- **Rounds**: all, preliminary rounds only, or playoffs/semis/finals only.
- **Categories**: auto-tagged from question text (a question can carry more than one tag).
- Questions used in earlier games are skipped by default (tracked in this browser; resettable).

Question pools: Bee games draw from Bee tossups **and** Bowl first-quarter tossups;
Bowl first quarter draws from Bowl Q1 tossups **and** Bee tossups. Q2, Q3 and Q4 use Bowl questions only.

Keyboard: `→`/`N` next, `←` previous, `R` replace question, `U` undo, and in the third quarter `C` correct, `X` incorrect, `Space` timer.

## Rebuilding the question bank

`data/questions.js` is generated from the PDFs. To regenerate (needs `pdftotext` from poppler-utils and `pypdf`):

    pip install pypdf
    python3 tools/build_questions.py ..

Category keywords live in `tools/categorize.py`.
