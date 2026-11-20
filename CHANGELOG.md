# Changelog

What's new in each version, written for the people using the app. These notes
appear in the update popup and on the GitHub release, so keep them in plain
language. A version with nothing to notice can say "No visible changes."

## 0.9.1-beta.19

- Submit Time now has a Today filter, and it is the one selected when you open the page.
- Sprint Planning: the counters now follow the Jira board's columns. The first column counts as to do, the last as done and the ones between (such as In Progress and Ready for PR) as in progress, so they match the columns below. Each column also shows its points.
- Sprint Planning now refreshes itself from Jira every five minutes while it is open, without interrupting you if you are typing.
- New sprint settings: the story points a week kept for support (one point is one day's work) and the date the sprint ends. If no end date is set, the sprint ends two weeks after it started.
- While the sprint runs, Sprint Planning shows story points completed against the points expected by now, and the support time spent against the time kept for support. Support time is the time in Tempo logged as Support-Fix or Support-Investigation, plus entries not sent yet that would be given one of those types.
- The Dashboard shows the same two summaries (sprint story points and support time) while a sprint is running.

## 0.9.1-beta.18

- Daily Scrum: Planned for today now includes the tickets assigned to you that are In Progress in Jira, without you having to add them. They come straight from Jira, so they disappear once the ticket moves on, and they have no Remove button.

## 0.9.1-beta.17

- Dashboard: Recent Activity no longer lists Lunch. It's a break rather than an activity, and it was the one item that showed a different tick because it can never be sent to Tempo.

## 0.9.1-beta.16

- The Daily Scrum page now shows today's meetings. The first time you open it each day it pulls them from your calendar automatically, and lists them in a Meetings section under Planned for today, in the same box so everything still fits on screen.

## 0.9.1-beta.15

- Sprint Planning no longer locks once the sprint starts. You can still search for and add tickets, and remove them, while the sprint is running, since tickets do get added mid-sprint.
- While the sprint runs, the progress view now uses your Jira board's own columns (such as Ready for PR and Ready for QA), in the board's order, instead of just To Do, In Progress and Done. Columns that don't fit on one row wrap onto the next. This needs the board number or link set on the page; without it, tickets are grouped by their status instead.
- The sprint counters now show tickets as well as story points (for example "0 pts to do · 7 tickets"), because tickets with no estimate add no points and a points-only counter read as zero.

## 0.9.1-beta.14

- Pull Requests: fixed the long "Some GitHub searches failed" error on later pages. GitHub was being asked to run every search again each time you went to the next page, until it started refusing them. Searches now load in bigger batches, so the following pages reuse them.
- Failed GitHub requests are retried three times before giving up (the retry for server errors and rate limits wasn't working before). If a page is still missing some results, it says "Search incomplete. Press Refresh to try again." instead of showing GitHub's error, and still shows what it found.
- Refresh on the Pull Requests page now reloads only the page you're on and keeps the other pages you've already loaded.

## 0.9.1-beta.13

- Searching for tickets to add on the Sprint Planning page now works like the other ticket lookups: a ticket key anywhere in what you type is found directly, and words are matched in the summary, then anywhere in the ticket, then any one of the words, best match first. It still isn't limited to your own tickets, since next sprint's work is often unassigned.

## 0.9.1-beta.12

- Sprint Planning now finds story points whichever story point field your Jira uses, instead of only two exact names, so estimates on the ticket show up.
- Refresh from Jira re-reads every planned ticket (status, title and points), and it also runs when you open the page, since tickets change during planning. A story point estimate in Jira replaces one you typed in; one you typed in stays only while Jira has none.

## 0.9.1-beta.11

- Sprint Planning: if you paste a full Jira board link, the Open sprint board button now opens exactly that link. Otherwise the link it builds no longer alters your Jira account ID, which could lead to a "can't find what you're looking for" page.

## 0.9.1-beta.10

- Fixed scrolling on the Sprint Planning page: the whole window used to shift up and leave a blank area instead of the page scrolling normally.

## 0.9.1-beta.9

- The Settings tab and its hints that said "Current Sprint" now say "Current PI", since it holds the PI number and PI tickets.

## 0.9.1-beta.8

- Updated the libraries TimeLogger is built on (including the database, Vue and Vuetify). No visible changes, but if an update fails to install or the app misbehaves after this one, please let me know.

## 0.9.1-beta.7

- New Sprint Planning page, above Pull Requests. Search Jira and add the tickets you plan to take on next sprint, remove them again, and see their story points added up against the points you have available. Notes you add to a ticket here also show on the Notes page.
- When you're ready, Start sprint locks the plan and the page becomes a progress view of your tickets (To Do, In Progress, Done) with points done. A button opens your own view of the sprint board in Jira, once you've entered the board number or pasted a board link. Finish sprint takes you back to planning with unfinished tickets carried over.
- Ticket lookups now include tickets you've recently updated as well as the ones assigned to you, so a ticket you've passed on to QA can still be logged against.

## 0.9.1-beta.6

- Fixed approvals and other GitHub review alerts being lost when they arrived while TimeLogger was open and in front. They now show as a short message in the app (and still go to your notifications when the app is in the background).
- The Pull Requests page now shows who has approved a pull request, or asked for changes, and reloads by itself when an alert arrives so it matches.

## 0.9.1-beta.5

- On the Pull Requests page, you can go back while the next page is still loading. The page keeps loading in the background, so it's ready when you come back to it.
- Merged and closed pull requests are now saved on your computer the first time they load and never loaded again, since they don't change. Only the check for new ones is repeated, and Refresh does that. Open pull requests are still reloaded after a minute.

## 0.9.1-beta.4

- The Pull Requests page no longer has a search box. Use the relationship and status filters, which pick what's loaded, and the page keeps what it has loaded for a minute so going back is instant.

## 0.9.1-beta.3

- The Pull Requests page now shows 3 pull requests at a time and only asks GitHub for the ones on the page, so it loads much faster and uses far fewer requests. Going back to a page you've seen is instant.
- Searching the Pull Requests page covers the title, description, comments, repository, author and number. Searching by branch name no longer works.

## 0.9.1-beta.2

- Submit Time takes less room: the "all entries have been submitted" message is now a single line.
- In Local Entries vs Tempo, the status filters are now a dropdown, with a Refresh button on the same row.

## 0.9.1-beta.1

- On the Submit page, entries with no ticket can now get one. Ask the local AI to suggest tickets, then approve or dismiss each one (nothing is saved until you approve), or type a ticket on the row yourself.
- Time tickets now show their PI and type, like "PI 44 TIME-1234 Daily Scrum", in ticket lists and suggestions, under ticket fields, on the entry and note lists, on Daily Scrum, and when choosing a ticket for a meeting.
- Editing an entry now suggests tickets in the ticket box, and the search button with an empty task name also lists your time tickets, not only the tickets assigned to you.
- Fixed the update installer still failing with "Error opening file for writing". The app no longer restarts its background service while an update is installing. You may see the error once more, installing this version.

## 0.9.0

- Daily Scrum now lists the pull requests behind your open blockers, marked as blockers and shown first, and its pull request cards match the Pull Requests page.
- Meetings that match one of your Current Sprint keywords, like the Daily Scrum, now get their ticket automatically. The ones that don't match say why.
- Blockers on a note now show whether they're open or resolved, and you can resolve or reopen one from the note. A resolved blocker no longer comes back after the note is edited.
- The ticket list on Add Entry and notes says what each ticket is, always includes your current PI tickets, and the Jira search button lists your in-progress tickets when the name and ticket are empty.
- The PI Ticket Correction Review now sits below Local Entries vs Tempo on the Submit page, and looks like the rest of that page.
- The pull requests page no longer fails all its searches at once, retries when GitHub has a hiccup, and shows the first error if one still fails.
- You can roll back to an earlier version in Settings > About. The Main update channel is now called Stable, and the app checks for updates every few hours while it's open.
- Updates no longer interrupt you: an "Update available" button appears in the sidebar and shows what's new.
- The update installer no longer fails with "Error opening file for writing". The app now stops its background service before installing. You may see the error once more, installing this version.
- The dashboard workday target now leaves out lunch, so a full day no longer shows an hour remaining.

## 0.9.0-beta.7

- Meetings that match one of your Current Sprint keywords, like the Daily Scrum, now get their ticket automatically. The ones that don't match say why.
- The PI Ticket Correction Review now sits below Local Entries vs Tempo on the Submit page, and looks like the rest of that page.
- The pull requests page no longer fails all its searches at once, retries when GitHub has a hiccup, and shows the first error if one still fails.
- Fixed the update installer failing with "Error opening file for writing" on a native file. The app now stops its background service before installing. You may see the error once more, installing this version.
- The dashboard workday target now leaves out lunch, so a full day no longer shows an hour remaining.

## 0.9.0-beta.5

- The Jira search button on an entry now lists your in-progress tickets to pick from when the name and ticket are empty.
- Made saving the update channel safer, so it can't affect your other settings.

## 0.9.0-beta.4

- The ticket list on Add Entry and notes now says what each ticket is, and always includes your current PI tickets.

## 0.9.0-beta.3

- The notes list now shows whether each blocker is open or resolved.
- You can mark a blocker resolved, or reopen it, from the note itself.
- Fixed a resolved blocker reopening and returning to the Daily Scrum when the note was edited or filed under a category.

## 0.9.0-beta.2

- No visible changes.

## 0.9.0-beta.1

- You can now roll back to an earlier version in Settings > About, if a new one breaks something.
- The Main update channel is now called Stable. Choosing it on a beta build now offers the latest stable release, instead of saying you're up to date.
- The app now checks for updates every few hours while it's open, not only when it starts.
- Fixed a beta install moving to the Stable channel by itself after installing a stable version.

## 0.8.3-beta.2

- Updates no longer interrupt you. An "Update available" button appears in the sidebar instead, and clicking it shows what's new.
- The update popup now lists what changed in each version since yours.

## 0.8.3-beta.1

- No visible changes.

## 0.8.2

- Fixed the Beta update channel, which couldn't find new versions.

## 0.8.1

- No visible changes.

## 0.8.0

- Added a choice of Stable or Beta updates in Settings > About.
