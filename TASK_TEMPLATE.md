# Agent task template

Paste-ready from the phone. Keep tasks this tight — from a phone you cannot
easily course-correct a sprawling run, and "work on the UI" produces thirty
changed files you cannot review.

```
Scope:       <exact directory or file list — nothing outside it>
Goal:        <one sentence, concrete>
Constraints: no new dependencies; keep existing prop interfaces;
             do not touch migrations or RLS
Done when:   npm test passes, npm run build succeeds
Then:        commit, push the branch, print the branch name
```

## Worked example

```
Scope:       src/components/Settings/ only
Goal:        match the spacing and typography of src/components/Profile/
Constraints: no new dependencies; keep existing prop interfaces
Done when:   npm test passes and npm run build succeeds
Then:        commit, push branch feat/settings-spacing, print the name
```

## Routing

| Task type                          | Send to        |
|------------------------------------|----------------|
| UI, styling, layout                | local 14B      |
| Forms, validation, client state    | local 14B      |
| Tests                              | local 14B      |
| RLS policies                       | Claude, review yourself |
| Migrations                         | Claude, review yourself |
| Auth flows, sessions               | Claude         |
| Server/client component boundaries | Claude         |
| Debugging production behaviour     | Claude         |

Rule of thumb: UI and tests to local models, anything touching data or auth
to Claude. Your Max quota is shared with Claude chat and Cowork — spend it
where a wrong answer is expensive.
